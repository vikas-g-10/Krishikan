import type { Reviewer } from "./mocks.ts";
import type { Action, CaseState, EnvironmentState, FarmState, ProposedDecision, Review, SafetyCheck } from "../types/contracts.ts";

export interface DecisionReviewerRequest {
  instructions: string;
  state: {
    proposal: ProposedDecision;
    // Deliberately excludes `images`: see the matching comment in decision-synthesizer-agent.ts.
    // The reviewer only ever needs the Perception Agent's distilled text findings, not the raw
    // photo payload, which was inflating this request past provider per-minute token limits.
    perception: Omit<CaseState["observations"], "images">;
    context: CaseState["context"];
    risk: CaseState["risk"];
    economics: CaseState["economics"];
    farm: FarmState;
    environment: EnvironmentState;
    safety: CaseState["safety"];
    negativeConstraints: string[];
    cycleCount: number;
  };
}

export interface DecisionReviewerModel {
  review(request: DecisionReviewerRequest): Promise<unknown>;
}

const interventionActions = new Set<Action>(["CULTURAL_ACTION", "BIOLOGICAL_INTERVENTION", "APPROVED_GREEN_INTERVENTION"]);

const instructions = `You are the KRISHI-NEXUS Adversarial Reviewer. Your job is to try to DISPROVE the proposed decision, not to rubber-stamp it. You are given the proposal together with the perception evidence, field context, risk assessment, economics, farm state, environment/weather, the deterministic Safety Engine result, and the active negative constraints. The deterministic Safety Engine is authoritative and has already run: if it reports a BLOCKED status you are not consulted, so you may assume that if you are being asked to review, the deterministic checks currently PASS. Scrutinize the proposal for whether: the cited evidence actually supports the action; the field context, crop stage, and history are consistent with the action; the weather/forecast does not undermine the action; the economics justify the action; every negative constraint is honored; and no fact needed to justify the action has been invented or assumed. If evidence, context, weather, crop stage, economics, or a constraint check does not clearly and directly support the proposal, VETO it and explain exactly what is missing or contradicted. Never invent a fact that was not supplied to you, and never approve a proposal on the basis of a fact you supplied yourself. If you VETO, list concrete, specific requiredChanges that describe what must change before the proposal could be approved; do not name, recommend, or prescribe a specific chemical, product, or dosage. Return JSON only with verdict, concerns, and requiredChanges.`;

const responseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "concerns", "requiredChanges"],
  properties: {
    verdict: { type: "string", enum: ["APPROVE", "VETO"] },
    concerns: { type: "array", items: { type: "string" } },
    requiredChanges: { type: "array", items: { type: "string" } }
  }
} as const;

/** A real, provider-agnostic model boundary for the Adversarial Reviewer, mirroring the Perception Agent and Decision Synthesizer model boundaries. */
export class OpenAIResponsesDecisionReviewerModel implements DecisionReviewerModel {
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;
  constructor(
    apiKey = process.env.OPENAI_API_KEY,
    model = process.env.OPENAI_MODEL ?? "gpt-4o",
    fetchImpl: typeof fetch = fetch
  ) {
    this.apiKey = apiKey;
    this.model = model;
    this.fetchImpl = fetchImpl;
  }

  async review(request: DecisionReviewerRequest): Promise<unknown> {
    if (!this.apiKey) throw new Error("OPENAI_API_KEY is required to run the real Adversarial Reviewer Agent.");
    const response = await this.fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "authorization": `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        store: false,
        instructions: request.instructions,
        input: [{ role: "user", content: [{ type: "input_text", text: JSON.stringify(request.state) }] }],
        text: { format: { type: "json_schema", name: "decision_review", strict: true, schema: responseSchema } }
      })
    });
    if (!response.ok) throw new Error(`Adversarial Reviewer model request failed (${response.status}): ${await response.text()}`);
    const payload = await response.json() as { output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }> };
    const outputText = payload.output?.flatMap(item => item.content ?? []).find(part => part.type === "output_text")?.text;
    if (!outputText) throw new Error("Adversarial Reviewer model returned no structured output.");
    return JSON.parse(outputText);
  }
}

/**
 * OpenRouter's OpenAI-compatible Chat Completions provider. Same DecisionReviewerModel boundary as
 * OpenAIResponsesDecisionReviewerModel above — only the transport, endpoint, and request/response
 * shape differ. Defaults to `openrouter/free`, OpenRouter's zero-cost router, which filters to free
 * models that support structured JSON outputs, so no paid credits are required.
 */
export class OpenRouterChatCompletionsDecisionReviewerModel implements DecisionReviewerModel {
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;
  constructor(
    apiKey = process.env.OPENROUTER_API_KEY,
    model = process.env.OPENROUTER_MODEL ?? "openrouter/free",
    fetchImpl: typeof fetch = fetch
  ) {
    this.apiKey = apiKey;
    this.model = model;
    this.fetchImpl = fetchImpl;
  }

  async review(request: DecisionReviewerRequest): Promise<unknown> {
    if (!this.apiKey) throw new Error("OPENROUTER_API_KEY is required to run the real Adversarial Reviewer Agent via OpenRouter.");
    const response = await this.fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "authorization": `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: "system", content: request.instructions }, { role: "user", content: JSON.stringify(request.state) }],
        response_format: { type: "json_schema", json_schema: { name: "decision_review", strict: true, schema: responseSchema } }
      })
    });
    if (!response.ok) throw new Error(`Adversarial Reviewer model request failed (${response.status}): ${await response.text()}`);
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const outputText = payload.choices?.[0]?.message?.content;
    if (!outputText) throw new Error("Adversarial Reviewer model returned no structured output.");
    return JSON.parse(extractJsonPayload(outputText));
  }
}

