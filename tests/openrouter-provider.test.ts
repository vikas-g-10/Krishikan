import assert from "node:assert/strict";
import test from "node:test";
import { OpenRouterChatCompletionsPerceptionModel, PerceptionProviderFormatError, type PerceptionModelRequest } from "../src/agents/perception-agent.ts";
import { OpenRouterChatCompletionsDecisionSynthesizerModel, DecisionSynthesizerProviderFormatError, type DecisionSynthesizerRequest } from "../src/agents/decision-synthesizer-agent.ts";
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
  assert.match(seenBody.messages[0].content, /^synthesize/);
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

// Regression for the follow-up production failure: a free OpenRouter model returning valid JSON
// that is not the required perception schema at all (e.g. a safety verdict shaped as JSON instead
// of visualFindings/symptomFindings/uncertainties). This must NOT be accepted or have missing
// fields fabricated — it must be rejected by the existing, unmodified validatePerceptionResult.
test("Perception: rejects well-formed JSON that omits the required schema keys, via the unmodified validatePerceptionResult, rather than fabricating or accepting it", async () => {
  const nonSchemaJson = JSON.stringify({ userSafety: "safe", note: "No issues detected." });
  const model = new OpenRouterChatCompletionsPerceptionModel("test-key", undefined, fakeChatCompletionsFetch(nonSchemaJson));
  await assert.rejects(
    () => model.observe({ instructions: "x", content: [] }),
    /Perception model result is missing required observation fields\./
  );
});

test("Perception: the OpenRouter system prompt explicitly reinforces the exact required JSON shape and forbids prose, and a trailing user reminder is appended without touching the farmer's original content", async () => {
  let seenBody: any;
  const result = { visualFindings: [], symptomFindings: [], uncertainties: [] };
  const model = new OpenRouterChatCompletionsPerceptionModel("test-key", undefined, fakeChatCompletionsFetch(JSON.stringify(result), (_url, init) => {
    seenBody = JSON.parse(String(init.body));
  }));
  await model.observe({ instructions: "base instructions", content: [{ type: "input_text", text: "Farmer report: leaf spots" }] });
  assert.match(seenBody.messages[0].content, /base instructions/);
  assert.match(seenBody.messages[0].content, /visualFindings/);
  assert.match(seenBody.messages[0].content, /no prose/i);
  assert.deepEqual(seenBody.messages[1].content[0], { type: "text", text: "Farmer report: leaf spots" });
  assert.equal(seenBody.messages[2].role, "user");
  assert.match(seenBody.messages[2].content[0].text, /visualFindings/);
});

test("Decision Synthesizer: strips a Markdown code fence before parsing", async () => {
  const proposal = { action: "MONITOR", interventionId: null, reason: "seeded", reasoningSummary: "seeded", evidence: [], confidence: 0.8, constraints: [], uncertainties: [], missingData: [] };
  const fenced = "```json\n" + JSON.stringify(proposal) + "\n```";
  const model = new OpenRouterChatCompletionsDecisionSynthesizerModel("test-key", undefined, fakeChatCompletionsFetch(fenced));
  const request = { instructions: "synthesize", state: {} } as unknown as DecisionSynthesizerRequest;
  const parsed = await model.synthesize(request);
  assert.deepEqual(parsed, proposal);
});

// Regression coverage for the OpenRouter free model's decision_synthesis schema-drift failure mode,
// mirroring the Perception Agent's provider-format hardening.

test("Decision Synthesizer: rejects a plain-text, non-JSON reply with a controlled DecisionSynthesizerProviderFormatError instead of a raw JSON.parse SyntaxError", async () => {
  const model = new OpenRouterChatCompletionsDecisionSynthesizerModel("test-key", undefined, fakeChatCompletionsFetch("User Safety: safe"));
  const request = { instructions: "synthesize", state: {} } as unknown as DecisionSynthesizerRequest;
  await assert.rejects(
    () => model.synthesize(request),
    (error: unknown) => {
      assert.ok(error instanceof DecisionSynthesizerProviderFormatError);
      assert.ok(!(error instanceof SyntaxError));
      assert.match((error as Error).message, /did not return the required structured JSON output/);
      return true;
    }
  );
});

