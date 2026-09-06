import assert from "node:assert/strict";
import test from "node:test";
import { RealDecisionSynthesizerAgent, type DecisionSynthesizerModel } from "../src/agents/decision-synthesizer-agent.ts";
import { mockTools, tomatoSeed } from "../src/tools/seeded-tools.ts";
import type { CaseState, EconomicsAssessment, FieldContext } from "../src/types/contracts.ts";

function economics(overrides: Partial<EconomicsAssessment> = {}): EconomicsAssessment {
  return {
    source: "SEEDED_DEMO", cropValue: 240000, expectedLoss: 4200, interventionCost: 800,
    economicJustification: "Seeded demo values: expected loss ₹4200 exceeds intervention cost ₹800.",
    decisionGate: "INTERVENE", flags: [], ...overrides
  };
}

const readyContext: FieldContext = {
  retrievedFacts: { farm: ["location", "crop", "cropStage"], environment: ["temperature", "humidity", "forecast"], history: ["previousDecisions"] },
  derivedContext: [],
  toolFlags: [
    { tool: "farm.get_state", status: "RETRIEVED" },
    { tool: "weather.get_forecast", status: "RETRIEVED" },
    { tool: "farm.get_history", status: "RETRIEVED" }
  ],
  conflicts: [],
  ready: true
};

function baseState(overrides: Partial<CaseState> = {}): CaseState {
  return {
    case: { caseId: "CASE-1", farmId: "FARM-001", plotId: "PLOT-A", createdAt: "2026-09-06T08:00:00.000Z", language: "en", mode: "DECIDE" },
    farm: tomatoSeed.farm,
    observations: { farmerText: "spots are increasing", images: [], visualFindings: [{ finding: "dark leaf spots", confidence: 0.81 }], symptomFindings: ["leaf_spots", "increasing_affected_area"], uncertainties: ["Lab confirmation is unavailable."] },
    environment: tomatoSeed.weather,
    history: tomatoSeed.history,
    context: readyContext,
    risk: { diseaseRisk: 0.76, weatherRisk: 0.82, cropStress: 0.2, overallRisk: "HIGH", factors: ["reported leaf spots", "increasing affected area", "humid or wet conditions"], flags: ["Lab confirmation is unavailable."] },
    economics: economics(),
    safety: { deterministicChecks: [], violations: [], status: "PENDING" },
    review: { verdict: "VETO", concerns: [], requiredChanges: [], cycleCount: 0 },
    workflow: { current: "SYNTHESIS", trace: ["SYNTHESIS"], negativeConstraints: [] },
    ...overrides
  };
}

function neverCalledModel(): DecisionSynthesizerModel {
  return { async synthesize() { throw new Error("The model boundary must not be called for this case."); } };
}

test("successful synthesis: proposes a vetted intervention from valid model output", async () => {
  const model: DecisionSynthesizerModel = {
    async synthesize(request) {
      return {
        action: "BIOLOGICAL_INTERVENTION",
        interventionId: "TOM-BIO-001",
        reason: "Seeded symptoms and risk indicate a potential biological intervention after checks.",
        reasoningSummary: "This remains a proposal that requires deterministic safety approval.",
        evidence: request.state.risk.factors,
        confidence: 0.8,
        constraints: request.state.negativeConstraints,
        uncertainties: request.state.risk.flags,
        missingData: []
      };
    }
  };
  const proposal = await new RealDecisionSynthesizerAgent(model, mockTools).propose(baseState());
  assert.equal(proposal.action, "BIOLOGICAL_INTERVENTION");
  assert.equal(proposal.interventionId, "TOM-BIO-001");
  assert.equal(proposal.confidence, 0.8);
});

test("missing context: returns a safe confirmation without calling the model when context is not ready", async () => {
  const state = baseState({
    context: { retrievedFacts: { farm: [], environment: [], history: [] }, derivedContext: [], toolFlags: [{ tool: "weather.get_forecast", status: "MISSING" }], conflicts: [], ready: false }
  });
  const proposal = await new RealDecisionSynthesizerAgent(neverCalledModel(), mockTools).propose(state);
  assert.equal(proposal.action, "SEEK_EXPERT_CONFIRMATION");
  assert.ok(proposal.missingData.length > 0);
});

