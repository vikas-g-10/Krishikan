const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  "https://krishi-nexus-backend-6ci4.onrender.com";

export interface SafetyCheck {
  ruleId: string;
  passed: boolean;
  severity?: string;
  reason: string;
}

export interface ProposedDecision {
  action: string;
  reason: string;
  reasoningSummary: string;
  evidence: string[];
  confidence: number;
  interventionId?: string;
  constraints: string[];
  uncertainties: string[];
  missingData: string[];
}

export interface CycleSafety {
  deterministicChecks: SafetyCheck[];
  violations: SafetyCheck[];
  status: string;
}

export interface CycleReview {
  verdict: string;
  concerns: string[];
  requiredChanges: string[];
  cycleCount: number;
}

/**
 * Represents one complete decision attempt:
 *
 * Cycle 1:
 *   AI proposal -> Safety Engine -> Adversarial Reviewer
 *
 * Cycle 2:
 *   Replanned proposal -> Safety Engine -> Adversarial Reviewer
 */
export interface DecisionCycle {
  cycle: number;
  proposal: ProposedDecision;
  safety: CycleSafety;
  review: CycleReview;
}

export interface KrishiDemoResponse {
  caseState: {
    case: {
      caseId: string;
      farmId: string;
      plotId: string;
      createdAt: string;
      language: string;
      mode: string;
    };

    farm: {
      location: string;
      crop: string;
      variety: string;
      acreage: number;
      sowingDate: string;
      cropStage: string;
    };

    observations: {
      farmerText: string;
      images: unknown[];
      visualFindings: Array<{
        finding: string;
        confidence: number;
        uncertainty?: string;
      }>;
      symptomFindings: string[];
      uncertainties: string[];
    };

    environment: {
      temperature: number;
      humidity: number;
      rainfallLast24h: number;
      soilMoisture: number;
      soilMetrics?: Record<string, number>;
      forecast: Array<{
        date: string;
        rainMm: number;
        humidity: number;
      }>;
    };

    history: {
      previousDecisions: string[];
      previousInterventions: string[];
      previousOutcomes: string[];
    };

    context: {
      retrievedFacts: {
        farm: string[];
        environment: string[];
        history: string[];
      };
      derivedContext: string[];
      toolFlags: Array<{
        tool: string;
        status: string;
        detail?: string;
      }>;
      conflicts: Array<{
        field: string;
        farmValue: number;
        weatherValue: number;
      }>;
      ready: boolean;
    };

    risk: {
      diseaseRisk: number;
      weatherRisk: number;
      cropStress: number;
      overallRisk: string;
      factors: string[];
      flags: string[];
    };

    economics: {
      source: string;
      cropValue: number | null;
      expectedLoss: number | null;
      interventionCost: number | null;
      decisionGate: string;
      economicJustification: string;
      flags: Array<{
        field?: string;
        status?: string;
        detail?: string;
      }>;
    };

    safety: {
      deterministicChecks: SafetyCheck[];
      violations: SafetyCheck[];
      status: string;
    };

    review: {
      verdict: string;
      concerns: string[];
      requiredChanges: string[];
      cycleCount: number;
    };

    workflow: {
      current: string;
      trace: string[];
      negativeConstraints: string[];

      /**
       * Exact proposal/safety/reviewer information for every
       * synthesis cycle performed by the orchestrator.
       */
      cycles?: DecisionCycle[];
    };

    /**
     * This is the final proposal after any replanning.
     */
    proposedDecision: ProposedDecision;
  };

  decision: {
    decisionId: string;
    caseId: string;
    farmId: string;
    plotId: string;
    createdAt: string;
    riskLevel: string;
    proposedAction: string;
    finalAction: string;
    economicJustification: string;
    deterministicResult: string;
    reviewerVerdict: string;
    replanCount: number;
    confidence: number;
    status: string;
    language: string;
  };
}

export async function runTomatoDemo(): Promise<KrishiDemoResponse> {
  const response = await fetch(`${API_BASE_URL}/api/v1/demo/tomato`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `KRISHI-NEXUS backend returned HTTP ${response.status}`,
    );
  }

  return response.json() as Promise<KrishiDemoResponse>;
}