import { randomUUID } from "node:crypto";

import {
  ToolFieldContextAgent,
  type FieldContextAgent,
} from "../agents/field-context-agent.ts";

import {
  ToolRiskEconomicsAgent,
  type RiskEconomicsAgent,
} from "../agents/risk-economics-agent.ts";

import type {
  PerceptionAgent,
  Reviewer,
  Synthesizer,
} from "../agents/mocks.ts";

import {
  OpenAIResponsesPerceptionModel,
  OpenRouterChatCompletionsPerceptionModel,
  PerceptionProviderFormatError,
  RealPerceptionAgent,
  type PerceptionModel,
} from "../agents/perception-agent.ts";

import {
  OpenAIResponsesDecisionSynthesizerModel,
  OpenRouterChatCompletionsDecisionSynthesizerModel,
  RealDecisionSynthesizerAgent,
  type DecisionSynthesizerModel,
} from "../agents/decision-synthesizer-agent.ts";

import {
  OpenAIResponsesDecisionReviewerModel,
  OpenRouterChatCompletionsDecisionReviewerModel,
  RealAdversarialReviewerAgent,
  type DecisionReviewerModel,
} from "../agents/adversarial-reviewer-agent.ts";

import type { DecisionMemory } from "../memory/decision-memory.ts";

import { SafetyEngine } from "../rules/safety-engine.ts";

import { mockTools } from "../tools/seeded-tools.ts";

import type {
  CaseState,
  DecisionMode,
  DecisionRecord,
  DecisionResponse,
  DecisionCycle,
  Language,
  ProposedDecision,
  Review,
  SafetyCheck,
  WorkflowState,
} from "../types/contracts.ts";

export interface DecisionInput {
  farmId?: string;
  plotId?: string;
  language?: Language;
  mode?: DecisionMode;
  farmerText: string;
  voiceTranscript?: string;
  images?: string[];
}

export interface Dependencies {
  context: FieldContextAgent;
  riskEconomics: RiskEconomicsAgent;
  safety: SafetyEngine;
  memory: DecisionMemory;
  perception: PerceptionAgent;
  synthesizer: Synthesizer;
  reviewer: Reviewer;
  now?: () => Date;
}

export class DecisionOrchestrator {
  private readonly deps: Dependencies;

  constructor(deps: Dependencies) {
    this.deps = deps;
  }

  private transition(state: CaseState, next: WorkflowState): void {
    state.workflow.current = next;
    state.workflow.trace.push(next);
  }

  /**
   * Creates an immutable snapshot of the current decision cycle.
   *
   * This is important because state.proposedDecision, state.safety and
   * state.review are overwritten during every replan cycle.
   *
   * Without a snapshot, the frontend would only see the final cycle and
   * would not know what the first AI proposal actually was.
   */
  private recordDecisionCycle(
    state: CaseState,
    cycle: number,
  ): void {
    if (!state.proposedDecision) {
      return;
    }

    const proposal: ProposedDecision = {
      ...state.proposedDecision,
      evidence: [...state.proposedDecision.evidence],
      constraints: [...state.proposedDecision.constraints],
      uncertainties: [...state.proposedDecision.uncertainties],
      missingData: [...state.proposedDecision.missingData],
    };

    const safety: {
      deterministicChecks: SafetyCheck[];
      violations: SafetyCheck[];
      status: "PENDING" | "PASS" | "BLOCKED";
    } = {
      status: state.safety.status,
      deterministicChecks: [...state.safety.deterministicChecks],
      violations: [...state.safety.violations],
    };

    const review: Review = {
      ...state.review,
      concerns: [...state.review.concerns],
      requiredChanges: [...state.review.requiredChanges],
    };

    const decisionCycle: DecisionCycle = {
      cycle,
      proposal,
      safety,
      review,
    };

    state.workflow.cycles.push(decisionCycle);
  }

