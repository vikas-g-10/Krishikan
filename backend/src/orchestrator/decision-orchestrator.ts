import { randomUUID } from "node:crypto";
import { ToolFieldContextAgent, type FieldContextAgent } from "../agents/field-context-agent.ts";
import { ToolRiskEconomicsAgent, type RiskEconomicsAgent } from "../agents/risk-economics-agent.ts";
import type { PerceptionAgent, Reviewer, Synthesizer } from "../agents/mocks.ts";
import { OpenAIResponsesPerceptionModel, OpenRouterChatCompletionsPerceptionModel, PerceptionProviderFormatError, RealPerceptionAgent, type PerceptionModel } from "../agents/perception-agent.ts";
import { OpenAIResponsesDecisionSynthesizerModel, OpenRouterChatCompletionsDecisionSynthesizerModel, RealDecisionSynthesizerAgent, type DecisionSynthesizerModel } from "../agents/decision-synthesizer-agent.ts";
import { OpenAIResponsesDecisionReviewerModel, OpenRouterChatCompletionsDecisionReviewerModel, RealAdversarialReviewerAgent, type DecisionReviewerModel } from "../agents/adversarial-reviewer-agent.ts";
import type { DecisionMemory } from "../memory/decision-memory.ts";
import { SafetyEngine } from "../rules/safety-engine.ts";
import { mockTools } from "../tools/seeded-tools.ts";
import type { CaseState, DecisionMode, DecisionRecord, DecisionResponse, Language, WorkflowState } from "../types/contracts.ts";

export interface DecisionInput { farmId?: string; plotId?: string; language?: Language; mode?: DecisionMode; farmerText: string; voiceTranscript?: string; images?: string[]; }
export interface Dependencies { context: FieldContextAgent; riskEconomics: RiskEconomicsAgent; safety: SafetyEngine; memory: DecisionMemory; perception: PerceptionAgent; synthesizer: Synthesizer; reviewer: Reviewer; now?: () => Date; }

