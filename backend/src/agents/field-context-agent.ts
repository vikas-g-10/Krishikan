import type { ContextConflict, ContextToolFlag, EnvironmentState, FarmHistory, FarmState, FieldContext } from "../types/contracts.ts";
import type { FarmTools, WeatherTools } from "../tools/seeded-tools.ts";

export interface FieldContextResult {
  farm: FarmState | null;
  environment: EnvironmentState | null;
  history: FarmHistory | null;
  context: FieldContext;
}

export interface FieldContextAgent {
  retrieve(input: { farmId: string; plotId: string; now: Date }): Promise<FieldContextResult>;
}

/** Deterministic retrieval only: missing or inconsistent facts remain explicit, never inferred. */
export class ToolFieldContextAgent implements FieldContextAgent {
  private readonly farm: FarmTools;
  private readonly weather: WeatherTools;
  private readonly timeoutMs: number;

  constructor(farm: FarmTools, weather: WeatherTools, timeoutMs = 2_000) {
    this.farm = farm;
    this.weather = weather;
    this.timeoutMs = timeoutMs;
  }

  async retrieve(input: { farmId: string; plotId: string; now: Date }): Promise<FieldContextResult> {
    const toDate = input.now.toISOString();
    const fromDate = new Date(input.now.getTime() - 90 * 24 * 60 * 60 * 1_000).toISOString();
    const [farmResult, historyResult] = await Promise.all([
      settle(() => this.farm.getState(input.farmId, input.plotId), this.timeoutMs),
      settle(() => this.farm.getHistory(input.farmId, input.plotId, fromDate, toDate), this.timeoutMs)
    ]);
    const flags: ContextToolFlag[] = [toFlag("farm.get_state", farmResult), toFlag("farm.get_history", historyResult)];
    const farm = farmResult.value ?? null;
    const history = historyResult.value ?? null;
    let environment: EnvironmentState | null = null;
    if (!farm) {
      flags.push({ tool: "weather.get_forecast", status: "SKIPPED", detail: "Farm location was unavailable." });
    } else {
      const weatherResult = await settle(() => this.weather.getForecast(farm.location, toDate, 72), this.timeoutMs);
      flags.push(toFlag("weather.get_forecast", weatherResult));
      environment = weatherResult.value ?? null;
    }
    const conflicts = findConflicts(farm, environment);
    if (conflicts.length) {
      for (const flag of flags) if (flag.status === "RETRIEVED" && (flag.tool === "farm.get_state" || flag.tool === "weather.get_forecast")) flag.status = "CONFLICTING";
    }
    const retrievedFacts = {
      farm: farm ? ["location", "crop", "variety", "acreage", "sowingDate", "cropStage", ...(farm.soilMetrics ? ["soilMetrics"] : [])] : [],
      environment: environment ? ["temperature", "humidity", "rainfallLast24h", "soilMoisture", "soilMetrics", "forecast"] : [],
      history: history ? ["previousDecisions", "previousInterventions", "previousOutcomes"] : []
    };
    return { farm, environment, history, context: { retrievedFacts, derivedContext: [], toolFlags: flags, conflicts, ready: Boolean(farm && environment && history) && conflicts.length === 0 } };
  }
}

type Settled<T> = { value?: T; status: "RETRIEVED" | "MISSING" | "FAILED" | "TIMED_OUT"; detail?: string };
async function settle<T>(operation: () => Promise<T | undefined>, timeoutMs: number): Promise<Settled<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      operation(),
      new Promise<undefined>((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), timeoutMs); })
    ]);
    return value === undefined ? { status: "MISSING", detail: "The tool returned no data." } : { value, status: "RETRIEVED" };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown tool error";
    return { status: detail === "timeout" ? "TIMED_OUT" : "FAILED", detail };
  } finally { if (timer) clearTimeout(timer); }
}
function toFlag(tool: ContextToolFlag["tool"], result: Settled<unknown>): ContextToolFlag { return { tool, status: result.status, detail: result.detail }; }
function findConflicts(farm: FarmState | null, weather: EnvironmentState | null): ContextConflict[] {
  if (!farm?.soilMetrics || !weather) return [];
  return Object.entries(farm.soilMetrics).flatMap(([field, farmValue]) => {
    const weatherValue = weather.soilMetrics[field];
    return weatherValue !== undefined && weatherValue !== farmValue ? [{ field, farmValue, weatherValue }] : [];
  });
}