  async run(input: DecisionInput): Promise<DecisionResponse> {
    const now = (this.deps.now ?? (() => new Date()))();

    const farmId = input.farmId ?? "FARM-001";
    const plotId = input.plotId ?? "PLOT-A";

    const state: CaseState = {
      case: {
        caseId: randomUUID(),
        farmId,
        plotId,
        createdAt: now.toISOString(),
        language: input.language ?? "kn",
        mode: input.mode ?? "DECIDE",
      },

      farm: null,

      observations: {
        farmerText: input.farmerText,
        voiceTranscript: input.voiceTranscript,
        images: input.images ?? [],
        visualFindings: [],
        symptomFindings: [],
        uncertainties: [],
      },

      environment: null,

      history: null,

      context: {
        retrievedFacts: {
          farm: [],
          environment: [],
          history: [],
        },
        derivedContext: [],
        toolFlags: [],
        conflicts: [],
        ready: false,
      },

      risk: {
        diseaseRisk: 0,
        weatherRisk: 0,
        cropStress: 0,
        overallRisk: "LOW",
        factors: [],
        flags: [],
      },

      economics: {
        source: "UNAVAILABLE",
        cropValue: null,
        expectedLoss: null,
        interventionCost: null,
        decisionGate: "SEEK_CONFIRMATION",
        economicJustification:
          "Economic assessment has not run.",
        flags: [],
      },

      safety: {
        deterministicChecks: [],
        violations: [],
        status: "PENDING",
      },

      review: {
        verdict: "VETO",
        concerns: [],
        requiredChanges: [],
        cycleCount: 0,
      },

      workflow: {
        current: "INTAKE",
        trace: ["INTAKE"],
        negativeConstraints: [],

        // NEW:
        // Stores the exact proposal → safety → reviewer result
        // for every reasoning cycle.
        cycles: [],
      },
    };

    // ---------------------------------------------------------
    // 1. PERCEPTION
    // ---------------------------------------------------------

    this.transition(state, "PERCEPTION");

    try {
      Object.assign(
        state.observations,
        await this.deps.perception.observe(state),
      );
    } catch (error) {
      if (error instanceof PerceptionProviderFormatError) {
        return this.completePerceptionProviderFailure(state, now);
      }

      throw error;
    }

    const confidence = Math.max(
      ...state.observations.visualFindings.map(
        (finding) => finding.confidence,
      ),
      0,
    );

    if (confidence < 0.7) {
      return this.completeRequestMoreData(state, now);
    }

    // ---------------------------------------------------------
    // 2. FIELD CONTEXT
    // ---------------------------------------------------------

    this.transition(state, "CONTEXT");

    const retrieved = await this.deps.context.retrieve({
      farmId,
      plotId,
      now,
    });

    state.farm = retrieved.farm;
    state.environment = retrieved.environment;
    state.history = retrieved.history;
    state.context = retrieved.context;

    if (
      !state.context.ready ||
      !state.farm ||
      !state.environment ||
      !state.history
    ) {
      return this.completeContextUnavailable(state, now);
    }

    // ---------------------------------------------------------
    // 3. RISK & ECONOMICS
    // ---------------------------------------------------------

    this.transition(state, "RISK_ECONOMICS");

    ({
      risk: state.risk,
      economics: state.economics,
    } = await this.deps.riskEconomics.assess(state));

    if (
      state.economics.decisionGate ===
      "SEEK_CONFIRMATION"
    ) {
      return this.completeEconomicsUnavailable(state, now);
    }

    // ---------------------------------------------------------
    // 4. DECISION LOOP
    // ---------------------------------------------------------
    //
    // Each pass through this loop is one complete reasoning cycle:
    //
    // SYNTHESIS
    //     ↓
    // SAFETY_CHECK
    //     ↓
    // REVIEW
    //     ↓
    // APPROVE → FINALIZE
    //
    // or
    //
    // VETO
    //     ↓
    // REPLAN
    //     ↓
    // SYNTHESIS again
    //
    // Maximum two review cycles are allowed.
    // ---------------------------------------------------------

    for (;;) {
      const cycle = state.review.cycleCount;

      // -------------------------------------------------------
      // 4A. SYNTHESIS
      // -------------------------------------------------------

      this.transition(state, "SYNTHESIS");

      state.proposedDecision =
        await this.deps.synthesizer.propose(state);

      // -------------------------------------------------------
      // 4B. DETERMINISTIC SAFETY ENGINE
      // -------------------------------------------------------

      this.transition(state, "SAFETY_CHECK");

      state.safety =
        await this.deps.safety.evaluate(state);

      // -------------------------------------------------------
      // 4C. ADVERSARIAL REVIEW
      // -------------------------------------------------------

      this.transition(state, "REVIEW");

      state.review =
        await this.deps.reviewer.review(state);

      // -------------------------------------------------------
      // 4D. SAVE EXACT CYCLE
      // -------------------------------------------------------
      //
      // This MUST happen before any state is modified for the
      // next replan.
      //
      // Example:
      //
      // Cycle 0:
      //   BIOLOGICAL_INTERVENTION
      //   ↓
      //   WX-001 BLOCKED
      //   ↓
      //   VETO
      //
      // Cycle 1:
      //   WAIT_FOR_SAFE_WEATHER_WINDOW
      //   ↓
      //   PASS
      //   ↓
      //   APPROVE
      //
      // The frontend receives both cycles.
      // -------------------------------------------------------

      this.recordDecisionCycle(state, cycle);

      // -------------------------------------------------------
      // 4E. APPROVED
      // -------------------------------------------------------

      if (state.review.verdict === "APPROVE") {
        break;
      }

      // -------------------------------------------------------
      // 4F. MAXIMUM REPLAN LIMIT
      // -------------------------------------------------------

      if (state.review.cycleCount >= 2) {
        return this.completeSafeFallback(state, now);
      }

      // -------------------------------------------------------
      // 4G. REPLAN
      // -------------------------------------------------------

      state.review.cycleCount += 1;

      state.workflow.negativeConstraints.push(
        ...state.review.requiredChanges,
      );

      this.transition(state, "REPLAN");
    }

    // ---------------------------------------------------------
    // 5. FINALIZE
    // ---------------------------------------------------------

    this.transition(state, "FINALIZE");

    const decision = this.record(
      state,
      now,
      "FINAL",
    );

    // ---------------------------------------------------------
    // 6. MEMORY WRITE
    // ---------------------------------------------------------

    this.transition(state, "MEMORY_WRITE");

    await this.deps.memory.save(decision);

    // ---------------------------------------------------------
    // 7. DONE
    // ---------------------------------------------------------

    this.transition(state, "DONE");

    return {
      caseState: state,
      decision,
    };
  }

