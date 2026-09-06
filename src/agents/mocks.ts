import type { CaseState, ProposedDecision, Review } from "../types/contracts.ts";

export interface PerceptionAgent { observe(state: CaseState): Promise<Pick<CaseState["observations"], "visualFindings" | "symptomFindings" | "uncertainties">>; }
export interface Synthesizer { propose(state: CaseState): Promise<ProposedDecision>; }
export interface Reviewer { review(state: CaseState): Promise<Review>; }

export const mockPerception: PerceptionAgent = {
  async observe(state) {
    const text = `${state.observations.farmerText} ${state.observations.voiceTranscript ?? ""}`.toLowerCase();
    const hasSpots = text.includes("spot") || text.includes("lesion") || text.includes("ಕಲೆ");
    return {
      visualFindings: hasSpots ? [{ finding: "leaf spots", confidence: 0.81 }] : [{ finding: "unconfirmed foliar symptom", confidence: 0.45 }],
      symptomFindings: hasSpots ? ["leaf_spots", "increasing_affected_area"] : ["insufficient_description"],
      uncertainties: hasSpots ? ["Image-based confirmation is unavailable in mock mode."] : ["The description does not identify a clear visual symptom."]
    };
  }
};

export const mockSynthesizer: Synthesizer = {
  async propose(state) {
    if (state.economics.decisionGate === "MONITOR" || state.economics.decisionGate === "WAIT") return { action: "MONITOR", reason: "The deterministic risk and economics gate does not justify an intervention today.", reasoningSummary: "The economics gate is not an intervention authorization.", evidence: [state.economics.economicJustification], confidence: 0.8, constraints: [], uncertainties: state.risk.flags, missingData: [] };
    if (state.workflow.negativeConstraints.some(x => x.includes("foliar"))) {
      return { action: "WAIT_FOR_SAFE_WEATHER_WINDOW", reason: "Rain makes the current foliar window unsuitable; reassess after the wet forecast.", reasoningSummary: "The existing negative constraint excludes a foliar action in this weather window.", evidence: ["WX-001 constraint", "high humidity", "increasing leaf spots"], confidence: 0.88, constraints: state.workflow.negativeConstraints, uncertainties: state.risk.flags, missingData: [] };
    }
    return { action: "BIOLOGICAL_INTERVENTION", interventionId: "TOM-BIO-001", reason: "Seeded symptoms and risk indicate a potential biological intervention after checks.", reasoningSummary: "This remains a proposal that requires deterministic safety approval.", evidence: ["leaf spots", "high humidity", "economic threshold crossed"], confidence: 0.81, constraints: [], uncertainties: state.risk.flags, missingData: [] };
  }
};

export const mockReviewer: Reviewer = {
  async review(state) {
    const proposal = state.proposedDecision!;
    if (state.safety.status === "BLOCKED") return { verdict: "VETO", concerns: state.safety.violations.map(v => v.reason), requiredChanges: ["Do not recommend foliar intervention during the current rain window."], cycleCount: state.review.cycleCount };
    if (proposal.action === "WAIT_FOR_SAFE_WEATHER_WINDOW") return { verdict: "APPROVE", concerns: [], requiredChanges: [], cycleCount: state.review.cycleCount };
    return { verdict: "APPROVE", concerns: [], requiredChanges: [], cycleCount: state.review.cycleCount };
  }
};
