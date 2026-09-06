import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createRequestHandler } from "../src/api/server.ts";
import { RealPerceptionAgent, type PerceptionModel } from "../src/agents/perception-agent.ts";
import { mockPerception } from "../src/agents/mocks.ts";
import { RealDecisionSynthesizerAgent, type DecisionSynthesizerModel } from "../src/agents/decision-synthesizer-agent.ts";
import { RealAdversarialReviewerAgent, type DecisionReviewerModel } from "../src/agents/adversarial-reviewer-agent.ts";
import { InMemoryDecisionMemory } from "../src/memory/decision-memory.ts";
import { createDefaultOrchestrator } from "../src/orchestrator/decision-orchestrator.ts";
import { mockTools } from "../src/tools/seeded-tools.ts";

// Phase 13: API integration preparation only. These tests exercise the same request handler
// (including the new CORS headers/preflight support) that the production `server` uses, but
// wired against a deterministic orchestrator so no real model/network call is made. This
// mirrors the fake-model pattern already used in decision-flow.test.ts.
const deterministicSynthesizerModel: DecisionSynthesizerModel = {
  async synthesize(request) {
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
const deterministicReviewerModel: DecisionReviewerModel = {
  async review() { return { verdict: "APPROVE", concerns: [], requiredChanges: [] }; }
};
const highConfidenceModel: PerceptionModel = {
  async observe() {
    return { visualFindings: [{ finding: "dark leaf spots", confidence: 0.81, uncertainty: "Image resolution may hide lesion boundaries." }], symptomFindings: ["leaf_spots", "increasing_affected_area"], uncertainties: ["Lab confirmation is not available from the intake."] };
  }
};

function buildDeterministicOrchestrator() {
  const memory = new InMemoryDecisionMemory();
  const synthesizer = new RealDecisionSynthesizerAgent(deterministicSynthesizerModel, mockTools);
  const reviewer = new RealAdversarialReviewerAgent(deterministicReviewerModel);
  const perception = new RealPerceptionAgent(highConfidenceModel);
  return createDefaultOrchestrator(memory, perception, undefined, undefined, synthesizer, reviewer);
}

// Mirrors production's demo-specific wiring (see src/api/server.ts): the /api/v1/demo/tomato route
// uses the deterministic mockPerception instead of a real, network-calling Perception model, so the
// canned demo text (no image attached) reliably clears the confidence gate and reaches Field
// Context. Synthesizer/Reviewer stay deterministic here purely so this test makes no network calls.
function buildDemoOrchestrator() {
  const memory = new InMemoryDecisionMemory();
  const synthesizer = new RealDecisionSynthesizerAgent(deterministicSynthesizerModel, mockTools);
  const reviewer = new RealAdversarialReviewerAgent(deterministicReviewerModel);
  return createDefaultOrchestrator(memory, mockPerception, undefined, undefined, synthesizer, reviewer);
}

async function withTestServer(fn: (baseUrl: string) => Promise<void>): Promise<void> {
  const orchestrator = buildDeterministicOrchestrator();
  const server = createServer(createRequestHandler(orchestrator));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

async function withDemoTestServer(fn: (baseUrl: string) => Promise<void>): Promise<void> {
  const orchestrator = buildDeterministicOrchestrator();
  const demoOrchestrator = buildDemoOrchestrator();
  const server = createServer(createRequestHandler(orchestrator, undefined, demoOrchestrator));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

test("GET /health returns 200 with CORS headers present", async () => {
  await withTestServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok" });
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
  });
});

test("OPTIONS preflight for /api/v1/decisions returns 204 with CORS headers", async () => {
  await withTestServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/api/v1/decisions`, {
      method: "OPTIONS",
      headers: {
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type"
      }
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
    assert.match(response.headers.get("access-control-allow-methods") ?? "", /POST/);
    assert.match(response.headers.get("access-control-allow-headers") ?? "", /content-type/);
  });
});

test("POST /api/v1/decisions accepts the existing request shape and returns a DecisionResponse, with CORS headers present", async () => {
  await withTestServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/api/v1/decisions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        farmId: "FARM-001",
        plotId: "PLOT-A",
        language: "kn",
        mode: "DECIDE",
        farmerText: "Tomato leaves have dark spots and the affected area is increasing."
      })
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
    const payload = await response.json() as { caseState?: unknown; decision?: { finalAction?: unknown } };
    assert.ok(payload.caseState, "response must include caseState");
    assert.ok(payload.decision, "response must include decision");
    assert.equal(typeof payload.decision?.finalAction, "string");
  });
});

test("POST /api/v1/decisions rejects a request missing farmerText, unchanged from prior behavior", async () => {
  await withTestServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/api/v1/decisions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ farmId: "FARM-001" })
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "farmerText is required" });
  });
});

test("POST /api/v1/demo/tomato uses the deterministic demo Perception Agent, retrieves the seeded Kolar farm context, and proceeds past REQUEST_MORE_DATA", async () => {
  await withDemoTestServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/api/v1/demo/tomato`, { method: "POST" });
    assert.equal(response.status, 200);
    const payload = await response.json() as { caseState: { farm: unknown; environment: unknown; history: unknown; workflow: { trace: string[] } } };
    assert.notEqual(payload.caseState.farm, null);
    assert.notEqual(payload.caseState.environment, null);
    assert.notEqual(payload.caseState.history, null);
    assert.ok(payload.caseState.workflow.trace.includes("CONTEXT"), "workflow must proceed to CONTEXT rather than stopping at REQUEST_MORE_DATA");
    assert.ok(!payload.caseState.workflow.trace.includes("REQUEST_MORE_DATA"));
  });
});
