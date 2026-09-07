import type { PerceptionAgent } from "./mocks.ts";
import type { CaseState, Finding } from "../types/contracts.ts";

export type PerceptionContent =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail: "low" | "high" };

export interface PerceptionModelRequest {
  instructions: string;
  content: PerceptionContent[];
}

export interface PerceptionModelResult {
  visualFindings: Finding[];
  symptomFindings: string[];
  uncertainties: string[];
}

/** A narrow, mockable boundary around the multimodal provider. */
export interface PerceptionModel {
  observe(request: PerceptionModelRequest): Promise<PerceptionModelResult>;
}

/**
 * Raised when a provider responds successfully (HTTP 200) but the response body is not the
 * required structured JSON — e.g. a plain-text reply such as "User Safety: safe" instead of a
 * perception_observations JSON object. Distinguished from a generic Error so callers (the
 * orchestrator) can route this specific, controlled provider-format failure into the existing
 * safe-fallback path instead of a raw JSON.parse SyntaxError leaking to the top level.
 */
export class PerceptionProviderFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PerceptionProviderFormatError";
  }
}

// OpenRouter's free-tier models are considerably less reliable at honoring response_format:
// json_schema than OpenAI's Responses API: beyond wrapping JSON in a Markdown fence (handled by
// extractJsonPayload below), they sometimes reply with unrelated prose or a shortcut safety verdict
// (e.g. "User Safety: safe") instead of the perception_observations object entirely. This
// reinforcement is appended only to the system instructions sent to OpenRouter — it does not alter
// the shared `perceptionInstructions` text used by the OpenAI Responses adapter — and repeats, in
// the most explicit terms, exactly which keys must be present and that no other prose is allowed.
const OPENROUTER_JSON_SHAPE_REINFORCEMENT = `Your entire reply MUST be ONE JSON object and NOTHING else: no prose, no safety verdicts, no notes, no markdown, no code fences, no text before or after the JSON. Do not comment on user safety or anything unrelated to the schema. The JSON object MUST contain exactly these three top-level keys, every time, with no keys added or omitted: "visualFindings" (array of {finding, confidence, uncertainty}), "symptomFindings" (array of strings), "uncertainties" (array of strings). If there is nothing to report for a key, return an empty array for it — never omit the key and never replace the object with a text explanation.`;

// A short, final user-role reminder of the exact required JSON shape. This is a separate message
// appended after the existing farmer/voice/image content — it never edits or duplicates that
// content — used only for the OpenRouter provider to reinforce response_format compliance for
// free-tier models that are prone to ignoring it.
const OPENROUTER_JSON_SHAPE_USER_REMINDER = `Reminder: reply with only the required JSON object — keys "visualFindings", "symptomFindings", "uncertainties" — and no other text.`;

const perceptionInstructions = `You are the KRISHI-NEXUS perception component. Extract observations only; do not diagnose with certainty. You may use farmer text, a voice transcript, and images. Return only JSON matching the supplied schema. visualFindings must describe observable symptoms, each confidence must be 0 through 1, and uncertainty must explain a limitation or ambiguity. symptomFindings must be short neutral symptom tags. Do not recommend or prescribe any treatment, chemical, product, dosage, intervention, or action. When evidence is inadequate, return low confidence and explain what is missing.`;

const responseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["visualFindings", "symptomFindings", "uncertainties"],
  properties: {
    visualFindings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["finding", "confidence", "uncertainty"],
        properties: {
          finding: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          uncertainty: { type: "string" }
        }
      }
    },
    symptomFindings: { type: "array", items: { type: "string" } },
    uncertainties: { type: "array", items: { type: "string" } }
  }
} as const;

export class OpenAIResponsesPerceptionModel implements PerceptionModel {
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