  // ===========================================================
  // DECISION RECORD
  // ===========================================================

  private record(
    state: CaseState,
    now: Date,
    status: "FINAL" | "SAFE_FALLBACK",
  ): DecisionRecord {
    const proposal = state.proposedDecision!;

    return {
      decisionId: randomUUID(),

      caseId: state.case.caseId,

      farmId: state.case.farmId,

      plotId: state.case.plotId,

      createdAt: now.toISOString(),

      riskLevel: state.risk.overallRisk,

      proposedAction: proposal.action,

      finalAction: proposal.action,

      economicJustification:
        state.economics.economicJustification,

      deterministicResult:
        state.safety.status === "PASS"
          ? "PASS"
          : "BLOCKED",

      reviewerVerdict:
        state.review.verdict,

      replanCount:
        state.review.cycleCount,

      confidence:
        proposal.confidence,

      status,

      language:
        state.case.language,
    };
  }

  // ===========================================================
  // SAFE FALLBACK
  // ===========================================================

  private completeSafeFallback(
    state: CaseState,
    now: Date,
  ): DecisionResponse {
    this.transition(
      state,
      "SAFE_FALLBACK",
    );

    state.proposedDecision = {
      action: "SEEK_EXPERT_CONFIRMATION",

      reason:
        "Current evidence and conditions do not support a reliable intervention recommendation.",

      reasoningSummary:
        "The system could not obtain an approved intervention within the maximum review cycles.",

      evidence: [],

      confidence: 0.4,

      constraints:
        [...state.workflow.negativeConstraints],

      uncertainties:
        [...state.risk.flags],

      missingData: [],
    };

    const decision = this.record(
      state,
      now,
      "SAFE_FALLBACK",
    );

    this.transition(
      state,
      "DONE",
    );

    return {
      caseState: state,
      decision,
    };
  }

  // ===========================================================
  // CONTEXT UNAVAILABLE
  // ===========================================================

  private completeContextUnavailable(
    state: CaseState,
    now: Date,
  ): DecisionResponse {
    this.transition(
      state,
      "SAFE_FALLBACK",
    );

    state.proposedDecision = {
      action: "SEEK_EXPERT_CONFIRMATION",

      reason:
        "Field context is incomplete, conflicting, or unavailable; no decision was derived from missing facts.",

      reasoningSummary:
        "Required farm, environment, or history context could not be reliably retrieved.",

      evidence:
        state.context.toolFlags
          .filter(
            (flag) =>
              flag.status !== "RETRIEVED",
          )
          .map(
            (flag) =>
              `${flag.tool}: ${flag.status}`,
          ),

      confidence: 0.4,

      constraints: [],

      uncertainties: [],

      missingData:
        state.context.toolFlags
          .filter(
            (flag) =>
              flag.status !== "RETRIEVED",
          )
          .map(
            (flag) =>
              flag.tool,
          ),
    };

    const decision = this.record(
      state,
      now,
      "SAFE_FALLBACK",
    );

    this.transition(
      state,
      "DONE",
    );

    return {
      caseState: state,
      decision,
    };
  }

  // ===========================================================
  // ECONOMICS UNAVAILABLE
  // ===========================================================

