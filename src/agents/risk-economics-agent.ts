import type { CaseState, EconomicFlag, EconomicsAssessment, RiskAssessment } from "../types/contracts.ts";
import type { EconomicData, EconomicTools, EconomicValueInput } from "../tools/seeded-tools.ts";

export interface RiskEconomicsAgent { assess(state: CaseState): Promise<{ risk: RiskAssessment; economics: EconomicsAssessment }>; }

/** Deterministic assessment only. It never selects products, chemicals, dosages, or unprovided money values. */
export class ToolRiskEconomicsAgent implements RiskEconomicsAgent {
  private readonly economicsTool: EconomicTools;
  private readonly timeoutMs: number;
  constructor(economicsTool: EconomicTools, timeoutMs = 2_000) { this.economicsTool = economicsTool; this.timeoutMs = timeoutMs; }
  async assess(state: CaseState): Promise<{ risk: RiskAssessment; economics: EconomicsAssessment }> {
    const risk = assessRisk(state);
    let data: EconomicData | undefined;
    let failure: EconomicFlag | undefined;
    try { data = await withTimeout(() => this.economicsTool.getEconomicData({ farmId: state.case.farmId, plotId: state.case.plotId, crop: state.farm!.crop, cropStage: state.farm!.cropStage }), this.timeoutMs); }
    catch (error) { failure = { field: "economicData", status: error instanceof Error && error.message === "timeout" ? "TIMED_OUT" : "FAILED", detail: error instanceof Error ? error.message : "Unknown tool error" }; }
    return { risk, economics: assessEconomics(risk, data, failure) };
  }
}

function assessRisk(state: CaseState): RiskAssessment {
  const symptoms = state.observations.symptomFindings;
  const factors: string[] = [], flags = [...state.observations.uncertainties];
  const diseaseRisk = symptoms.includes("leaf_spots") ? (symptoms.includes("increasing_affected_area") ? 0.76 : 0.58) : 0.2;
  if (symptoms.includes("leaf_spots")) factors.push("reported leaf spots");
  if (symptoms.includes("increasing_affected_area")) factors.push("increasing affected area");
  const wetForecast = state.environment!.forecast.some(day => day.rainMm > 0 && day.humidity >= 80);
  const weatherRisk = state.environment!.humidity >= 80 || state.environment!.rainfallLast24h > 0 || wetForecast ? 0.82 : 0.25;
  if (weatherRisk >= 0.8) factors.push("humid or wet conditions");
  const cropStress = state.environment!.soilMoisture >= 70 ? 0.67 : state.environment!.soilMoisture <= 25 ? 0.6 : 0.2;
  if (cropStress >= 0.6) factors.push("soil moisture may be stressful");
  const maximum = Math.max(diseaseRisk, weatherRisk, cropStress);
  return { diseaseRisk, weatherRisk, cropStress, overallRisk: maximum >= 0.7 ? "HIGH" : maximum >= 0.4 ? "MEDIUM" : "LOW", factors, flags };
}

function assessEconomics(risk: RiskAssessment, data?: EconomicData, failure?: EconomicFlag): EconomicsAssessment {
  if (!data) return { source: "UNAVAILABLE", cropValue: null, expectedLoss: null, interventionCost: null, decisionGate: "SEEK_CONFIRMATION", economicJustification: "Economic inputs are unavailable; no monetary value was inferred.", flags: [failure ?? { field: "economicData", status: "MISSING", detail: "The economic tool returned no data." }] };
  const crop = readValue("cropValue", data.cropValueInputs);
  const loss = readValue("expectedLoss", data.expectedLossInputs);
  const cost = readValue("interventionCost", data.interventionCostInputs);
  const flags = [...crop.flags, ...loss.flags, ...cost.flags];
  if (flags.length) return { source: data.source, cropValue: crop.value, expectedLoss: loss.value, interventionCost: cost.value, decisionGate: "SEEK_CONFIRMATION", economicJustification: "Economic inputs are missing, invalid, or conflicting; no economic intervention conclusion was derived.", flags };
  const gate = risk.overallRisk === "LOW" ? "WAIT" : loss.value! > cost.value! ? "INTERVENE" : "MONITOR";
  const justification = gate === "INTERVENE"
    ? `${data.source === "SEEDED_DEMO" ? "Seeded demo values" : "Retrieved economic values"}: expected loss ₹${loss.value} exceeds intervention cost ₹${cost.value}.`
    : gate === "MONITOR" ? `Expected loss ₹${loss.value} does not exceed intervention cost ₹${cost.value}; monitor rather than intervene.`
    : "Current risk is low; wait and monitor rather than intervene.";
  return { source: data.source, cropValue: crop.value, expectedLoss: loss.value, interventionCost: cost.value, decisionGate: gate, economicJustification: justification, flags };
}
function readValue(field: EconomicFlag["field"], inputs?: EconomicValueInput[]): { value: number | null; flags: EconomicFlag[] } {
  if (!inputs?.length) return { value: null, flags: [{ field, status: "MISSING", detail: "No input was supplied." }] };
  if (inputs.some(input => !Number.isFinite(input.value) || input.value < 0)) return { value: null, flags: [{ field, status: "INVALID", detail: "Values must be finite non-negative amounts." }] };
  const values = [...new Set(inputs.map(input => input.value))];
  if (values.length !== 1) return { value: null, flags: [{ field, status: "CONFLICTING", detail: "Supplied sources disagree." }] };
  return { value: values[0], flags: [] };
}
async function withTimeout<T>(operation: () => Promise<T | undefined>, timeoutMs: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([operation(), new Promise<undefined>((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), timeoutMs); })]); }
  finally { if (timer) clearTimeout(timer); }
}
