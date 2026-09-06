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

function containsTreatmentLanguage(value: string): boolean {
  return /\b(recommend|prescribe|apply|spray|treat(?:ment)?|intervention|dosage|dose|\d+(?:\.\d+)?\s*(?:ml|l|lit(?:re|er)s?|g|kg|ppm)|fungicide|pesticide|herbicide|insecticide|chemical|mancozeb|copper(?:\s+sulfate)?|sulfur|neem)\b/i.test(value);
}
