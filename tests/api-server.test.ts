import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createRequestHandler, server, orchestrator, demoOrchestrator } from "../src/api/server.ts";
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

// Regression coverage for the production failure: /api/v1/demo/tomato was returning HTTP 500
// ("Decision Synthesizer model returned no structured output.") because, unlike mockPerception,
// the demo orchestrator's Decision Synthesizer and Adversarial Reviewer were still the real,
// network-calling OpenRouter/OpenAI-backed model boundaries. The tests below exercise the ACTUAL
// exported production `server`, `orchestrator`, and `demoOrchestrator` from src/api/server.ts
// (not a locally reconstructed stand-in), with OPENROUTER_API_KEY/OPENAI_API_KEY removed and a
// fetch stub that fails the test if any network call is attempted, to prove the demo endpoint's
// production wiring is now fully deterministic while /api/v1/decisions' production wiring is not.

async function withNoProviderCredentials<T>(fn: () => Promise<T>): Promise<T> {
  const savedOpenRouterKey = process.env.OPENROUTER_API_KEY;
  const savedOpenAiKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    return await fn();
  } finally {
    if (savedOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = savedOpenRouterKey;
    if (savedOpenAiKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = savedOpenAiKey;
  }
}

// Blocks only calls to a real third-party model provider (OpenRouter/OpenAI). Requests the test
// itself makes to its own local HTTP test server (127.0.0.1/localhost) must still go through the
// real fetch implementation — otherwise the test could never reach the server it just started.
function isLocalTestServerUrl(input: unknown): boolean {
  try {
    const url = new URL(String(input instanceof Request ? input.url : input));
    return url.hostname === "127.0.0.1" || url.hostname === "localhost";
  } catch {
    return false;
  }
}

async function withFetchBlocked<T>(fn: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    if (isLocalTestServerUrl(args[0])) return originalFetch(...args);
    throw new Error(`Unexpected network call during a supposedly deterministic path: ${String(args[0])}`);
  }) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("Production wiring: the exported demoOrchestrator (used by /api/v1/demo/tomato) completes the full rain-veto/replan-to-WAIT_FOR_SAFE_WEATHER_WINDOW scenario with no OPENROUTER_API_KEY/OPENAI_API_KEY and without ever calling fetch", async () => {
  await withNoProviderCredentials(() =>
    withFetchBlocked(async () => {
      const result = await demoOrchestrator.run({
        farmId: "FARM-001",
        plotId: "PLOT-A",
        language: "kn",
        mode: "DECIDE",
        farmerText: "Tomato leaves have dark spots and the affected area is increasing."
      });
      // First SYNTHESIS cycle proposes the vetted biological intervention; the unmodified Safety
      // Engine's WX-001 rule blocks it because the seeded Kolar forecast includes rain and the
      // intervention is foliar; the unmodified orchestrator replans exactly once; the deterministic
      // demo Synthesizer/Reviewer then converge on WAIT_FOR_SAFE_WEATHER_WINDOW, which the reviewer
      // approves — none of this required a network call or an API key.
      assert.deepEqual(result.caseState.workflow.trace, [
        "INTAKE", "PERCEPTION", "CONTEXT", "RISK_ECONOMICS",
        "SYNTHESIS", "SAFETY_CHECK", "REVIEW", "REPLAN",
        "SYNTHESIS", "SAFETY_CHECK", "REVIEW",
        "FINALIZE", "MEMORY_WRITE", "DONE"
      ]);
      assert.equal(result.decision.replanCount, 1);
      assert.equal(result.decision.finalAction, "WAIT_FOR_SAFE_WEATHER_WINDOW");
      assert.equal(result.decision.reviewerVerdict, "APPROVE");
      assert.equal(result.decision.status, "FINAL");
      assert.equal(result.decision.deterministicResult, "PASS");
      const wx001 = result.caseState.safety.deterministicChecks.find(check => check.ruleId === "WX-001");
      assert.ok(wx001, "the unmodified Safety Engine's WX-001 rain-vs-foliar rule must have run");
      assert.equal(wx001?.passed, false, "WX-001 must have failed on the first cycle's foliar biological intervention proposal");
    })
  );
});

test("Production wiring: POST /api/v1/demo/tomato against the actual exported server returns 200 with no OPENROUTER_API_KEY/OPENAI_API_KEY set and without any network call", async () => {
  await withNoProviderCredentials(() =>
    withFetchBlocked(async () => {
      await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
      try {
        const { port } = server.address() as AddressInfo;
        const response = await fetch(`http://127.0.0.1:${port}/api/v1/demo/tomato`, { method: "POST" });
        assert.equal(response.status, 200);
        const payload = await response.json() as { decision: { finalAction: string; replanCount: number } };
        assert.equal(payload.decision.finalAction, "WAIT_FOR_SAFE_WEATHER_WINDOW");
        assert.equal(payload.decision.replanCount, 1);
      } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    })
  );
});

test("Production wiring: the exported orchestrator (used by /api/v1/decisions) still resolves to the real, network-calling Perception model — it rejects immediately, before Field Context or Synthesis, when no OPENROUTER_API_KEY/OPENAI_API_KEY is present, proving /api/v1/decisions was NOT converted to deterministic demo behavior", async () => {
  await withNoProviderCredentials(async () => {
    await assert.rejects(
      () => orchestrator.run({
        farmId: "FARM-001",
        plotId: "PLOT-A",
        language: "kn",
        mode: "DECIDE",
        farmerText: "Tomato leaves have dark spots and the affected area is increasing."
      }),
      /API_KEY is required/
    );
  });
});

test("Production wiring: orchestrator (/api/v1/decisions) and demoOrchestrator (/api/v1/demo/tomato) are distinct instances with different dependency sets — the demo path's determinism was not applied to the production path", () => {
  assert.notEqual(orchestrator, demoOrchestrator);
});
