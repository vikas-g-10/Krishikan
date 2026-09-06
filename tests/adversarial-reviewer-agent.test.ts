import assert from "node:assert/strict";
import test from "node:test";
import { RealAdversarialReviewerAgent, type DecisionReviewerModel, type DecisionReviewerRequest } from "../src/agents/adversarial-reviewer-agent.ts";
import { tomatoSeed } from "../src/tools/seeded-tools.ts";
import type { CaseState, EconomicsAssessment, FieldContext, ProposedDecision, SafetyCheck } from "../src/types/contracts.ts";

// These tests exercise RealAdversarialReviewerAgent directly against a fake DecisionReviewerModel.
// No network call is ever made and OPENAI_API_KEY is never read: OpenAIResponsesDecisionReviewerModel
// (the only place that touches fetch or process.env) is never constructed here, mirroring how the
// real Perception Agent and Decision Synthesizer are tested with fake model boundaries elsewhere.

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

function proposal(overrides: Partial<ProposedDecision> = {}): ProposedDecision {
  return {
    action: "BIOLOGICAL_INTERVENTION",
    interventionId: "TOM-BIO-001",
    reason: "Seeded symptoms and risk indicate a potential biological intervention after checks.",
    reasoningSummary: "This remains a proposal that requires deterministic safety approval.",
    evidence: ["leaf spots", "high humidity", "economic threshold crossed"],
    confidence: 0.81,
    constraints: [],
    uncertainties: ["Lab confirmation is unavailable."],
    missingData: [],
    ...overrides
  };
}

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
    proposedDecision: proposal(),
    safety: { deterministicChecks: [], violations: [], status: "PASS" },
    review: { verdict: "VETO", concerns: [], requiredChanges: [], cycleCount: 0 },
    workflow: { current: "REVIEW", trace: ["REVIEW"], negativeConstraints: [] },
    ...overrides
  };
}

function neverCalledModel(): DecisionReviewerModel {
  return { async review() { throw new Error("The model boundary must not be called for this case."); } };
}

function approveModel(): DecisionReviewerModel {
  return { async review() { return { verdict: "APPROVE", concerns: [], requiredChanges: [] }; } };
}

// 1. Valid proposal → APPROVE
test("valid proposal: approves when safety passes, evidence is present, and the model concurs", async () => {
  const review = await new RealAdversarialReviewerAgent(approveModel()).review(baseState());
  assert.equal(review.verdict, "APPROVE");
  assert.deepEqual(review.concerns, []);
  assert.deepEqual(review.requiredChanges, []);
  assert.equal(review.cycleCount, 0);
});

// 2. Unsupported proposal → VETO (a soft, model-judged insufficiency, not caught by a hard backstop)
test("unsupported proposal: the model vetoes a proposal it judges insufficiently supported", async () => {
  const model: DecisionReviewerModel = {
    async review(request) {
      if (request.state.proposal.confidence < 0.85) {
        return { verdict: "VETO", concerns: ["Confidence is too low to justify an intervention on this evidence."], requiredChanges: ["Gather stronger evidence before proposing an intervention."] };
      }
      return { verdict: "APPROVE", concerns: [], requiredChanges: [] };
    }
  };
  const review = await new RealAdversarialReviewerAgent(model).review(baseState());
  assert.equal(review.verdict, "VETO");
  assert.ok(review.concerns.length > 0);
  assert.ok(review.requiredChanges.length > 0);
});

// 3. Safety Engine BLOCKED → VETO, deterministically, without ever calling the model
test("safety engine BLOCKED: deterministically vetoes without calling the model", async () => {
  const violations: SafetyCheck[] = [{ ruleId: "WX-001", passed: false, severity: "HIGH", reason: "Rain is expected during the foliar intervention window." }];
  const state = baseState({ safety: { deterministicChecks: violations, violations, status: "BLOCKED" } });
  const review = await new RealAdversarialReviewerAgent(neverCalledModel()).review(state);
  assert.equal(review.verdict, "VETO");
  assert.deepEqual(review.concerns, ["Rain is expected during the foliar intervention window."]);
  assert.ok(review.requiredChanges[0].includes("WX-001"));
});

