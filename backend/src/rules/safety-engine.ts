import type { AgricultureTools } from "../tools/seeded-tools.ts";
import type { CaseState, SafetyCheck } from "../types/contracts.ts";

export class SafetyEngine {
  private readonly agriculture: AgricultureTools;
  constructor(agriculture: AgricultureTools) { this.agriculture = agriculture; }
  async evaluate(state: CaseState): Promise<CaseState["safety"]> {
    const proposal = state.proposedDecision!;
    const checks: SafetyCheck[] = [];
    const evidence = Math.max(...state.observations.visualFindings.map(f => f.confidence), 0);
    checks.push({ ruleId: "EVID-001", passed: evidence >= 0.7 || proposal.action === "MONITOR" || proposal.action === "WAIT_FOR_SAFE_WEATHER_WINDOW", severity: "HIGH", reason: "Disease-specific intervention requires visual confidence of at least 0.70." });
    if (proposal.interventionId) {
      const intervention = await this.agriculture.getIntervention(proposal.interventionId);
      checks.push({ ruleId: "GREEN-001", passed: Boolean(intervention), severity: "HIGH", reason: "The intervention must be present in the vetted seeded knowledge base." });
      checks.push({ ruleId: "STAGE-001", passed: Boolean(intervention?.compatibleStages.includes(state.farm.cropStage)), severity: "HIGH", reason: "The intervention must be compatible with the crop stage." });
      const rainExpected = state.environment.forecast.some(day => day.rainMm > 0);
      checks.push({ ruleId: "WX-001", passed: !(intervention?.foliar && rainExpected), severity: "HIGH", reason: "Rain is expected during the foliar intervention window." });
      checks.push({ ruleId: "ECON-001", passed: state.economics.interventionCost !== null && state.economics.expectedLoss !== null && state.economics.interventionCost <= state.economics.expectedLoss, severity: "MEDIUM", reason: "Intervention cost is unavailable or exceeds expected loss." });
    }
    const violations = checks.filter(check => !check.passed);
    // Keep every evaluation in the audit trace; only current-cycle violations affect status.
    return { deterministicChecks: [...state.safety.deterministicChecks, ...checks], violations, status: violations.length ? "BLOCKED" : "PASS" };
  }
}