test("Decision Synthesizer: rejects well-formed JSON that omits the required schema keys, rather than fabricating or accepting it", async () => {
  const nonSchemaJson = JSON.stringify({ userSafety: "safe", note: "No decision" });
  const model = new OpenRouterChatCompletionsDecisionSynthesizerModel("test-key", undefined, fakeChatCompletionsFetch(nonSchemaJson));
  const request = { instructions: "synthesize", state: {} } as unknown as DecisionSynthesizerRequest;
  // parseDecisionSynthesisJson succeeds (it is valid JSON), so this reaches the model boundary's
  // return value unchanged; validateProposal (unmodified, exercised via RealDecisionSynthesizerAgent
  // elsewhere) is what rejects the wrong shape. Here we confirm the OpenRouter adapter itself does
  // not fabricate or coerce the missing keys and passes the object through as-is.
  const parsed = await model.synthesize(request);
  assert.deepEqual(parsed, { userSafety: "safe", note: "No decision" });
});

test("Decision Synthesizer: the OpenRouter system message contains the JSON-shape reinforcement", async () => {
  let seenBody: any;
  const proposal = { action: "MONITOR", interventionId: null, reason: "seeded", reasoningSummary: "seeded", evidence: [], confidence: 0.8, constraints: [], uncertainties: [], missingData: [] };
  const model = new OpenRouterChatCompletionsDecisionSynthesizerModel("test-key", undefined, fakeChatCompletionsFetch(JSON.stringify(proposal), (_url, init) => {
    seenBody = JSON.parse(String(init.body));
  }));
  const request = { instructions: "base synthesis instructions", state: { negativeConstraints: [] } } as unknown as DecisionSynthesizerRequest;
  await model.synthesize(request);
  assert.match(seenBody.messages[0].content, /base synthesis instructions/);
  assert.match(seenBody.messages[0].content, /"action"/);
  assert.match(seenBody.messages[0].content, /"interventionId"/);
  assert.match(seenBody.messages[0].content, /"missingData"/);
  assert.match(seenBody.messages[0].content, /no prose/i);
  assert.match(seenBody.messages[0].content, /no markdown/i);
  assert.match(seenBody.messages[0].content, /no code fences/i);
  assert.match(seenBody.messages[0].content, /vettedInterventions/);
  assert.match(seenBody.messages[0].content, /negative constraints/i);
});

test("Decision Synthesizer: a final user-role reminder is appended, and the original serialized request.state is preserved unchanged", async () => {
  let seenBody: any;
  const proposal = { action: "MONITOR", interventionId: null, reason: "seeded", reasoningSummary: "seeded", evidence: [], confidence: 0.8, constraints: [], uncertainties: [], missingData: [] };
  const state = { negativeConstraints: ["Do not spray during rain."], vettedInterventions: [] };
  const model = new OpenRouterChatCompletionsDecisionSynthesizerModel("test-key", undefined, fakeChatCompletionsFetch(JSON.stringify(proposal), (_url, init) => {
    seenBody = JSON.parse(String(init.body));
  }));
  const request = { instructions: "synthesize", state } as unknown as DecisionSynthesizerRequest;
  await model.synthesize(request);
  assert.equal(seenBody.messages.length, 3);
  assert.equal(seenBody.messages[1].role, "user");
  assert.equal(seenBody.messages[1].content, JSON.stringify(state));
  assert.equal(seenBody.messages[2].role, "user");
  assert.equal(seenBody.messages[2].content, "Reminder: reply with only the required decision_synthesis JSON object using exactly the required keys. No other text.");
  assert.equal(seenBody.response_format.type, "json_schema");
  assert.equal(seenBody.response_format.json_schema.name, "decision_synthesis");
});

test("Adversarial Reviewer: strips a Markdown code fence before parsing", async () => {
  const verdict = { verdict: "APPROVE", concerns: [], requiredChanges: [] };
  const fenced = "```json\n" + JSON.stringify(verdict) + "\n```";
  const model = new OpenRouterChatCompletionsDecisionReviewerModel("test-key", undefined, fakeChatCompletionsFetch(fenced));
  const request = { instructions: "review", state: {} } as unknown as DecisionReviewerRequest;
  const parsed = await model.review(request);
  assert.deepEqual(parsed, verdict);
});
