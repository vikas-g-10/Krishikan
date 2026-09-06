import assert from "node:assert/strict";
import test from "node:test";
import { ToolFieldContextAgent } from "../src/agents/field-context-agent.ts";
import { mockTools, tomatoSeed, type FarmTools, type WeatherTools } from "../src/tools/seeded-tools.ts";

const now = new Date("2026-09-06T08:00:00.000Z");

function tools(overrides: Partial<FarmTools & WeatherTools> = {}): { farm: FarmTools; weather: WeatherTools } {
  const farm: FarmTools = {
    async getState() { return tomatoSeed.farm; },
    async getHistory() { return tomatoSeed.history; },
    ...overrides
  };
  const weather: WeatherTools = {
    async getForecast() { return tomatoSeed.weather; },
    ...overrides
  };
  return { farm, weather };
}

test("Field Context Agent retrieves farm, weather, and history facts through tool boundaries", async () => {
  const { farm, weather } = tools();
  const result = await new ToolFieldContextAgent(farm, weather).retrieve({ farmId: "FARM-001", plotId: "PLOT-A", now });
  assert.equal(result.context.ready, true);
  assert.equal(result.farm?.cropStage, "FLOWERING");
  assert.equal(result.environment?.temperature, 26);
  assert.deepEqual(result.environment?.soilMetrics, { soilMoisture: 74 });
  assert.deepEqual(result.history?.previousDecisions, ["MONITOR: 2026-09-01"]);
  assert.deepEqual(result.context.derivedContext, []);
  assert.deepEqual(result.context.toolFlags.map(flag => flag.status), ["RETRIEVED", "RETRIEVED", "RETRIEVED"]);
});

test("Field Context Agent flags missing weather instead of inventing environmental data", async () => {
  const { farm, weather } = tools({ async getForecast() { return undefined; } });
  const result = await new ToolFieldContextAgent(farm, weather).retrieve({ farmId: "FARM-001", plotId: "PLOT-A", now });
  assert.equal(result.environment, null);
  assert.equal(result.context.ready, false);
  assert.equal(result.context.toolFlags.find(flag => flag.tool === "weather.get_forecast")?.status, "MISSING");
});

test("Field Context Agent flags conflicting retrieved soil metrics", async () => {
  const { farm, weather } = tools({
    async getState() { return { ...tomatoSeed.farm, soilMetrics: { soilMoisture: 60 } }; },
    async getForecast() { return tomatoSeed.weather; }
  });
  const result = await new ToolFieldContextAgent(farm, weather).retrieve({ farmId: "FARM-001", plotId: "PLOT-A", now });
  assert.equal(result.context.ready, false);
  assert.deepEqual(result.context.conflicts, [{ field: "soilMoisture", farmValue: 60, weatherValue: 74 }]);
  assert.equal(result.context.toolFlags.find(flag => flag.tool === "farm.get_state")?.status, "CONFLICTING");
});

test("Field Context Agent flags a tool failure without manufacturing farm history", async () => {
  const { farm, weather } = tools({ async getHistory() { throw new Error("history service unavailable"); } });
  const result = await new ToolFieldContextAgent(farm, weather).retrieve({ farmId: "FARM-001", plotId: "PLOT-A", now });
  assert.equal(result.history, null);
  assert.equal(result.context.ready, false);
  const historyFlag = result.context.toolFlags.find(flag => flag.tool === "farm.get_history");
  assert.equal(historyFlag?.status, "FAILED");
  assert.match(historyFlag?.detail ?? "", /history service unavailable/);
});

test("Field Context Agent flags a timed-out tool without manufacturing weather data", async () => {
  const { farm, weather } = tools({ async getForecast() {
    await new Promise(resolve => setTimeout(resolve, 20));
    return tomatoSeed.weather;
  } });
  const result = await new ToolFieldContextAgent(farm, weather, 1).retrieve({ farmId: "FARM-001", plotId: "PLOT-A", now });
  assert.equal(result.environment, null);
  assert.equal(result.context.toolFlags.find(flag => flag.tool === "weather.get_forecast")?.status, "TIMED_OUT");
});

// Integration coverage against the actual seeded `mockTools` (as wired by createDefaultOrchestrator
// and the /api/v1/demo/tomato endpoint), rather than the local test doubles above, so the demo's
// real tool boundary — not just the Field Context Agent's own logic — is proven to retrieve the
// seeded Kolar tomato farm context.

test("seeded mockTools: FARM-001/PLOT-A retrieves the seeded Kolar tomato farm, weather, and history, and context becomes ready", async () => {
  const result = await new ToolFieldContextAgent(mockTools, mockTools).retrieve({ farmId: "FARM-001", plotId: "PLOT-A", now });
  assert.equal(result.farm?.location, "Kolar, Karnataka");
  assert.equal(result.farm?.crop, "tomato");
  assert.equal(result.farm?.variety, "Arka Vikas");
  assert.equal(result.farm?.acreage, 1);
  assert.equal(result.farm?.sowingDate, "2026-07-01");
  assert.equal(result.farm?.cropStage, "FLOWERING");
  assert.equal(result.environment?.temperature, 26);
  assert.equal(result.environment?.humidity, 88);
  assert.equal(result.environment?.rainfallLast24h, 18);
  assert.equal(result.environment?.soilMoisture, 74);
  assert.ok(Array.isArray(result.environment?.forecast) && result.environment.forecast.length > 0);
  assert.deepEqual(result.history?.previousDecisions, ["MONITOR: 2026-09-01"]);
  assert.deepEqual(result.history?.previousOutcomes, ["Leaf spots increased after three wet days."]);
  assert.equal(result.context.ready, true);
  assert.equal(result.context.conflicts.length, 0);
  assert.deepEqual(result.context.toolFlags.map(flag => flag.status), ["RETRIEVED", "RETRIEVED", "RETRIEVED"]);
});

test("seeded mockTools: an unknown farm/plot ID returns missing data rather than the seeded farm being invented for it", async () => {
  const result = await new ToolFieldContextAgent(mockTools, mockTools).retrieve({ farmId: "FARM-999", plotId: "PLOT-Z", now });
  assert.equal(result.farm, null);
  assert.equal(result.history, null);
  // No farm location was resolved, so the weather call is skipped rather than guessed.
  assert.equal(result.environment, null);
  assert.equal(result.context.ready, false);
  assert.equal(result.context.toolFlags.find(flag => flag.tool === "farm.get_state")?.status, "MISSING");
  assert.equal(result.context.toolFlags.find(flag => flag.tool === "farm.get_history")?.status, "MISSING");
  assert.equal(result.context.toolFlags.find(flag => flag.tool === "weather.get_forecast")?.status, "SKIPPED");
});