  async observe(request: PerceptionModelRequest): Promise<PerceptionModelResult> {
    if (!this.apiKey) throw new Error("OPENAI_API_KEY is required to run the real Perception Agent.");
    const response = await this.fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "authorization": `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        store: false,
        instructions: request.instructions,
        input: [{ role: "user", content: request.content }],
        text: { format: { type: "json_schema", name: "perception_observations", strict: true, schema: responseSchema } }
      })
    });
    if (!response.ok) throw new Error(`Perception model request failed (${response.status}): ${await response.text()}`);
    const payload = await response.json() as { output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }> };
    const outputText = payload.output?.flatMap(item => item.content ?? []).find(part => part.type === "output_text")?.text;
    if (!outputText) throw new Error("Perception model returned no structured output.");
    return validatePerceptionResult(JSON.parse(outputText));
  }
}

/**
 * OpenRouter's OpenAI-compatible Chat Completions provider. Same PerceptionModel boundary, same
 * response schema and validation as OpenAIResponsesPerceptionModel above — only the transport,
 * endpoint, and request/response shape differ. Defaults to `openrouter/free`, OpenRouter's
 * zero-cost router, which filters to free models that support image input and structured JSON
 * outputs, so no paid credits are required.
 */
export class OpenRouterChatCompletionsPerceptionModel implements PerceptionModel {
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

  async observe(request: PerceptionModelRequest): Promise<PerceptionModelResult> {
    if (!this.apiKey) throw new Error("OPENROUTER_API_KEY is required to run the real Perception Agent via OpenRouter.");
    const content = request.content.map(part => part.type === "input_text"
      ? { type: "text" as const, text: part.text }
      : { type: "image_url" as const, image_url: { url: part.image_url, detail: part.detail } });
    const response = await this.fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "authorization": `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: `${request.instructions}\n\n${OPENROUTER_JSON_SHAPE_REINFORCEMENT}` },
          { role: "user", content },
          { role: "user", content: [{ type: "text", text: OPENROUTER_JSON_SHAPE_USER_REMINDER }] }
        ],
        response_format: { type: "json_schema", json_schema: { name: "perception_observations", strict: true, schema: responseSchema } }
      })
    });
    if (!response.ok) throw new Error(`Perception model request failed (${response.status}): ${await response.text()}`);
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const outputText = payload.choices?.[0]?.message?.content;
    if (!outputText) throw new Error("Perception model returned no structured output.");
    return validatePerceptionResult(parsePerceptionJson(outputText));
  }
}

/**
 * Groq's OpenAI-compatible Chat Completions provider. Same PerceptionModel boundary as the
 * OpenRouter and OpenAI adapters above — only the transport, endpoint, and provider quirks
 * differ. Defaults to a Groq-hosted vision-capable Llama 4 model, since this agent needs to
 * read images. Groq does not currently guarantee strict `response_format: json_schema` on any
 * vision-capable model, so this adapter asks for `json_object` mode instead and leans on the
 * same explicit JSON-shape reinforcement text and markdown-fence-stripping fallback used by the
 * OpenRouter adapter to recover a clean JSON payload.
 */
export class GroqChatCompletionsPerceptionModel implements PerceptionModel {
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;
  constructor(
    apiKey = process.env.GROQ_API_KEY,
    model = process.env.GROQ_PERCEPTION_MODEL ?? process.env.GROQ_MODEL ?? "meta-llama/llama-4-scout-17b-16e-instruct",
    fetchImpl: typeof fetch = fetch
  ) {
    this.apiKey = apiKey;
    this.model = model;
    this.fetchImpl = fetchImpl;
  }

  async observe(request: PerceptionModelRequest): Promise<PerceptionModelResult> {
    if (!this.apiKey) throw new Error("GROQ_API_KEY is required to run the real Perception Agent via Groq.");
    const content = request.content.map(part => part.type === "input_text"
      ? { type: "text" as const, text: part.text }
      : { type: "image_url" as const, image_url: { url: part.image_url, detail: part.detail } });
    const response = await this.fetchImpl("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "authorization": `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: `${request.instructions}\n\n${OPENROUTER_JSON_SHAPE_REINFORCEMENT}` },
          { role: "user", content },
          { role: "user", content: [{ type: "text", text: OPENROUTER_JSON_SHAPE_USER_REMINDER }] }
        ],
        response_format: { type: "json_object" }
      })
    });
    if (!response.ok) throw new Error(`Perception model request failed (${response.status}): ${await response.text()}`);
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const outputText = payload.choices?.[0]?.message?.content;
    if (!outputText) throw new Error("Perception model returned no structured output.");
    return validatePerceptionResult(parsePerceptionJson(outputText));
  }
}