  private completeEconomicsUnavailable(
    state: CaseState,
    now: Date,
  ): DecisionResponse {
    this.transition(
      state,
      "SAFE_FALLBACK",
    );

    state.proposedDecision = {
      action: "SEEK_EXPERT_CONFIRMATION",

      reason:
        "Economic inputs are incomplete, conflicting, invalid, or unavailable; no monetary value was inferred.",

      reasoningSummary:
        "The economic gate could not authorize a reliable intervention decision.",

      evidence:
        state.economics.flags.map(
          (flag) =>
            `${flag.field}: ${flag.status}`,
        ),

      confidence: 0.4,

      constraints: [],

      uncertainties: [],

      missingData:
        state.economics.flags
          .filter(
            (flag) =>
              flag.status !== "RETRIEVED",
          )
          .map(
            (flag) =>
              flag.field,
          ),
    };

    const decision = this.record(
      state,
      now,
      "SAFE_FALLBACK",
    );

    this.transition(
      state,
      "DONE",
    );

    return {
      caseState: state,
      decision,
    };
  }

  // ===========================================================
  // REQUEST MORE DATA
  // ===========================================================

  private completeRequestMoreData(
    state: CaseState,
    now: Date,
  ): DecisionResponse {
    this.transition(
      state,
      "REQUEST_MORE_DATA",
    );

    state.proposedDecision = {
      action: "SEEK_EXPERT_CONFIRMATION",

      reason:
        "Please provide a clearer image or fuller symptom description before a disease-specific recommendation.",

      reasoningSummary:
        "Perception confidence was below the minimum evidence threshold for a disease-specific decision.",

      evidence: [],

      confidence: 0.4,

      constraints: [],

      uncertainties:
        [...state.observations.uncertainties],

      missingData: [
        "Clearer visual evidence or fuller symptom description",
      ],
    };

    const decision = this.record(
      state,
      now,
      "SAFE_FALLBACK",
    );

    this.transition(
      state,
      "DONE",
    );

    return {
      caseState: state,
      decision,
    };
  }

  // ===========================================================
  // PERCEPTION PROVIDER FAILURE
  // ===========================================================

  private completePerceptionProviderFailure(
    state: CaseState,
    now: Date,
  ): DecisionResponse {
    this.transition(
      state,
      "SAFE_FALLBACK",
    );

    state.proposedDecision = {
      action: "SEEK_EXPERT_CONFIRMATION",

      reason:
        "The perception model provider did not return the required structured observation output; no findings could be derived.",

      reasoningSummary:
        "The perception provider failed to produce the structured observation contract required by the decision pipeline.",

      evidence: [],

      confidence: 0.4,

      constraints: [],

      uncertainties: [
        "Perception provider output was unavailable or invalid.",
      ],

      missingData: [
        "Structured perception output",
      ],
    };

    const decision = this.record(
      state,
      now,
      "SAFE_FALLBACK",
    );

    this.transition(
      state,
      "DONE",
    );

    return {
      caseState: state,
      decision,
    };
  }
}

// =============================================================
// PROVIDER SELECTION
// =============================================================

const modelProvider =
  process.env.MODEL_PROVIDER ?? "openai";

function defaultPerceptionModel(): PerceptionModel {
  return modelProvider === "openrouter"
    ? new OpenRouterChatCompletionsPerceptionModel()
    : new OpenAIResponsesPerceptionModel();
}

function defaultSynthesizerModel(): DecisionSynthesizerModel {
  return modelProvider === "openrouter"
    ? new OpenRouterChatCompletionsDecisionSynthesizerModel()
    : new OpenAIResponsesDecisionSynthesizerModel();
}

function defaultReviewerModel(): DecisionReviewerModel {
  return modelProvider === "openrouter"
    ? new OpenRouterChatCompletionsDecisionReviewerModel()
    : new OpenAIResponsesDecisionReviewerModel();
}

// =============================================================
// DEFAULT ORCHESTRATOR
// =============================================================

export function createDefaultOrchestrator(
  memory: DecisionMemory,

  perception: PerceptionAgent =
    new RealPerceptionAgent(
      defaultPerceptionModel(),
    ),

  context: FieldContextAgent =
    new ToolFieldContextAgent(
      mockTools,
      mockTools,
    ),

  riskEconomics: RiskEconomicsAgent =
    new ToolRiskEconomicsAgent(
      mockTools,
    ),

  synthesizer: Synthesizer =
    new RealDecisionSynthesizerAgent(
      defaultSynthesizerModel(),
      mockTools,
    ),

  reviewer: Reviewer =
    new RealAdversarialReviewerAgent(
      defaultReviewerModel(),
    ),
): DecisionOrchestrator {
  return new DecisionOrchestrator({
    context,
    riskEconomics,
    safety: new SafetyEngine(mockTools),
    memory,
    perception,
    synthesizer,
    reviewer,
  });
}