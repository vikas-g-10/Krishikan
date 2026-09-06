import assert from "node:assert/strict";
import test from "node:test";
import { RealPerceptionAgent, type PerceptionModel, type PerceptionModelRequest } from "../src/agents/perception-agent.ts";
import { RealDecisionSynthesizerAgent, type DecisionSynthesizerModel } from "../src/agents/decision-synthesizer-agent.ts";
import { RealAdversarialReviewerAgent, type DecisionReviewerModel } from "../src/agents/adversarial-reviewer-agent.ts";
import { InMemoryDecisionMemory } from "../src/memory/decision-memory.ts";
import { createDefaultOrchestrator } from "../src/orchestrator/decision-orchestrator.ts";
import { mockTools } from "../src/tools/seeded-tools.ts";

// Phase 12.4: the default Decision Synthesizer is now REAL and calls out to a model boundary.
// End-to-end tests must not reach an external API, so every test that exercises synthesis
// injects this deterministic fake model through the same RealDecisionSynthesizerAgent that
// production wires by default. This mirrors how the real Perception Agent is already tested
// with a fake PerceptionModel above.
const deterministicSynthesizerModel: DecisionSynthesizerModel = {
  async synthesize(request) {
    if (request.state.negativeConstraints.some(constraint => constraint.toLowerCase().includes("foliar"))) {
      return {
        action: "WAIT_FOR_SAFE_WEATHER_WINDOW",
        interventionId: null,
        reason: "Rain makes the current foliar window unsuitable; reassess after the wet forecast.",
        reasoningSummary: "The existing negative constraint excludes a foliar action in this weather window.",
        evidence: ["WX-001 constraint", "high humidity", "increasing leaf spots"],
        confidence: 0.88,
        constraints: request.state.negativeConstraints,
        uncertainties: request.state.risk.flags,
        missingData: []
      };
    }
    return {
      action: "BIOLOGICAL_INTERVENTION",
      interventionId: "TOM-BIO-001",
      reason: "Seeded symptoms and risk indicate a potential biological intervention after checks.",
      reasoningSummary: "This remains a proposal that requires deterministic safety approval.",
      evidence: ["leaf spots", "high humidity", "economic threshold crossed"],
      confidence: 0.81,
      constraints: request.state.negativeConstraints,
      uncertainties: request.state.risk.flags,
      missingData: []
    };
  }
};
const synthesizer = new RealDecisionSynthesizerAgent(deterministicSynthesizerModel, mockTools);

// Phase 12.5: the default Adversarial Reviewer is now REAL and calls out to a model boundary.
// End-to-end tests must not reach an external API, so every test that exercises review injects
// this deterministic fake model through the same RealAdversarialReviewerAgent that production
// wires by default. A deterministic Safety Engine BLOCK never reaches this model at all (the
// orchestrator's own safety veto path is exercised without any reviewer model call), so this
// fake only needs to approve the safe, already-vetted proposal that reaches it.
const deterministicReviewerModel: DecisionReviewerModel = {
  async review() { return { verdict: "APPROVE", concerns: [], requiredChanges: [] }; }
};
const reviewer = new RealAdversarialReviewerAgent(deterministicReviewerModel);

const highConfidenceModel: PerceptionModel = {
  async observe() {
    return { visualFindings: [{ finding: "dark leaf spots", confidence: 0.81, uncertainty: "Image resolution may hide lesion boundaries." }], symptomFindings: ["leaf_spots", "increasing_affected_area"], uncertainties: ["Lab confirmation is not available from the intake."] };
  }
};

const lowConfidenceModel: PerceptionModel = {
  async observe() {
    return { visualFindings: [{ finding: "unconfirmed foliar symptom", confidence: 0.45, uncertainty: "No clear symptom is described." }], symptomFindings: ["insufficient_description"], uncertainties: ["A close, well-lit image is needed."] };
  }
};

test("seeded tomato case is blocked then replanned to a safe weather wait", async () => {
  const memory = new InMemoryDecisionMemory();
  const response = await createDefaultOrchestrator(memory, new RealPerceptionAgent(highConfidenceModel), undefined, undefined, synthesizer, reviewer).run({ farmerText: "Tomato leaves have dark spots and the affected area is increasing." });
  assert.equal(response.decision.finalAction, "WAIT_FOR_SAFE_WEATHER_WINDOW");
  assert.equal(response.decision.replanCount, 1);
  assert.equal(response.caseState.review.verdict, "APPROVE");
  assert.ok(response.caseState.safety.deterministicChecks.some(check => check.ruleId === "WX-001" && !check.passed));
  assert.ok(response.caseState.workflow.trace.includes("REPLAN"));
  assert.equal((await memory.list()).length, 1);
});

test("low-confidence observation requests more data without a disease intervention", async () => {
  const response = await createDefaultOrchestrator(new InMemoryDecisionMemory(), new RealPerceptionAgent(lowConfidenceModel)).run({ farmerText: "Something looks unusual." });
  assert.equal(response.caseState.workflow.trace.at(-2), "REQUEST_MORE_DATA");
  assert.equal(response.decision.finalAction, "SEEK_EXPERT_CONFIRMATION");
});

test("real Perception Agent passes text, transcript, and images through a mockable model boundary", async () => {
  let request: PerceptionModelRequest | undefined;
  const model: PerceptionModel = { async observe(nextRequest) {
    request = nextRequest;
    return { visualFindings: [{ finding: "small circular leaf spots", confidence: 0.72, uncertainty: "The image does not show the underside of the leaf." }], symptomFindings: ["leaf_spots"], uncertainties: ["The crop stage is reported but not visually confirmed."] };
  } };
  const response = await createDefaultOrchestrator(new InMemoryDecisionMemory(), new RealPerceptionAgent(model), undefined, undefined, synthesizer, reviewer).run({ farmerText: "There are spots on the leaves.", voiceTranscript: "Spots have spread after rain.", images: ["data:image/jpeg;base64,ZmFrZQ=="] });
  assert.ok(request);
  assert.deepEqual(request.content.map(part => part.type), ["input_text", "input_text", "input_image"]);
  assert.match(request.instructions, /do not recommend or prescribe/i);
  assert.equal(response.caseState.observations.visualFindings[0].confidence, 0.72);
  assert.deepEqual(response.caseState.observations.uncertainties, ["The crop stage is reported but not visually confirmed."]);
  assert.equal(response.decision.finalAction, "WAIT_FOR_SAFE_WEATHER_WINDOW");
});

test("real Perception Agent rejects treatment or dosage language from the model", async () => {
  const unsafeModel: PerceptionModel = { async observe() {
    return { visualFindings: [{ finding: "Spray 2 ml of product", confidence: 0.9, uncertainty: "None" }], symptomFindings: ["leaf_spots"], uncertainties: [] };
  } };
  await assert.rejects(() => new RealPerceptionAgent(unsafeModel).observe({ observations: { farmerText: "spots", images: [], visualFindings: [], symptomFindings: [], uncertainties: [] } } as never), /prohibited treatment or dosage language/);
});
