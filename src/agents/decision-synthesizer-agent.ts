import type { Synthesizer } from "./mocks.ts";
import type { Action, CaseState, Intervention, ProposedDecision } from "../types/contracts.ts";
import type { AgricultureTools } from "../tools/seeded-tools.ts";

export interface DecisionSynthesizerRequest {
  instructions: string;
  state: {
    perception: CaseState["observations"];
    context: CaseState["context"];
    risk: CaseState["risk"];
    economics: CaseState["economics"];
    history: NonNullable<CaseState["history"]>;
    negativeConstraints: string[];
    vettedInterventions: Array<Pick<Intervention, "id" | "action" | "foliar" | "compatibleStages">>;
  };
}

export interface DecisionSynthesizerModel {
  synthesize(request: DecisionSynthesizerRequest): Promise<unknown>;
}

const instructions = `You are the KRISHI-NEXUS Decision Synthesizer. Produce one proposed decision, not a final decision. Use only the supplied perception, field context, risk, economics, history, negative constraints, and vetted intervention identifiers. The deterministic Safety Engine remains authoritative. Never name, recommend, prescribe, or give a dose of a chemical or product. You may select an interventionId only from vettedInterventions. Honor every negative constraint. Return JSON only with action, interventionId when applicable, reason, reasoningSummary, evidence, confidence, constraints, uncertainties, and missingData.`;
const actions: readonly Action[] = ["MONITOR", "CULTURAL_ACTION", "BIOLOGICAL_INTERVENTION", "APPROVED_GREEN_INTERVENTION", "WAIT_FOR_SAFE_WEATHER_WINDOW", "SEEK_EXPERT_CONFIRMATION"];
const interventionActions = new Set<Action>(["CULTURAL_ACTION", "BIOLOGICAL_INTERVENTION", "APPROVED_GREEN_INTERVENTION"]);

/**
 * Raised when a provider responds successfully (HTTP 200) but the response body is not the
 * required structured JSON — e.g. plain-text prose or a shortcut safety verdict instead of a
 * decision_synthesis JSON object. Distinguished from a generic Error/SyntaxError so callers can
 * treat this as a controlled, expected provider-format failure rather than an unhandled parse
 * error. Mirrors PerceptionProviderFormatError in perception-agent.ts.
 */
export class DecisionSynthesizerProviderFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecisionSynthesizerProviderFormatError";
  }
}

// OpenRouter's free-tier models are considerably less reliable at honoring response_format:
// json_schema than OpenAI's Responses API. This reinforcement is appended only to the system
// message sent to OpenRouter — it does not alter the shared `instructions` text used by the
// OpenAI Responses adapter — and repeats, in the most explicit terms, exactly which keys must be
// present, which values are legal, and that no other prose is allowed.
const OPENROUTER_SYNTHESIS_JSON_SHAPE_REINFORCEMENT = `Your entire reply MUST be ONE JSON object and NOTHING else: no prose, no markdown, no code fences, no safety commentary, no explanatory text before or after the JSON. The JSON object MUST contain exactly these top-level keys, every time, with no keys added and no keys omitted: "action", "interventionId", "reason", "reasoningSummary", "evidence", "confidence", "constraints", "uncertainties", "missingData". "action" must be exactly one of the supplied allowed action enum values. "interventionId" must be null when action is not an intervention action, and when it is not null it must be exactly one of the ids in the supplied vettedInterventions. Do not recommend, prescribe, name, or give a dosage, product, or chemical treatment anywhere in the response. "constraints" must exactly preserve the supplied negative constraints — do not add, remove, or reword any of them.`;

const responseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["action", "interventionId", "reason", "reasoningSummary", "evidence", "confidence", "constraints", "uncertainties", "missingData"],
  properties: {
    action: { type: "string", enum: [...actions] },
    interventionId: { type: ["string", "null"] },
    reason: { type: "string" },
    reasoningSummary: { type: "string" },
    evidence: { type: "array", items: { type: "string" } },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    constraints: { type: "array", items: { type: "string" } },
    uncertainties: { type: "array", items: { type: "string" } },
    missingData: { type: "array", items: { type: "string" } }
  }
} as const;

/** A real, provider-agnostic model boundary for the Decision Synthesizer, mirroring the Perception Agent's model boundary. */
export class OpenAIResponsesDecisionSynthesizerModel implements DecisionSynthesizerModel {
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