/**
 * Groq's OpenAI-compatible Chat Completions provider. Same DecisionReviewerModel boundary as the
 * OpenRouter and OpenAI adapters above — only the transport, endpoint, and provider quirks
 * differ. Defaults to `openai/gpt-oss-20b`, one of the few models Groq currently supports with
 * guaranteed `strict: true` structured outputs.
 */
export class GroqChatCompletionsDecisionReviewerModel implements DecisionReviewerModel {
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;
  constructor(
    apiKey = process.env.GROQ_API_KEY,
    model = process.env.GROQ_REVIEWER_MODEL ?? process.env.GROQ_MODEL ?? "openai/gpt-oss-20b",
    fetchImpl: typeof fetch = fetch
  ) {
    this.apiKey = apiKey;
    this.model = model;
    this.fetchImpl = fetchImpl;
  }

  async review(request: DecisionReviewerRequest): Promise<unknown> {
    if (!this.apiKey) throw new Error("GROQ_API_KEY is required to run the real Adversarial Reviewer Agent via Groq.");
    const response = await this.fetchImpl("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "authorization": `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: "system", content: request.instructions }, { role: "user", content: JSON.stringify(request.state) }],
        // GPT-OSS models always reason and cannot fully disable it, but reasoning_effort: "low"
        // keeps that reasoning pass short, and max_completion_tokens caps the total response so a
        // low per-minute output-token limit on this account isn't exceeded.
        reasoning_effort: "low",
        max_completion_tokens: 1000,
        response_format: { type: "json_schema", json_schema: { name: "decision_review", strict: true, schema: responseSchema } }
      })
    });
    if (!response.ok) throw new Error(`Adversarial Reviewer model request failed (${response.status}): ${await response.text()}`);
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const outputText = payload.choices?.[0]?.message?.content;
    if (!outputText) throw new Error("Adversarial Reviewer model returned no structured output.");
    return JSON.parse(extractJsonPayload(outputText));
  }
}

/**
 * A real, provider-agnostic Adversarial Reviewer. Tests inject a deterministic fake model.
 *
 * Deterministic backstops run before (and instead of, when they fire) the model call, and are what
 * make the reviewer trustworthy rather than merely advisory:
 *  - A deterministic Safety Engine BLOCK is never sent to the model and can never be overridden. The
 *    veto and its requiredChanges are derived only from the Safety Engine's own violations.
 *  - A proposal that recommends an intervention with no supporting evidence, that proceeds despite
 *    unresolved missing data, or that drops an active negative constraint is vetoed deterministically,
 *    without asking the model to judge something code can already prove.
 * Only once these backstops are clear is the model consulted to adversarially probe evidence, context,
 * weather, crop stage, and economics for softer gaps a deterministic rule cannot express.
 */
export class RealAdversarialReviewerAgent implements Reviewer {
  private readonly model: DecisionReviewerModel;
  constructor(model: DecisionReviewerModel) { this.model = model; }

  async review(state: CaseState): Promise<Review> {
    const proposal = state.proposedDecision!;
    const cycleCount = state.review.cycleCount;

    const backstop = deterministicVeto(state, proposal);
    if (backstop) return { ...backstop, cycleCount };

    const { images: _images, ...perceptionWithoutImages } = state.observations;
    const request: DecisionReviewerRequest = {
      instructions,
      state: {
        proposal,
        perception: perceptionWithoutImages,
        context: state.context,
        risk: state.risk,
        economics: state.economics,
        farm: state.farm!,
        environment: state.environment!,
        safety: state.safety,
        negativeConstraints: [...state.workflow.negativeConstraints],
        cycleCount
      }
    };
    const result = validateReview(await this.model.review(request));
    return { ...result, cycleCount };
  }
}

