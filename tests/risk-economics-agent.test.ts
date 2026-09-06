import assert from "node:assert/strict";
import test from "node:test";
import { ToolRiskEconomicsAgent } from "../src/agents/risk-economics-agent.ts";
import type { CaseState } from "../src/types/contracts.ts";
import type { EconomicData, EconomicTools } from "../src/tools/seeded-tools.ts";
import { tomatoSeed } from "../src/tools/seeded-tools.ts";

function state(): CaseState {
  return {
    case: { caseId: "CASE-1", farmId: "FARM-001", plotId: "PLOT-A", createdAt: "2026-09-06T08:00:00.000Z", language: "en", mode: "DECIDE" },
    farm: tomatoSeed.farm, environment: tomatoSeed.weather, history: tomatoSeed.history,
    observations: { farmerText: "spots are increasing", images: [], visualFindings: [{ finding: "dark leaf spots", confidence: 0.81 }], symptomFindings: ["leaf_spots", "increasing_affected_area"], uncertainties: ["Lab confirmation is unavailable."] },
    context: { retrievedFacts: { farm: [], environment: [], history: [] }, derivedContext: [], toolFlags: [], conflicts: [], ready: true },
    risk: { diseaseRisk: 0, weatherRisk: 0, cropStress: 0, overallRisk: "LOW", factors: [], flags: [] },
    economics: { source: "UNAVAILABLE", cropValue: null, expectedLoss: null, interventionCost: null, economicJustification: "", decisionGate: "SEEK_CONFIRMATION", flags: [] },
    safety: { deterministicChecks: [], violations: [], status: "PENDING" }, review: { verdict: "VETO", concerns: [], requiredChanges: [], cycleCount: 0 }, workflow: { current: "RISK_ECONOMICS", trace: ["RISK_ECONOMICS"], negativeConstraints: [] }
  };
}
function tool(data: EconomicData | undefined): EconomicTools {
  return { async getEconomicData() { return data; } };
}
const normal = { source: "SEEDED_DEMO" as const, currency: "INR" as const, cropValueInputs: [{ value: 240000, source: "seed" }], expectedLossInputs: [{ value: 4200, source: "seed" }], interventionCostInputs: [{ value: 800, source: "seed" }] };

test("Risk & Economics Agent produces deterministic high-risk tomato assessment from seeded demo inputs", async () => {
  const result = await new ToolRiskEconomicsAgent(tool(normal)).assess(state());
  assert.equal(result.risk.overallRisk, "HIGH");
  assert.ok(result.risk.factors.includes("reported leaf spots"));
  assert.equal(result.economics.source, "SEEDED_DEMO");
  assert.equal(result.economics.cropValue, 240000);
  assert.equal(result.economics.expectedLoss, 4200);
  assert.equal(result.economics.interventionCost, 800);
  assert.equal(result.economics.decisionGate, "INTERVENE");
  assert.match(result.economics.economicJustification, /Seeded demo values/);
});

test("Risk & Economics Agent gates to MONITOR when intervention cost exceeds expected loss", async () => {
  const data = { ...normal, expectedLossInputs: [{ value: 800, source: "seed" }], interventionCostInputs: [{ value: 1200, source: "seed" }] };
  const result = await new ToolRiskEconomicsAgent(tool(data)).assess(state());
  assert.equal(result.economics.decisionGate, "MONITOR");
  assert.match(result.economics.economicJustification, /monitor rather than intervene/i);
});

test("Risk & Economics Agent flags missing economic data without inventing values", async () => {
  const result = await new ToolRiskEconomicsAgent(tool(undefined)).assess(state());
  assert.equal(result.economics.decisionGate, "SEEK_CONFIRMATION");
  assert.equal(result.economics.cropValue, null);
  assert.equal(result.economics.flags[0].status, "MISSING");
});

test("Risk & Economics Agent flags conflicting economic inputs", async () => {
  const data = { ...normal, expectedLossInputs: [{ value: 4200, source: "estimate A" }, { value: 5100, source: "estimate B" }] };
  const result = await new ToolRiskEconomicsAgent(tool(data)).assess(state());
  assert.equal(result.economics.decisionGate, "SEEK_CONFIRMATION");
  assert.equal(result.economics.flags.find(flag => flag.field === "expectedLoss")?.status, "CONFLICTING");
});

test("Risk & Economics Agent flags invalid economic inputs", async () => {
  const data = { ...normal, interventionCostInputs: [{ value: -1, source: "bad input" }] };
  const result = await new ToolRiskEconomicsAgent(tool(data)).assess(state());
  assert.equal(result.economics.decisionGate, "SEEK_CONFIRMATION");
  assert.equal(result.economics.flags.find(flag => flag.field === "interventionCost")?.status, "INVALID");
});

test("Risk & Economics Agent preserves a failed economic tool as a confirmation gate", async () => {
  const failed: EconomicTools = { async getEconomicData() { throw new Error("economic service unavailable"); } };
  const result = await new ToolRiskEconomicsAgent(failed).assess(state());
  assert.equal(result.economics.decisionGate, "SEEK_CONFIRMATION");
  assert.equal(result.economics.flags[0].status, "FAILED");
  assert.match(result.economics.flags[0].detail ?? "", /economic service unavailable/);
});

test("Risk & Economics Agent preserves a timed-out economic tool as a confirmation gate", async () => {
  const slow: EconomicTools = { async getEconomicData() { await new Promise(resolve => setTimeout(resolve, 20)); return normal; } };
  const result = await new ToolRiskEconomicsAgent(slow, 1).assess(state());
  assert.equal(result.economics.decisionGate, "SEEK_CONFIRMATION");
  assert.equal(result.economics.flags[0].status, "TIMED_OUT");
});