  async synthesize(request: DecisionSynthesizerRequest): Promise<unknown> {
    if (!this.apiKey) throw new Error("OPENAI_API_KEY is required to run the real Decision Synthesizer Agent.");
    const response = await this.fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "authorization": `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        store: false,
        instructions: request.instructions,
        input: [{ role: "user", content: [{ type: "input_text", text: JSON.stringify(request.state) }] }],
        text: { format: { type: "json_schema", name: "decision_synthesis", strict: true, schema: responseSchema } }
      })
    });
    if (!response.ok) throw new Error(`Decision Synthesizer model request failed (${response.status}): ${await response.text()}`);
    const payload = await response.json() as { output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }> };
    const outputText = payload.output?.flatMap(item => item.content ?? []).find(part => part.type === "output_text")?.text;
    if (!outputText) throw new Error("Decision Synthesizer model returned no structured output.");
    return JSON.parse(outputText);
  }
}

/**
 * OpenRouter's OpenAI-compatible Chat Completions provider. Same DecisionSynthesizerModel boundary
 * as OpenAIResponsesDecisionSynthesizerModel above — only the transport, endpoint, and request/
 * response shape differ. Defaults to `openrouter/free`, OpenRouter's zero-cost router, which filters
 * to free models that support structured JSON outputs, so no paid credits are required.
 */
export class OpenRouterChatCompletionsDecisionSynthesizerModel implements DecisionSynthesizerModel {
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

  async synthesize(request: DecisionSynthesizerRequest): Promise<unknown> {
    if (!this.apiKey) throw new Error("OPENROUTER_API_KEY is required to run the real Decision Synthesizer Agent via OpenRouter.");
    const response = await this.fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "authorization": `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: `${request.instructions}\n\n${OPENROUTER_SYNTHESIS_JSON_SHAPE_REINFORCEMENT}` },
          { role: "user", content: JSON.stringify(request.state) },
          { role: "user", content: "Reminder: reply with only the required decision_synthesis JSON object using exactly the required keys. No other text." }
        ],
        response_format: { type: "json_schema", json_schema: { name: "decision_synthesis", strict: true, schema: responseSchema } }
      })
    });
    if (!response.ok) throw new Error(`Decision Synthesizer model request failed (${response.status}): ${await response.text()}`);
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const outputText = payload.choices?.[0]?.message?.content;
    if (!outputText) throw new Error("Decision Synthesizer model returned no structured output.");
    return parseDecisionSynthesisJson(outputText);
  }
}

/** A real, provider-agnostic model boundary. Tests inject a deterministic fake model. */
export class RealDecisionSynthesizerAgent implements Synthesizer {
  private readonly model: DecisionSynthesizerModel;
  private readonly agriculture: AgricultureTools;
  constructor(model: DecisionSynthesizerModel, agriculture: AgricultureTools) {
    this.model = model;
    this.agriculture = agriculture;
  }

  async propose(state: CaseState): Promise<ProposedDecision> {
    const missingData = missingInputs(state);
    if (missingData.length) return safeConfirmation("Synthesis did not proceed because required evidence or context is incomplete or conflicting.", state, missingData);
    if (state.economics.decisionGate === "SEEK_CONFIRMATION") return safeConfirmation("The economic assessment requires confirmation, so no intervention proposal was produced.", state, economicFlags(state));
    if (state.economics.decisionGate === "MONITOR") {
      return { action: "MONITOR", reason: "The deterministic economic gate does not justify an intervention today.", reasoningSummary: state.economics.economicJustification, evidence: [...state.risk.factors, state.economics.economicJustification], confidence: 0.8, constraints: [...state.workflow.negativeConstraints], uncertainties: [...state.risk.flags], missingData: [] };
    }
    if (state.economics.decisionGate === "WAIT") {
      return { action: "WAIT_FOR_SAFE_WEATHER_WINDOW", reason: "Current risk is low; the deterministic economic gate calls for waiting rather than intervening or merely monitoring.", reasoningSummary: state.economics.economicJustification, evidence: [...state.risk.factors, state.economics.economicJustification], confidence: 0.8, constraints: [...state.workflow.negativeConstraints], uncertainties: [...state.risk.flags], missingData: [] };
    }
    const vettedInterventions = await this.agriculture.getAvailableInterventions(state.farm!.crop, state.farm!.cropStage);
    const request: DecisionSynthesizerRequest = {
      instructions,
      state: { perception: state.observations, context: state.context, risk: state.risk, economics: state.economics, history: state.history!, negativeConstraints: [...state.workflow.negativeConstraints], vettedInterventions: vettedInterventions.map(({ id, action, foliar, compatibleStages }) => ({ id, action, foliar, compatibleStages })) }
    };
    return validateProposal(await this.model.synthesize(request), state, vettedInterventions);
  }
}

function missingInputs(state: CaseState): string[] {
  const missing = [
    ...(state.context.ready ? [] : ["Field context is not ready."]),
    ...(state.context.conflicts.map(conflict => `Conflicting field context: ${conflict.field}.`)),
    ...state.context.toolFlags.filter(flag => flag.status !== "RETRIEVED").map(flag => `${flag.tool}: ${flag.status}`),
    ...(!state.farm ? ["Farm state is unavailable."] : []), ...(!state.environment ? ["Environment state is unavailable."] : []), ...(!state.history ? ["Farm history is unavailable."] : [])
  ];
  return [...new Set(missing)];
}
function economicFlags(state: CaseState): string[] { return state.economics.flags.map(flag => `${flag.field}: ${flag.status}`); }
function safeConfirmation(reason: string, state: CaseState, missingData: string[]): ProposedDecision {
  return { action: "SEEK_EXPERT_CONFIRMATION", reason, reasoningSummary: "No missing, conflicting, or unverified input was replaced with an assumption.", evidence: [...state.risk.factors, ...economicFlags(state)], confidence: 0.4, constraints: [...state.workflow.negativeConstraints], uncertainties: [...state.risk.flags], missingData };
}