export class DecisionOrchestrator {
  private readonly deps: Dependencies;
  constructor(deps: Dependencies) { this.deps = deps; }
  private transition(state: CaseState, next: WorkflowState): void { state.workflow.current = next; state.workflow.trace.push(next); }
  async run(input: DecisionInput): Promise<DecisionResponse> {
    const now = (this.deps.now ?? (() => new Date()))();
    const farmId = input.farmId ?? "FARM-001", plotId = input.plotId ?? "PLOT-A";
    const state: CaseState = { case: { caseId: randomUUID(), farmId, plotId, createdAt: now.toISOString(), language: input.language ?? "kn", mode: input.mode ?? "DECIDE" }, farm: null, observations: { farmerText: input.farmerText, voiceTranscript: input.voiceTranscript, images: input.images ?? [], visualFindings: [], symptomFindings: [], uncertainties: [] }, environment: null, history: null, context: { retrievedFacts: { farm: [], environment: [], history: [] }, derivedContext: [], toolFlags: [], conflicts: [], ready: false }, risk: { diseaseRisk: 0, weatherRisk: 0, cropStress: 0, overallRisk: "LOW", factors: [], flags: [] }, economics: { source: "UNAVAILABLE", cropValue: null, expectedLoss: null, interventionCost: null, decisionGate: "SEEK_CONFIRMATION", economicJustification: "Economic assessment has not run.", flags: [] }, safety: { deterministicChecks: [], violations: [], status: "PENDING" }, review: { verdict: "VETO", concerns: [], requiredChanges: [], cycleCount: 0 }, workflow: { current: "INTAKE", trace: ["INTAKE"], negativeConstraints: [] } };

    this.transition(state, "PERCEPTION");
    try {
      Object.assign(state.observations, await this.deps.perception.observe(state));
    } catch (error) {
      // A provider that returns HTTP 200 with non-JSON/unstructured text (e.g. "User Safety: safe")
      // is a controlled, expected failure mode of the model boundary, not a system fault — route it
      // into the same safe-fallback behavior as the other "could not derive a decision" branches
      // below instead of letting it bubble up as an unhandled error (HTTP 500). Any other perception
      // error (e.g. missing API key, network failure, transport error) is unrelated to this fix and
      // continues to propagate unchanged.
      if (error instanceof PerceptionProviderFormatError) return this.completePerceptionProviderFailure(state, now);
      throw error;
    }
    const confidence = Math.max(...state.observations.visualFindings.map(f => f.confidence), 0);
    if (confidence < 0.7) return this.completeRequestMoreData(state, now);

    this.transition(state, "CONTEXT");
    const retrieved = await this.deps.context.retrieve({ farmId, plotId, now });
    state.farm = retrieved.farm;
    state.environment = retrieved.environment;
    state.history = retrieved.history;
    state.context = retrieved.context;
    if (!state.context.ready || !state.farm || !state.environment || !state.history) return this.completeContextUnavailable(state, now);
    this.transition(state, "RISK_ECONOMICS");
    ({ risk: state.risk, economics: state.economics } = await this.deps.riskEconomics.assess(state));
    if (state.economics.decisionGate === "SEEK_CONFIRMATION") return this.completeEconomicsUnavailable(state, now);

    for (;;) {
      this.transition(state, "SYNTHESIS"); state.proposedDecision = await this.deps.synthesizer.propose(state);
      this.transition(state, "SAFETY_CHECK"); state.safety = await this.deps.safety.evaluate(state);
      this.transition(state, "REVIEW"); state.review = await this.deps.reviewer.review(state);
      if (state.review.verdict === "APPROVE") break;
      if (state.review.cycleCount >= 2) return this.completeSafeFallback(state, now);
      state.review.cycleCount += 1;
      state.workflow.negativeConstraints.push(...state.review.requiredChanges);
      this.transition(state, "REPLAN");
    }
    this.transition(state, "FINALIZE");
    const decision = this.record(state, now, "FINAL");
    this.transition(state, "MEMORY_WRITE"); await this.deps.memory.save(decision); this.transition(state, "DONE");
    return { caseState: state, decision };
  }
  private record(state: CaseState, now: Date, status: "FINAL" | "SAFE_FALLBACK"): DecisionRecord { const proposal = state.proposedDecision!; return { decisionId: randomUUID(), caseId: state.case.caseId, farmId: state.case.farmId, plotId: state.case.plotId, createdAt: now.toISOString(), riskLevel: state.risk.overallRisk, proposedAction: proposal.action, finalAction: proposal.action, economicJustification: state.economics.economicJustification, deterministicResult: state.safety.status === "PASS" ? "PASS" : "BLOCKED", reviewerVerdict: state.review.verdict, replanCount: state.review.cycleCount, confidence: proposal.confidence, status, language: state.case.language }; }
  private completeSafeFallback(state: CaseState, now: Date): DecisionResponse { this.transition(state, "SAFE_FALLBACK"); state.proposedDecision = { action: "SEEK_EXPERT_CONFIRMATION", reason: "Current evidence and conditions do not support a reliable intervention recommendation.", evidence: [], confidence: 0.4, constraints: state.workflow.negativeConstraints }; const decision = this.record(state, now, "SAFE_FALLBACK"); this.transition(state, "DONE"); return { caseState: state, decision }; }
  private completeContextUnavailable(state: CaseState, now: Date): DecisionResponse { this.transition(state, "SAFE_FALLBACK"); state.proposedDecision = { action: "SEEK_EXPERT_CONFIRMATION", reason: "Field context is incomplete, conflicting, or unavailable; no decision was derived from missing facts.", evidence: state.context.toolFlags.filter(flag => flag.status !== "RETRIEVED").map(flag => `${flag.tool}: ${flag.status}`), confidence: 0.4, constraints: [] }; const decision = this.record(state, now, "SAFE_FALLBACK"); this.transition(state, "DONE"); return { caseState: state, decision }; }
  private completeEconomicsUnavailable(state: CaseState, now: Date): DecisionResponse { this.transition(state, "SAFE_FALLBACK"); state.proposedDecision = { action: "SEEK_EXPERT_CONFIRMATION", reason: "Economic inputs are incomplete, conflicting, invalid, or unavailable; no monetary value was inferred.", evidence: state.economics.flags.map(flag => `${flag.field}: ${flag.status}`), confidence: 0.4, constraints: [] }; const decision = this.record(state, now, "SAFE_FALLBACK"); this.transition(state, "DONE"); return { caseState: state, decision }; }
  private completeRequestMoreData(state: CaseState, now: Date): DecisionResponse { this.transition(state, "REQUEST_MORE_DATA"); state.proposedDecision = { action: "SEEK_EXPERT_CONFIRMATION", reason: "Please provide a clearer image or fuller symptom description before a disease-specific recommendation.", evidence: [], confidence: 0.4, constraints: [] }; const decision = this.record(state, now, "SAFE_FALLBACK"); this.transition(state, "DONE"); return { caseState: state, decision }; }
  private completePerceptionProviderFailure(state: CaseState, now: Date): DecisionResponse { this.transition(state, "SAFE_FALLBACK"); state.proposedDecision = { action: "SEEK_EXPERT_CONFIRMATION", reason: "The perception model provider did not return the required structured observation output; no findings could be derived.", evidence: [], confidence: 0.4, constraints: [] }; const decision = this.record(state, now, "SAFE_FALLBACK"); this.transition(state, "DONE"); return { caseState: state, decision }; }
}