/** Deterministic, model-independent checks. Returns a veto verdict if any fires, otherwise null. */
function deterministicVeto(state: CaseState, proposal: ProposedDecision): Omit<Review, "cycleCount"> | null {
  if (state.safety.status === "BLOCKED") {
    return {
      verdict: "VETO",
      concerns: state.safety.violations.map(violation => violation.reason),
      requiredChanges: dedupe(state.safety.violations.map(requiredChangeForViolation))
    };
  }

  const concerns: string[] = [];
  const requiredChanges: string[] = [];

  if (interventionActions.has(proposal.action) && proposal.evidence.length === 0) {
    concerns.push("The proposal recommends an intervention but cites no supporting evidence.");
    requiredChanges.push("Cite specific supporting evidence before proposing this intervention.");
  }
  if (interventionActions.has(proposal.action) && !proposal.interventionId) {
    concerns.push("The proposal recommends an intervention action without a supported intervention identifier.");
    requiredChanges.push("Provide a vetted intervention identifier or withdraw the intervention proposal.");
  } else if (!interventionActions.has(proposal.action) && proposal.interventionId) {
    concerns.push("The proposal includes an intervention identifier for a non-intervention action.");
    requiredChanges.push("Remove the intervention identifier or change the action to a supported intervention type.");
  }
  if (proposal.missingData.length > 0 && proposal.action !== "SEEK_EXPERT_CONFIRMATION") {
    concerns.push(`The proposal proceeds despite unresolved missing data: ${proposal.missingData.join("; ")}.`);
    requiredChanges.push("Resolve or seek expert confirmation for the missing data before proceeding.");
  }
  const droppedConstraints = state.workflow.negativeConstraints.filter(constraint => !proposal.constraints.includes(constraint));
  if (droppedConstraints.length > 0) {
    concerns.push(`The proposal does not honor an existing negative constraint: ${droppedConstraints.join("; ")}.`);
    requiredChanges.push("Honor every active negative constraint in the proposal.");
  }

  if (concerns.length === 0) return null;
  return { verdict: "VETO", concerns, requiredChanges };
}

function requiredChangeForViolation(violation: SafetyCheck): string {
  return `Address deterministic safety violation ${violation.ruleId}: ${violation.reason}`;
}

function dedupe(values: string[]): string[] { return [...new Set(values)]; }

function validateReview(value: unknown): Omit<Review, "cycleCount"> {
  if (!value || typeof value !== "object") throw new Error("Adversarial Reviewer model returned an invalid structured result.");
  const result = value as Partial<Review>;
  if ((result.verdict !== "APPROVE" && result.verdict !== "VETO") || !Array.isArray(result.concerns) || !Array.isArray(result.requiredChanges)) {
    throw new Error("Adversarial Reviewer model returned an invalid structured result.");
  }
  const allText = [...result.concerns, ...result.requiredChanges];
  if (!allText.every(item => typeof item === "string")) throw new Error("Adversarial Reviewer model result must contain text-only fields.");
  if (allText.some(containsTreatmentLanguage)) throw new Error("Adversarial Reviewer model result contained prohibited treatment, product, or dosage language.");
  if (result.verdict === "VETO" && (result.concerns.length === 0 || result.requiredChanges.length === 0)) {
    throw new Error("Adversarial Reviewer model vetoed without concrete concerns and required changes.");
  }
  return { verdict: result.verdict, concerns: result.concerns as string[], requiredChanges: result.requiredChanges as string[] };
}

// Unlike the Perception Agent and Decision Synthesizer (which author proposal content and must never
// even gesture at a treatment), the Adversarial Reviewer's job is to critique a proposal in prose, and
// legitimate critique routinely uses generic verbs like "recommend", "prescribe", "apply", "spray", or
// "treat(ment)" without naming anything concrete (e.g. "The proposal should not recommend this
// intervention because the evidence is insufficient."). Flagging those generic verbs produced false
// positives on exactly the kind of adversarial language this agent exists to produce. Concrete signals
// — a named chemical/product, a pesticide/fungicide/herbicide/insecticide category, or a dosage/quantity
// — remain fully blocked below; only the bare generic verbs were removed.
function containsTreatmentLanguage(value: string): boolean {
  return /\b(dosage|dose|\d+(?:\.\d+)?\s*(?:ml|l|lit(?:re|er)s?|g|kg|ppm)|fungicide|pesticide|herbicide|insecticide|chemical|mancozeb|copper(?:\s+sulfate)?|sulfur|neem)\b/i.test(value);
}

// Some OpenRouter-hosted free models wrap otherwise-valid structured-output JSON in a Markdown code
// fence despite response_format: json_schema being requested. Strip an optional fence before
// parsing; the underlying JSON payload and all downstream validation are unchanged.
function extractJsonPayload(text: string): string {
  const fenced = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : text;
}