function validateProposal(value: unknown, state: CaseState, vetted: Intervention[]): ProposedDecision {
  if (!value || typeof value !== "object") throw new Error("Decision Synthesizer model returned an invalid structured proposal.");
  const proposal = value as Partial<ProposedDecision>;
  if (!actions.includes(proposal.action as Action) || typeof proposal.reason !== "string" || typeof proposal.reasoningSummary !== "string" || !Array.isArray(proposal.evidence) || !Array.isArray(proposal.constraints) || !Array.isArray(proposal.uncertainties) || !Array.isArray(proposal.missingData) || typeof proposal.confidence !== "number" || !Number.isFinite(proposal.confidence) || proposal.confidence < 0 || proposal.confidence > 1) throw new Error("Decision Synthesizer model returned an invalid structured proposal.");
  const allFields = [proposal.reason, proposal.reasoningSummary, ...proposal.evidence, ...proposal.constraints, ...proposal.uncertainties, ...proposal.missingData];
  if (!allFields.every(item => typeof item === "string")) throw new Error("Decision Synthesizer proposal fields must contain text only.");
  // Constraints are an exact, trusted echo of state.workflow.negativeConstraints (reviewer/deterministic
  // authored text). They are deliberately excluded from the free-text treatment-language scan below,
  // because a legitimate negative constraint (e.g. "Do not recommend foliar intervention during the
  // current rain window.") necessarily contains words like "recommend" or "foliar". Excluding them from
  // the scan is only safe because we require them to be an exact match against the trusted source list,
  // never model-authored free text, so nothing invented can hide there.
  const modelAuthoredText = [proposal.reason, proposal.reasoningSummary, ...proposal.evidence, ...proposal.uncertainties, ...proposal.missingData];
  if (modelAuthoredText.some(containsTreatmentLanguage)) throw new Error("Decision Synthesizer model output contained prohibited treatment, product, or dosage language.");
  const constraints = proposal.constraints as string[];
  if (!state.workflow.negativeConstraints.every(constraint => constraints.includes(constraint))) throw new Error("Decision Synthesizer proposal omitted a reviewer negative constraint.");
  if (!constraints.every(constraint => state.workflow.negativeConstraints.includes(constraint))) throw new Error("Decision Synthesizer proposal introduced a constraint that was not supplied by the workflow.");
  const action = proposal.action as Action;
  if (interventionActions.has(action)) {
    if (typeof proposal.interventionId !== "string") throw new Error("An intervention proposal must use a vetted intervention identifier.");
    const intervention = vetted.find(item => item.id === proposal.interventionId && item.action === action);
    if (!intervention) throw new Error("Decision Synthesizer proposed an intervention outside the vetted knowledge boundary.");
  } else if (proposal.interventionId != null) throw new Error("A non-intervention proposal must not include an intervention identifier.");
  return { action, interventionId: proposal.interventionId ?? undefined, reason: proposal.reason, reasoningSummary: proposal.reasoningSummary, evidence: proposal.evidence as string[], confidence: proposal.confidence, constraints, uncertainties: proposal.uncertainties as string[], missingData: proposal.missingData as string[] };
}

function containsTreatmentLanguage(value: string): boolean {
  return /\b(recommend|prescribe|apply|spray|treat(?:ment)?|dosage|dose|\d+(?:\.\d+)?\s*(?:ml|l|lit(?:re|er)s?|g|kg|ppm)|fungicide|pesticide|herbicide|insecticide|chemical|mancozeb|copper(?:\s+sulfate)?|sulfur|neem)\b/i.test(value);
}

// Some OpenRouter-hosted free models wrap otherwise-valid structured-output JSON in a Markdown code
// fence despite response_format: json_schema being requested. Strip an optional fence before
// parsing; the underlying JSON payload and all downstream validation are unchanged.
function extractJsonPayload(text: string): string {
  const fenced = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : text;
}

// Some OpenRouter-hosted free models occasionally ignore response_format: json_schema entirely and
// reply with unrelated prose or a shortcut safety verdict (e.g. "User Safety: safe") instead of the
// required decision_synthesis JSON. A raw JSON.parse on that text throws an uninformative
// SyntaxError that would otherwise leak as the production error. Convert that failure into a
// controlled, explicit DecisionSynthesizerProviderFormatError instead — no proposal is fabricated
// from the text, and a successful parse is still passed through to validateProposal unchanged.
// Used only inside OpenRouterChatCompletionsDecisionSynthesizerModel; mirrors parsePerceptionJson
// in perception-agent.ts.
function parseDecisionSynthesisJson(outputText: string): unknown {
  const candidate = extractJsonPayload(outputText);
  try {
    return JSON.parse(candidate);
  } catch {
    throw new DecisionSynthesizerProviderFormatError(
      `Decision Synthesizer provider did not return the required structured JSON output (received: ${JSON.stringify(outputText.slice(0, 200))}).`
    );
  }
}
