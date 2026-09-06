import assert from "node:assert/strict";
import test from "node:test";
import { OpenRouterChatCompletionsPerceptionModel, PerceptionProviderFormatError, type PerceptionModelRequest } from "../src/agents/perception-agent.ts";
import { OpenRouterChatCompletionsDecisionSynthesizerModel, type DecisionSynthesizerRequest } from "../src/agents/decision-synthesizer-agent.ts";
import { OpenRouterChatCompletionsDecisionReviewerModel, type DecisionReviewerRequest } from "../src/agents/adversarial-reviewer-agent.ts";
import { tomatoSeed } from "../src/tools/seeded-tools.ts";

// These tests exercise the OpenRouter provider classes directly against a stubbed fetchImpl. No
// network call is ever made and OPENROUTER_API_KEY is only ever read from the constructor argument
// supplied here, mirroring how the OpenAI adapter classes are exercised elsewhere in this suite.

function fakeChatCompletionsFetch(content: string, expect?: (url: string, init: RequestInit) => void): typeof fetch {
  return (async (url: string | URL, init?: RequestInit) => {
    expect?.(String(url), init ?? {});
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

test("Perception: throws without OPENROUTER_API_KEY, before making any request", async () => {
  const model = new OpenRouterChatCompletionsPerceptionModel(undefined, "openrouter/free", fakeChatCompletionsFetch("{}"));
  await assert.rejects(() => model.observe({ instructions: "x", content: [] }), /OPENROUTER_API_KEY is required/);
});

test("Perception: defaults to the openrouter/free router, posts to the Chat Completions endpoint, sends json_schema response_format, and preserves image content", async () => {
  let seenUrl = "", seenBody: any;
  const result = { visualFindings: [{ finding: "dark leaf spots", confidence: 0.81, uncertainty: "Image resolution may hide lesion boundaries." }], symptomFindings: ["leaf_spots"], uncertainties: ["Lab confirmation is unavailable."] };
  const model = new OpenRouterChatCompletionsPerceptionModel("test-key", undefined, fakeChatCompletionsFetch(JSON.stringify(result), (url, init) => {
    seenUrl = url;
    seenBody = JSON.parse(String(init.body));
  }));
  const request: PerceptionModelRequest = {
    instructions: "observe only",
    content: [
      { type: "input_text", text: "Farmer report: leaf spots" },
      { type: "input_image", image_url: "https://example.com/leaf.jpg", detail: "high" }
    ]
  };
  const observed = await model.observe(request);
  assert.equal(seenUrl, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(seenBody.model, "openrouter/free");
  assert.equal(seenBody.response_format.type, "json_schema");
  assert.equal(seenBody.response_format.json_schema.strict, true);
  assert.deepEqual(seenBody.messages[1].content[0], { type: "text", text: "Farmer report: leaf spots" });
  assert.deepEqual(seenBody.messages[1].content[1], { type: "image_url", image_url: { url: "https://example.com/leaf.jpg", detail: "high" } });
  assert.deepEqual(observed, result);
});

test("Perception: honors OPENROUTER_MODEL override", async () => {
  let seenModel = "";
  const result = { visualFindings: [], symptomFindings: [], uncertainties: [] };
  const model = new OpenRouterChatCompletionsPerceptionModel("test-key", "some/other-free-model", fakeChatCompletionsFetch(JSON.stringify(result), (_url, init) => {
    seenModel = JSON.parse(String(init.body)).model;
  }));
  await model.observe({ instructions: "x", content: [] });
  assert.equal(seenModel, "some/other-free-model");
});

test("Decision Synthesizer: throws without OPENROUTER_API_KEY, before making any request", async () => {
  const model = new OpenRouterChatCompletionsDecisionSynthesizerModel(undefined, "openrouter/free", fakeChatCompletionsFetch("{}"));
  const request = { instructions: "x", state: {} } as unknown as DecisionSynthesizerRequest;
  await assert.rejects(() => model.synthesize(request), /OPENROUTER_API_KEY is required/);
});

test("Decision Synthesizer: posts to the Chat Completions endpoint with json_schema response_format and returns the parsed proposal", async () => {
  let seenUrl = "", seenBody: any;
  const proposal = { action: "MONITOR", interventionId: null, reason: "seeded", reasoningSummary: "seeded", evidence: [], confidence: 0.8, constraints: [], uncertainties: [], missingData: [] };
  const model = new OpenRouterChatCompletionsDecisionSynthesizerModel("test-key", undefined, fakeChatCompletionsFetch(JSON.stringify(proposal), (url, init) => {
    seenUrl = url;
    seenBody = JSON.parse(String(init.body));
  }));
  const request: DecisionSynthesizerRequest = {
    instructions: "synthesize",
    state: {
      perception: { farmerText: "spots", images: [], visualFindings: [], symptomFindings: [], uncertainties: [] },
      context: { retrievedFacts: { farm: [], environment: [], history: [] }, derivedContext: [], toolFlags: [], conflicts: [], ready: true },
      risk: { diseaseRisk: 0.5, weatherRisk: 0.2, cropStress: 0.1, overallRisk: "LOW", factors: [], flags: [] },
      economics: { source: "SEEDED_DEMO", cropValue: 1, expectedLoss: 1, interventionCost: 1, decisionGate: "MONITOR", economicJustification: "seeded", flags: [] },
      history: tomatoSeed.history,
      negativeConstraints: [],
      vettedInterventions: []
    }
  };
  const parsed = await model.synthesize(request);
  assert.equal(seenUrl, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(seenBody.model, "openrouter/free");
  assert.equal(seenBody.response_format.type, "json_schema");
  assert.equal(seenBody.messages[0].content, "synthesize");
  assert.deepEqual(parsed, proposal);
});

test("Adversarial Reviewer: throws without OPENROUTER_API_KEY, before making any request", async () => {
  const model = new OpenRouterChatCompletionsDecisionReviewerModel(undefined, "openrouter/free", fakeChatCompletionsFetch("{}"));
  const request = { instructions: "x", state: {} } as unknown as DecisionReviewerRequest;
  await assert.rejects(() => model.review(request), /OPENROUTER_API_KEY is required/);
});

test("Adversarial Reviewer: posts to the Chat Completions endpoint with json_schema response_format and returns the parsed verdict", async () => {
  let seenBody: any;
  const verdict = { verdict: "APPROVE", concerns: [], requiredChanges: [] };
  const model = new OpenRouterChatCompletionsDecisionReviewerModel("test-key", undefined, fakeChatCompletionsFetch(JSON.stringify(verdict), (_url, init) => {
    seenBody = JSON.parse(String(init.body));
  }));
  const request = { instructions: "review", state: {} } as unknown as DecisionReviewerRequest;
  const parsed = await model.review(request);
  assert.equal(seenBody.model, "openrouter/free");
  assert.equal(seenBody.response_format.json_schema.name, "decision_review");
  assert.deepEqual(parsed, verdict);
});

test("Perception: strips a Markdown ```json code fence before parsing", async () => {
  const result = { visualFindings: [], symptomFindings: [], uncertainties: [] };
  const fenced = "```json\n" + JSON.stringify(result) + "\n```";
  const model = new OpenRouterChatCompletionsPerceptionModel("test-key", undefined, fakeChatCompletionsFetch(fenced));
  const observed = await model.observe({ instructions: "x", content: [] });
  assert.deepEqual(observed, result);
});

// Regression coverage for provider replies that are not the required structured JSON at all
// (rather than JSON wrapped in a fence, which the test above already covers).

test("Perception: still accepts plain, unfenced JSON", async () => {
  const result = { visualFindings: [{ finding: "dark leaf spots", confidence: 0.75, uncertainty: "Lighting varies across the image." }], symptomFindings: ["leaf_spots"], uncertainties: [] };
  const model = new OpenRouterChatCompletionsPerceptionModel("test-key", undefined, fakeChatCompletionsFetch(JSON.stringify(result)));
  const observed = await model.observe({ instructions: "x", content: [] });
  assert.deepEqual(observed, result);
});

test("Perception: rejects a plain-text, non-JSON reply with a controlled PerceptionProviderFormatError instead of a raw JSON.parse SyntaxError", async () => {
  const model = new OpenRouterChatCompletionsPerceptionModel("test-key", undefined, fakeChatCompletionsFetch("User Safety: safe"));
  await assert.rejects(
    () => model.observe({ instructions: "x", content: [] }),
    (error: unknown) => {
      assert.ok(error instanceof PerceptionProviderFormatError);
      assert.ok(!(error instanceof SyntaxError));
      assert.match((error as Error).message, /did not return the required structured JSON output/);
      return true;
    }
  );
});

test("Perception: rejects other non-JSON plain text with the same controlled error class and message pattern", async () => {
  const model = new OpenRouterChatCompletionsPerceptionModel("test-key", undefined, fakeChatCompletionsFetch("I cannot help with that request."));
  await assert.rejects(
    () => model.observe({ instructions: "x", content: [] }),
    (error: unknown) => {
      assert.ok(error instanceof PerceptionProviderFormatError);
      assert.match((error as Error).message, /did not return the required structured JSON output/);
      return true;
    }
  );
});

test("Decision Synthesizer: strips a Markdown code fence before parsing", async () => {
  const proposal = { action: "MONITOR", interventionId: null, reason: "seeded", reasoningSummary: "seeded", evidence: [], confidence: 0.8, constraints: [], uncertainties: [], missingData: [] };
  const fenced = "```json\n" + JSON.stringify(proposal) + "\n```";
  const model = new OpenRouterChatCompletionsDecisionSynthesizerModel("test-key", undefined, fakeChatCompletionsFetch(fenced));
  const request = { instructions: "synthesize", state: {} } as unknown as DecisionSynthesizerRequest;
  const parsed = await model.synthesize(request);
  assert.deepEqual(parsed, proposal);
});

test("Adversarial Reviewer: strips a Markdown code fence before parsing", async () => {
  const verdict = { verdict: "APPROVE", concerns: [], requiredChanges: [] };
  const fenced = "```json\n" + JSON.stringify(verdict) + "\n```";
  const model = new OpenRouterChatCompletionsDecisionReviewerModel("test-key", undefined, fakeChatCompletionsFetch(fenced));
  const request = { instructions: "review", state: {} } as unknown as DecisionReviewerRequest;
  const parsed = await model.review(request);
  assert.deepEqual(parsed, verdict);
});