// 4. Negative constraint violation → VETO, deterministically, without calling the model
test("negative constraint violation: deterministically vetoes a proposal that drops an active constraint", async () => {
  const state = baseState({
    workflow: { current: "REVIEW", trace: ["REVIEW"], negativeConstraints: ["Do not recommend foliar intervention during the current rain window."] },
    proposedDecision: proposal({ action: "MONITOR", interventionId: undefined, evidence: ["seeded justification"], constraints: [] })
  });
  const review = await new RealAdversarialReviewerAgent(neverCalledModel()).review(state);
  assert.equal(review.verdict, "VETO");
  assert.ok(review.concerns.some(concern => concern.includes("does not honor an existing negative constraint")));
});

// 5. Weather conflict → VETO, using the environment/forecast data passed through the model request
test("weather conflict: the model vetoes when the forecast conflicts with the proposed foliar action", async () => {
  let seenForecast: unknown;
  const model: DecisionReviewerModel = {
    async review(request: DecisionReviewerRequest) {
      seenForecast = request.state.environment.forecast;
      const rainExpected = request.state.environment.forecast.some(day => day.rainMm > 0);
      if (rainExpected && request.state.proposal.action === "BIOLOGICAL_INTERVENTION") {
        return { verdict: "VETO", concerns: ["Forecast rain conflicts with the foliar intervention window."], requiredChanges: ["Wait for a dry forecast window before proposing this intervention."] };
      }
      return { verdict: "APPROVE", concerns: [], requiredChanges: [] };
    }
  };
  const review = await new RealAdversarialReviewerAgent(model).review(baseState());
  assert.equal(review.verdict, "VETO");
  assert.deepEqual(seenForecast, tomatoSeed.weather.forecast);
  assert.ok(review.concerns[0].toLowerCase().includes("rain"));
});

// 6. Crop-stage conflict → VETO, using the farm state passed through the model request
test("crop-stage conflict: the model vetoes when the reported crop stage does not fit the intervention", async () => {
  const state = baseState({ farm: { ...tomatoSeed.farm, cropStage: "SEEDLING" } });
  const model: DecisionReviewerModel = {
    async review(request: DecisionReviewerRequest) {
      if (request.state.farm.cropStage === "SEEDLING") {
        return { verdict: "VETO", concerns: ["The reported crop stage does not match a stage compatible with this intervention."], requiredChanges: ["Confirm crop-stage compatibility before proposing this intervention."] };
      }
      return { verdict: "APPROVE", concerns: [], requiredChanges: [] };
    }
  };
  const review = await new RealAdversarialReviewerAgent(model).review(state);
  assert.equal(review.verdict, "VETO");
  assert.ok(review.concerns[0].toLowerCase().includes("crop stage"));
});

// 7. Economic inconsistency → VETO, using the economics assessment passed through the model request
test("economic inconsistency: the model vetoes when intervention cost exceeds expected loss", async () => {
  const state = baseState({ economics: economics({ interventionCost: 5000, expectedLoss: 1000, economicJustification: "Intervention cost of ₹5000 exceeds expected loss of ₹1000." }) });
  const model: DecisionReviewerModel = {
    async review(request: DecisionReviewerRequest) {
      const { interventionCost, expectedLoss } = request.state.economics;
      if (interventionCost !== null && expectedLoss !== null && interventionCost > expectedLoss) {
        return { verdict: "VETO", concerns: ["Intervention cost exceeds expected loss; the economics do not justify this action."], requiredChanges: ["Re-run the economics or propose a lower-cost action."] };
      }
      return { verdict: "APPROVE", concerns: [], requiredChanges: [] };
    }
  };
  const review = await new RealAdversarialReviewerAgent(model).review(state);
  assert.equal(review.verdict, "VETO");
  assert.ok(review.concerns[0].toLowerCase().includes("exceeds expected loss"));
});

// 8a. Legitimate critique using a generic verb like "recommend" must NOT be rejected as invented
// treatment language: the reviewer's job is to critique proposals in prose, and phrases like "should
// not recommend this intervention" name no chemical, product, category, or dosage.
test("legitimate critique language: a concern using \"recommend\" without naming a concrete treatment is not rejected", async () => {
  const model: DecisionReviewerModel = {
    async review() {
      return {
        verdict: "VETO",
        concerns: ["The proposal should not recommend this intervention because the evidence is insufficient."],
        requiredChanges: ["Withdraw the recommendation and gather additional evidence before proposing an intervention."]
      };
    }
  };
  const review = await new RealAdversarialReviewerAgent(model).review(baseState());
  assert.equal(review.verdict, "VETO");
  assert.ok(review.concerns[0].includes("recommend"));
  assert.ok(review.requiredChanges[0].toLowerCase().includes("recommendation"));
});

