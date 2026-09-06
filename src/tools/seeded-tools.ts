import type { EnvironmentState, FarmHistory, FarmState, Intervention } from "../types/contracts.ts";

export const tomatoSeed = {
  farm: { location: "Kolar, Karnataka", crop: "tomato" as const, variety: "Arka Vikas", acreage: 1, sowingDate: "2026-07-01", cropStage: "FLOWERING" } satisfies FarmState,
  weather: { temperature: 26, humidity: 88, rainfallLast24h: 18, soilMoisture: 74, soilMetrics: { soilMoisture: 74 }, forecast: [{ date: "2026-09-07", rainMm: 12, humidity: 90 }, { date: "2026-09-08", rainMm: 8, humidity: 86 }] } satisfies EnvironmentState,
  history: { previousDecisions: ["MONITOR: 2026-09-01"], previousInterventions: [], previousOutcomes: ["Leaf spots increased after three wet days."] },
  marketPricePerKg: 24,
  expectedYieldKgPerAcre: 10000
};

const interventions: Intervention[] = [
  { id: "TOM-BIO-001", label: "Approved seeded biological foliar intervention", action: "BIOLOGICAL_INTERVENTION", foliar: true, compatibleStages: ["FLOWERING", "FRUITING"], costPerAcre: 800 }
];

export interface FarmTools {
  getState(farmId: string, plotId: string): Promise<FarmState | undefined>;
  getHistory(farmId: string, plotId: string, fromDate: string, toDate: string): Promise<FarmHistory | undefined>;
}
export interface WeatherTools { getForecast(location: string, startTime: string, hours: number): Promise<EnvironmentState | undefined>; }
export interface AgricultureTools {
  getIntervention(id: string): Promise<Intervention | undefined>;
  /** This is the only boundary that may supply concrete intervention identifiers. */
  getAvailableInterventions(crop: string, cropStage: string): Promise<Intervention[]>;
}
export interface EconomicValueInput { value: number; source: string; }
/** Values from this boundary must state their origin. Seeded data is never live market data. */
export interface EconomicData {
  source: "SEEDED_DEMO" | "LIVE";
  currency: "INR";
  cropValueInputs?: EconomicValueInput[];
  expectedLossInputs?: EconomicValueInput[];
  interventionCostInputs?: EconomicValueInput[];
}
export interface EconomicTools { getEconomicData(input: { farmId: string; plotId: string; crop: string; cropStage: string }): Promise<EconomicData | undefined>; }

export const mockTools: FarmTools & WeatherTools & AgricultureTools & EconomicTools = {
  async getState() { return tomatoSeed.farm; }, async getHistory() { return tomatoSeed.history; },
  async getForecast() { return tomatoSeed.weather; }, async getIntervention(id) { return interventions.find(x => x.id === id); },
  async getAvailableInterventions(crop, cropStage) { return crop === "tomato" ? interventions.filter(item => item.compatibleStages.includes(cropStage)) : []; },
  async getEconomicData() { return {
    source: "SEEDED_DEMO", currency: "INR",
    cropValueInputs: [{ value: tomatoSeed.expectedYieldKgPerAcre * tomatoSeed.marketPricePerKg, source: "seeded tomato yield × seeded demo price" }],
    expectedLossInputs: [{ value: 4200, source: "seeded demo loss scenario" }],
    interventionCostInputs: [{ value: 800, source: "seeded vetted-intervention cost" }]
  }; }
};