export class RealPerceptionAgent implements PerceptionAgent {
  private readonly model: PerceptionModel;
  constructor(model: PerceptionModel) { this.model = model; }

  async observe(state: CaseState): Promise<PerceptionModelResult> {
    const content: PerceptionContent[] = [
      { type: "input_text", text: `Farmer report:\n${state.observations.farmerText}` },
      ...(state.observations.voiceTranscript ? [{ type: "input_text" as const, text: `Voice transcript:\n${state.observations.voiceTranscript}` }] : []),
      ...state.observations.images.map(image_url => ({ type: "input_image" as const, image_url, detail: "high" as const }))
    ];
    return validatePerceptionResult(await this.model.observe({ instructions: perceptionInstructions, content }));
  }
}

function validatePerceptionResult(value: unknown): PerceptionModelResult {
  if (!value || typeof value !== "object") throw new Error("Perception model returned an invalid structured result.");
  const result = value as Partial<PerceptionModelResult>;
  if (!Array.isArray(result.visualFindings) || !Array.isArray(result.symptomFindings) || !Array.isArray(result.uncertainties)) throw new Error("Perception model result is missing required observation fields.");
  const visualFindings = result.visualFindings.map(finding => {
    if (!finding || typeof finding.finding !== "string" || typeof finding.confidence !== "number" || !Number.isFinite(finding.confidence) || finding.confidence < 0 || finding.confidence > 1) throw new Error("Perception model produced an invalid finding.");
    return { finding: finding.finding, confidence: finding.confidence, uncertainty: typeof finding.uncertainty === "string" ? finding.uncertainty : "Uncertainty was not provided." };
  });
  const allText = [...visualFindings.map(f => f.finding), ...result.symptomFindings, ...result.uncertainties];
  if (!allText.every(value => typeof value === "string")) throw new Error("Perception model result must contain text-only findings.");
  if (allText.some(containsTreatmentLanguage)) throw new Error("Perception model result contained prohibited treatment or dosage language.");
  return { visualFindings, symptomFindings: result.symptomFindings, uncertainties: result.uncertainties };
}

// Blocks concrete, unambiguous treatment/product/dosage identifiers only (mirrors the same,
// already-narrowed pattern used by RealAdversarialReviewerAgent). Generic verbs like "recommend",
// "apply", "spray", "treatment", and "intervention" are deliberately NOT blocked here — they are
// ordinary words that can legitimately appear in a factual visual/symptom observation (e.g. a
// farmer's own field notes mentioning fertilizer application) without the model itself proposing
// any treatment. The real risk signal is a specific chemical/product name, a dosage, or a
// concentration unit, all of which remain blocked below.
function containsTreatmentLanguage(value: string): boolean {
  return /\b(dosage|dose|\d+(?:\.\d+)?\s*(?:ml|l|lit(?:re|er)s?|g|kg|ppm)|fungicide|pesticide|herbicide|insecticide|chemical|mancozeb|copper(?:\s+sulfate)?|sulfur|neem)\b/i.test(value);
}

// Some OpenRouter-hosted free models wrap otherwise-valid structured-output JSON in a Markdown code
// fence (e.g. "```json\n{...}\n```") despite response_format: json_schema being requested. Strip an
// optional fence before parsing; the underlying JSON payload and all downstream validation are
// unchanged.
function extractJsonPayload(text: string): string {
  const fenced = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : text;
}

// Some OpenRouter-hosted free models occasionally ignore response_format: json_schema entirely and
// reply with an unrelated plain-text message (e.g. "User Safety: safe") instead of the required
// perception_observations JSON. A raw JSON.parse on that text throws an uninformative SyntaxError
// that would otherwise leak as the production error. Convert that failure into a controlled,
// explicit PerceptionProviderFormatError instead — no findings are fabricated from the text, and a
// successful parse is still passed through to validatePerceptionResult unchanged.
function parsePerceptionJson(outputText: string): unknown {
  const candidate = extractJsonPayload(outputText);
  try {
    return JSON.parse(candidate);
  } catch {
    throw new PerceptionProviderFormatError(
      `Perception provider did not return the required structured JSON output (received: ${JSON.stringify(outputText.slice(0, 200))}).`
    );
  }
}