// 8b. Invented treatment/product/dosage language from the model → rejected, never surfaced as a verdict
test("invented treatment language: rejects a model result naming a chemical, product, or dosage", async () => {
  const model: DecisionReviewerModel = {
    async review() {
      return { verdict: "VETO", concerns: ["The proposal is unsupported."], requiredChanges: ["Apply 2 ml of copper fungicide per litre before approving."] };
    }
  };
  await assert.rejects(() => new RealAdversarialReviewerAgent(model).review(baseState()), /prohibited treatment, product, or dosage language/);
});

// 9. Invalid model output → rejected, never coerced into a guessed verdict
test("invalid model output: rejects a structurally invalid or unjustified response instead of guessing", async () => {
  const badVerdict: DecisionReviewerModel = { async review() { return { verdict: "MAYBE", concerns: [], requiredChanges: [] }; } };
  await assert.rejects(() => new RealAdversarialReviewerAgent(badVerdict).review(baseState()), /invalid structured result/);

  const unjustifiedVeto: DecisionReviewerModel = { async review() { return { verdict: "VETO", concerns: [], requiredChanges: [] }; } };
  await assert.rejects(() => new RealAdversarialReviewerAgent(unjustifiedVeto).review(baseState()), /vetoed without concrete concerns/);
});

// 10. Missing evidence → VETO, deterministically, without calling the model
test("missing evidence: deterministically vetoes an intervention proposal with no supporting evidence", async () => {
  const state = baseState({ proposedDecision: proposal({ evidence: [] }) });
  const review = await new RealAdversarialReviewerAgent(neverCalledModel()).review(state);
  assert.equal(review.verdict, "VETO");
  assert.ok(review.concerns.some(concern => concern.includes("cites no supporting evidence")));
});

// 11. Trusted negative-constraint text must NOT cause a false-positive treatment-language veto
test("trusted negative-constraint text does not trigger a false-positive treatment-language veto", async () => {
  const constraint = "Do not recommend foliar intervention during the current rain window.";
  const state = baseState({
    workflow: { current: "REVIEW", trace: ["REVIEW"], negativeConstraints: [constraint] },
    proposedDecision: proposal({ action: "WAIT_FOR_SAFE_WEATHER_WINDOW", interventionId: undefined, evidence: ["WX-001 constraint", "high humidity"], constraints: [constraint] })
  });
  const review = await new RealAdversarialReviewerAgent(approveModel()).review(state);
  assert.equal(review.verdict, "APPROVE");
  assert.deepEqual(review.concerns, []);
});

// 12. Existing tomato scenario remains compatible: the blocked-then-safe replan cycle still holds
test("tomato scenario compatibility: blocked-then-safe cycle matches the deterministic reviewer contract", async () => {
  const wxViolation: SafetyCheck = { ruleId: "WX-001", passed: false, severity: "HIGH", reason: "Rain is expected during the foliar intervention window." };
  const blockedState = baseState({ safety: { deterministicChecks: [wxViolation], violations: [wxViolation], status: "BLOCKED" } });
  const firstReview = await new RealAdversarialReviewerAgent(neverCalledModel()).review(blockedState);
  assert.equal(firstReview.verdict, "VETO");

  const safeState = baseState({
    workflow: { current: "REVIEW", trace: ["REVIEW"], negativeConstraints: firstReview.requiredChanges },
    proposedDecision: proposal({
      action: "WAIT_FOR_SAFE_WEATHER_WINDOW",
      interventionId: undefined,
      reason: "Rain makes the current foliar window unsuitable; reassess after the wet forecast.",
      evidence: ["WX-001 constraint", "high humidity", "increasing leaf spots"],
      constraints: firstReview.requiredChanges
    }),
    safety: { deterministicChecks: [], violations: [], status: "PASS" },
    review: { verdict: "VETO", concerns: [], requiredChanges: [], cycleCount: 1 }
  });
  const secondReview = await new RealAdversarialReviewerAgent(approveModel()).review(safeState);
  assert.equal(secondReview.verdict, "APPROVE");
  assert.equal(secondReview.cycleCount, 1);
});