test("conflicting context: returns a safe confirmation without calling the model when facts conflict", async () => {
  const state = baseState({
    context: {
      retrievedFacts: { farm: ["location"], environment: ["temperature"], history: ["previousDecisions"] },
      derivedContext: [],
      toolFlags: [{ tool: "farm.get_state", status: "CONFLICTING" }, { tool: "weather.get_forecast", status: "CONFLICTING" }, { tool: "farm.get_history", status: "RETRIEVED" }],
      conflicts: [{ field: "soilMoisture", farmValue: 60, weatherValue: 74 }],
      ready: false
    }
  });
  const proposal = await new RealDecisionSynthesizerAgent(neverCalledModel(), mockTools).propose(state);
  assert.equal(proposal.action, "SEEK_EXPERT_CONFIRMATION");
  assert.ok(proposal.missingData.some(item => item.includes("Conflicting field context: soilMoisture")));
});

test("negative constraint compliance: rejects a model proposal that drops a required constraint", async () => {
  const model: DecisionSynthesizerModel = {
    async synthesize() {
      return { action: "MONITOR", interventionId: null, reason: "Continue monitoring.", reasoningSummary: "No constraint carried forward.", evidence: [], confidence: 0.5, constraints: [], uncertainties: [], missingData: [] };
    }
  };
  const state = baseState({ workflow: { current: "SYNTHESIS", trace: ["SYNTHESIS"], negativeConstraints: ["Do not recommend foliar intervention during the current rain window."] } });
  await assert.rejects(() => new RealDecisionSynthesizerAgent(model, mockTools).propose(state), /omitted a reviewer negative constraint/);
});

test("invented treatment rejection: rejects a model proposal naming a chemical, product, or dosage", async () => {
  const model: DecisionSynthesizerModel = {
    async synthesize() {
      return { action: "MONITOR", interventionId: null, reason: "Apply 2 ml of copper fungicide per litre.", reasoningSummary: "ok", evidence: [], confidence: 0.7, constraints: [], uncertainties: [], missingData: [] };
    }
  };
  await assert.rejects(() => new RealDecisionSynthesizerAgent(model, mockTools).propose(baseState()), /prohibited treatment, product, or dosage language/);
});

test("WAIT gate: proposes WAIT_FOR_SAFE_WEATHER_WINDOW deterministically, without calling the model", async () => {
  const state = baseState({ economics: economics({ decisionGate: "WAIT", economicJustification: "Current risk is low; wait and monitor rather than intervene." }) });
  const proposal = await new RealDecisionSynthesizerAgent(neverCalledModel(), mockTools).propose(state);
  assert.equal(proposal.action, "WAIT_FOR_SAFE_WEATHER_WINDOW");
});

test("MONITOR gate: proposes MONITOR deterministically, without calling the model", async () => {
  const state = baseState({ economics: economics({ decisionGate: "MONITOR", economicJustification: "Expected loss does not exceed intervention cost; monitor rather than intervene." }) });
  const proposal = await new RealDecisionSynthesizerAgent(neverCalledModel(), mockTools).propose(state);
  assert.equal(proposal.action, "MONITOR");
});

test("invalid intervention id: rejects an intervention id outside the vetted knowledge boundary", async () => {
  const model: DecisionSynthesizerModel = {
    async synthesize() {
      return { action: "BIOLOGICAL_INTERVENTION", interventionId: "TOM-BIO-999", reason: "ok", reasoningSummary: "ok", evidence: [], confidence: 0.7, constraints: [], uncertainties: [], missingData: [] };
    }
  };
  await assert.rejects(() => new RealDecisionSynthesizerAgent(model, mockTools).propose(baseState()), /outside the vetted knowledge boundary/);
});

test("invalid model output: rejects a structurally invalid response instead of guessing", async () => {
  const model: DecisionSynthesizerModel = { async synthesize() { return { action: "NOT_A_REAL_ACTION" }; } };
  await assert.rejects(() => new RealDecisionSynthesizerAgent(model, mockTools).propose(baseState()), /invalid structured proposal/);
});