// Phase 14.2: provider selection. MODEL_PROVIDER selects which real model backs each agent's model
// boundary; defaulting to "openai" preserves prior behavior exactly when unset. Setting
// MODEL_PROVIDER=openrouter (with OPENROUTER_API_KEY set) runs the same agents against OpenRouter's
// free, OpenAI-compatible Chat Completions API instead, requiring no OpenAI credits. Neither the
// agent interfaces/contracts, the Safety Engine, nor the Adversarial Reviewer's deterministic
// backstops are affected by this selection.
const modelProvider = process.env.MODEL_PROVIDER ?? "openai";
function defaultPerceptionModel(): PerceptionModel { return modelProvider === "openrouter" ? new OpenRouterChatCompletionsPerceptionModel() : new OpenAIResponsesPerceptionModel(); }
function defaultSynthesizerModel(): DecisionSynthesizerModel { return modelProvider === "openrouter" ? new OpenRouterChatCompletionsDecisionSynthesizerModel() : new OpenAIResponsesDecisionSynthesizerModel(); }
function defaultReviewerModel(): DecisionReviewerModel { return modelProvider === "openrouter" ? new OpenRouterChatCompletionsDecisionReviewerModel() : new OpenAIResponsesDecisionReviewerModel(); }

export function createDefaultOrchestrator(
  memory: DecisionMemory,
  perception: PerceptionAgent = new RealPerceptionAgent(defaultPerceptionModel()),
  context: FieldContextAgent = new ToolFieldContextAgent(mockTools, mockTools),
  riskEconomics: RiskEconomicsAgent = new ToolRiskEconomicsAgent(mockTools),
  // Phase 12.4: the Decision Synthesizer is REAL by default. The deterministic Safety Engine
  // remains unchanged and authoritative.
  synthesizer: Synthesizer = new RealDecisionSynthesizerAgent(defaultSynthesizerModel(), mockTools),
  // Phase 12.5: the Adversarial Reviewer is now REAL by default. It never overrides a deterministic
  // Safety Engine BLOCK — that veto and its required changes are derived only from the Safety Engine's
  // own violations, never from the model.
  reviewer: Reviewer = new RealAdversarialReviewerAgent(defaultReviewerModel())
): DecisionOrchestrator {
  return new DecisionOrchestrator({ context, riskEconomics, safety: new SafetyEngine(mockTools), memory, perception, synthesizer, reviewer });
}
