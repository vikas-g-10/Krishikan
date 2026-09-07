export type Language = "kn" | "en";

export type DecisionMode = "DIAGNOSE" | "DECIDE" | "HISTORY";

export type Action =
  | "MONITOR"
  | "CULTURAL_ACTION"
  | "BIOLOGICAL_INTERVENTION"
  | "APPROVED_GREEN_INTERVENTION"
  | "WAIT_FOR_SAFE_WEATHER_WINDOW"
  | "SEEK_EXPERT_CONFIRMATION";

export type WorkflowState =
  | "INTAKE"
  | "PERCEPTION"
  | "CONTEXT"
  | "RISK_ECONOMICS"
  | "SYNTHESIS"
  | "SAFETY_CHECK"
  | "REVIEW"
  | "REPLAN"
  | "FINALIZE"
  | "SAFE_FALLBACK"
  | "MEMORY_WRITE"
  | "DONE"
  | "REQUEST_MORE_DATA";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export type EconomicDecisionGate =
  | "INTERVENE"
  | "MONITOR"
  | "WAIT"
  | "SEEK_CONFIRMATION";

export type EconomicDataStatus =
  | "RETRIEVED"
  | "MISSING"
  | "CONFLICTING"
  | "INVALID"
  | "FAILED"
  | "TIMED_OUT";

export interface Finding {
  finding: string;
  confidence: number;
  uncertainty?: string;
}

export interface ForecastDay {
  date: string;
  rainMm: number;
  humidity: number;
}

export interface FarmState {
  location: string;
  crop: "tomato";
  variety: string;
  acreage: number;
  sowingDate: string;
  cropStage: string;
  soilMetrics?: Record<string, number>;
}

export interface EnvironmentState {
  temperature: number;
  humidity: number;
  rainfallLast24h: number;
  forecast: ForecastDay[];
  soilMoisture: number;
  soilMetrics: Record<string, number>;
}

export interface FarmHistory {
  previousDecisions: string[];
  previousInterventions: string[];
  previousOutcomes: string[];
}

export type ContextToolStatus =
  | "RETRIEVED"
  | "MISSING"
  | "CONFLICTING"
  | "FAILED"
  | "TIMED_OUT"
  | "SKIPPED";

export interface ContextToolFlag {
  tool: "farm.get_state" | "weather.get_forecast" | "farm.get_history";
  status: ContextToolStatus;
  detail?: string;
}

export interface ContextConflict {
  field: string;
  farmValue: number;
  weatherValue: number;
}

export interface FieldContext {
  retrievedFacts: {
    farm: string[];
    environment: string[];
    history: string[];
  };
  derivedContext: string[];
  toolFlags: ContextToolFlag[];
  conflicts: ContextConflict[];
  ready: boolean;
}

export interface Intervention {
  id: string;
  label: string;
  action: Action;
  foliar: boolean;
  compatibleStages: string[];
  costPerAcre: number;
}

/**
 * A proposal only.
 *
 * The Safety Engine remains the authority that may permit or block it.
 * The LLM is never the final authority for an intervention.
 */
export interface ProposedDecision {
  action: Action;
  reason: string;
  reasoningSummary: string;
  evidence: string[];
  confidence: number;
  interventionId?: string;
  constraints: string[];
  uncertainties: string[];
  missingData: string[];
}

export interface SafetyCheck {
  ruleId: string;
  passed: boolean;
  severity?: "HIGH" | "MEDIUM";
  reason: string;
}

export interface Review {
  verdict: "APPROVE" | "VETO";
  concerns: string[];
  requiredChanges: string[];
  cycleCount: number;
}

export interface EconomicFlag {
  field:
    | "cropValue"
    | "expectedLoss"
    | "interventionCost"
    | "economicData";
  status: EconomicDataStatus;
  detail?: string;
}

export interface RiskAssessment {
  diseaseRisk: number;
  weatherRisk: number;
  cropStress: number;
  overallRisk: RiskLevel;
  factors: string[];
  flags: string[];
}

export interface EconomicsAssessment {
  source: "SEEDED_DEMO" | "LIVE" | "UNAVAILABLE";
  cropValue: number | null;
  expectedLoss: number | null;
  interventionCost: number | null;
  economicJustification: string;
  decisionGate: EconomicDecisionGate;
  flags: EconomicFlag[];
}

/**
 * One complete reasoning cycle.
 *
 * Example:
 *
 * Cycle 0
 *   Proposal -> Safety Engine -> Reviewer VETO
 *
 * Cycle 1
 *   Replanned Proposal -> Safety Engine -> Reviewer APPROVE
 *
 * The frontend can use this to render the exact decision trace
 * instead of reconstructing or guessing what happened.
 */
export interface DecisionCycle {
  cycle: number;

  proposal: ProposedDecision;

  safety: {
    deterministicChecks: SafetyCheck[];
    violations: SafetyCheck[];
    status: "PENDING" | "PASS" | "BLOCKED";
  };

  review: Review;
}

export interface CaseState {
  case: {
    caseId: string;
    farmId: string;
    plotId: string;
    createdAt: string;
    language: Language;
    mode: DecisionMode;
  };

  farm: FarmState | null;

  observations: {
    farmerText: string;
    voiceTranscript?: string;
    images: string[];
    visualFindings: Finding[];
    symptomFindings: string[];
    uncertainties: string[];
  };

  environment: EnvironmentState | null;

  history: FarmHistory | null;

  context: FieldContext;

  risk: RiskAssessment;

  economics: EconomicsAssessment;

  /**
   * The currently active/final proposal.
   *
   * After replanning this will contain the final proposal.
   */
  proposedDecision?: ProposedDecision;

  safety: {
    deterministicChecks: SafetyCheck[];
    violations: SafetyCheck[];
    status: "PENDING" | "PASS" | "BLOCKED";
  };

  review: Review;

  workflow: {
    current: WorkflowState;

    trace: WorkflowState[];

    negativeConstraints: string[];

    /**
     * Exact history of every synthesis/safety/reviewer cycle.
     *
     * This is what allows the frontend to show:
     *
     * Cycle 1 → initial proposal → blocked → veto
     * Cycle 2 → replanned proposal → approved
     */
    cycles: DecisionCycle[];
  };
}

export interface DecisionRecord {
  decisionId: string;
  caseId: string;
  farmId: string;
  plotId: string;
  createdAt: string;
  riskLevel: RiskLevel;
  proposedAction: Action;
  finalAction: Action;
  economicJustification: string;
  deterministicResult: "PASS" | "BLOCKED";
  reviewerVerdict: "APPROVE" | "VETO";
  replanCount: number;
  confidence: number;
  status: "FINAL" | "SAFE_FALLBACK";
  language: Language;
}

export interface DecisionResponse {
  caseState: CaseState;
  decision: DecisionRecord;
}