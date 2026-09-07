import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import {
  ScanLine,
  CloudRain,
  TrendingUp,
  Leaf,
  ShieldAlert,
  Scale,
  RefreshCw,
  CheckCircle2,
} from "lucide-react";

import { cn } from "@/lib/utils";

import {
  runTomatoDemo,
  type KrishiDemoResponse,
} from "@/lib/krishi-api";

type StepStatus =
  | "proposed"
  | "blocked"
  | "veto"
  | "safe"
  | "neutral";

const badgeStyles: Record<StepStatus, string> = {
  proposed:
    "bg-status-watch/15 text-status-watch ring-status-watch/30",
  blocked:
    "bg-status-alert/12 text-status-alert ring-status-alert/25",
  veto:
    "bg-status-alert/12 text-status-alert ring-status-alert/25",
  safe:
    "bg-status-good/12 text-status-good ring-status-good/25",
  neutral:
    "bg-muted text-muted-foreground ring-border",
};

const badgeLabels: Record<StepStatus, string> = {
  proposed: "PROPOSED",
  blocked: "BLOCKED",
  veto: "VETO",
  safe: "SAFE",
  neutral: "INFO",
};

function StepBadge({ status }: { status: StepStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset",
        badgeStyles[status],
      )}
    >
      {badgeLabels[status]}
    </span>
  );
}

interface PipelineStepProps {
  step: number;
  title: string;
  icon: ReactNode;
  status?: StepStatus;
  isLast?: boolean;
  children: ReactNode;
}

function PipelineStep({
  step,
  title,
  icon,
  status = "neutral",
  isLast,
  children,
}: PipelineStepProps) {
  return (
    <div className="relative flex gap-4">
      {!isLast && (
        <div
          className="absolute left-[19px] top-10 w-px flex-1 bg-border"
          style={{
            height: "calc(100% - 2.5rem)",
          }}
          aria-hidden
        />
      )}

      <div className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/20">
        {icon}
      </div>

      <div
        className={cn(
          "panel flex-1 p-4 sm:p-5",
          isLast && "border-primary/30 bg-primary-soft/40",
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Step {step}
            </p>

            <h3 className="mt-0.5 text-base font-bold sm:text-lg">
              {title}
            </h3>
          </div>

          <StepBadge status={status} />
        </div>

        <div className="mt-3">{children}</div>
      </div>
    </div>
  );
}

export function DecisionPipeline() {
  const [data, setData] = useState<KrishiDemoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadDecision() {
    try {
      setLoading(true);
      setError(null);

      const result = await runTomatoDemo();

      setData(result);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to connect to KRISHI-NEXUS backend.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDecision();
  }, []);

  if (loading) {
    return (
      <section className="panel p-6">
        <div className="flex items-center gap-3">
          <RefreshCw className="size-5 animate-spin text-primary" />

          <div>
            <p className="font-semibold">
              Running KRISHI-NEXUS decision pipeline...
            </p>

            <p className="mt-1 text-sm text-muted-foreground">
              Connecting to the live agricultural AI backend.
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (error || !data) {
    return (
      <section className="panel p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-semibold text-status-alert">
              Backend connection failed
            </p>

            <p className="mt-1 text-sm text-muted-foreground">
              {error ?? "No decision data was returned."}
            </p>
          </div>

          <button
            type="button"
            onClick={() => void loadDecision()}
            className="rounded-xl border border-border px-3 py-2 text-sm font-semibold hover:bg-muted"
          >
            Retry
          </button>
        </div>
      </section>
    );
  }

  const { caseState, decision } = data;

  const cycles = caseState.workflow.cycles ?? [];
  const firstCycle = cycles[0];
  const secondCycle = cycles[1];

  const perception = caseState.observations.visualFindings[0];

  const failedChecks =
    firstCycle?.safety.deterministicChecks.filter(
      (check) => !check.passed,
    ) ?? [];

  const weatherBlock =
    failedChecks.find((check) => check.ruleId === "WX-001") ??
    firstCycle?.safety.violations.find(
      (violation) => violation.ruleId === "WX-001",
    );

  const forecastText =
    caseState.environment.forecast.length > 0
      ? caseState.environment.forecast
          .map(
            (item) =>
              `${item.date}: ${item.rainMm} mm rain · ${item.humidity}% humidity`,
          )
          .join(" · ")
      : "No forecast data available";

  const finalAction = decision.finalAction.replaceAll("_", " ");

  const finalProposal = caseState.proposedDecision;

  return (
    <div className="space-y-6">
      {/* Scenario context */}
      <section className="panel field-grid p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Live decision scenario
              </p>

              <span className="inline-flex items-center gap-1.5 rounded-full bg-status-good/15 px-2.5 py-1 text-[11px] font-semibold text-status-good ring-1 ring-status-good/30">
                <span
                  className="size-1.5 rounded-full bg-current"
                  aria-hidden
                />
                Live backend
              </span>
            </div>

            <h2 className="mt-1 text-xl font-bold sm:text-2xl">
              {caseState.farm.crop} — {caseState.farm.variety}
            </h2>

            <p className="mt-1 text-sm text-muted-foreground">
              {caseState.farm.location} · {caseState.farm.acreage} acre ·{" "}
              {caseState.farm.cropStage} stage
            </p>
          </div>

          <div className="text-right">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Decision ID
            </p>

            <p className="mt-1 break-all text-xs font-semibold text-foreground">
              {decision.decisionId}
            </p>
          </div>
        </div>
      </section>

      {/* Pipeline */}
      <section
        className="space-y-6"
        aria-label="AI decision pipeline"
      >
        {/* Step 1 — Perception */}
        <PipelineStep
          step={1}
          title="Perception"
          icon={<ScanLine className="size-5" />}
          status="neutral"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl bg-muted/60 p-3">
              <p className="text-xs text-muted-foreground">
                Visual finding
              </p>

              <p className="mt-1 text-sm font-semibold text-foreground">
                {perception?.finding ?? "No visual finding recorded"}
              </p>
            </div>

            <div className="rounded-2xl bg-muted/60 p-3">
              <p className="text-xs text-muted-foreground">
                Confidence
              </p>

              <p className="mt-1 text-sm font-semibold text-foreground">
                {Math.round((perception?.confidence ?? 0) * 100)}%
              </p>
            </div>
          </div>

          {caseState.observations.symptomFindings.length > 0 && (
            <p className="mt-3 text-sm text-muted-foreground">
              Symptoms:{" "}
              {caseState.observations.symptomFindings.join(", ")}
            </p>
          )}

          <p className="mt-3 text-xs italic text-muted-foreground">
            {caseState.observations.uncertainties[0] ??
              "Perception is a signal, not a confirmed diagnosis."}
          </p>
        </PipelineStep>

        {/* Step 2 — Field Context */}
        <PipelineStep
          step={2}
          title="Field context"
          icon={<CloudRain className="size-5" />}
          status="neutral"
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric
              label="Humidity"
              value={`${caseState.environment.humidity}%`}
            />

            <Metric
              label="Rainfall (24h)"
              value={`${caseState.environment.rainfallLast24h} mm`}
            />

            <Metric
              label="Soil moisture"
              value={`${caseState.environment.soilMoisture}%`}
            />

            <Metric
              label="Temperature"
              value={`${caseState.environment.temperature}°C`}
            />
          </div>

          <div className="mt-3 rounded-2xl bg-muted/60 p-3">
            <p className="text-xs text-muted-foreground">
              Forecast
            </p>

            <p className="mt-1 text-sm font-semibold text-foreground">
              {forecastText}
            </p>
          </div>
        </PipelineStep>

        {/* Step 3 — Risk & Economics */}
        <PipelineStep
          step={3}
          title="Risk & economics"
          icon={<TrendingUp className="size-5" />}
          status="neutral"
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric
              label="Overall risk"
              value={caseState.risk.overallRisk}
              valueClass="text-status-alert"
            />

            <Metric
              label="Disease risk"
              value={`${Math.round(
                caseState.risk.diseaseRisk * 100,
              )}%`}
            />

            <Metric
              label="Expected loss"
              value={`₹${(
                caseState.economics.expectedLoss ?? 0
              ).toLocaleString("en-IN")}`}
            />

            <Metric
              label="Intervention cost"
              value={`₹${(
                caseState.economics.interventionCost ?? 0
              ).toLocaleString("en-IN")}`}
            />
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Metric
              label="Decision gate"
              value={caseState.economics.decisionGate}
            />

            <Metric
              label="Economics source"
              value={caseState.economics.source}
            />
          </div>

          <p className="mt-3 text-xs text-muted-foreground">
            {caseState.economics.economicJustification}
          </p>
        </PipelineStep>

        {/* Step 4 — Initial AI Proposal */}
        <PipelineStep
          step={4}
          title="Initial AI proposal — Cycle 1"
          icon={<Leaf className="size-5" />}
          status="proposed"
        >
          {firstCycle?.proposal ? (
            <>
              <p className="text-sm font-semibold uppercase tracking-wide text-foreground">
                {firstCycle.proposal.action.replaceAll("_", " ")}
              </p>

              <p className="mt-1 text-sm text-muted-foreground">
                {firstCycle.proposal.reason}
              </p>

              {firstCycle.proposal.interventionId && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Vetted intervention ID:{" "}
                  <span className="font-semibold text-foreground">
                    {firstCycle.proposal.interventionId}
                  </span>
                </p>
              )}

              <p className="mt-2 text-xs text-muted-foreground">
                Proposal confidence:{" "}
                {Math.round(firstCycle.proposal.confidence * 100)}%
              </p>

              {firstCycle.proposal.evidence.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Evidence
                  </p>

                  <div className="mt-2 flex flex-wrap gap-2">
                    {firstCycle.proposal.evidence.map((item) => (
                     <span
                        key={item}
                        className="inline-flex rounded-full bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground ring-1 ring-border/50"
                      >
                      {item}
                    </span>
                    ))}
                  </div>
                </div>
              )}

              <p className="mt-3 text-xs text-status-watch">
                This is only a proposal. The Safety Engine must
                approve it before action.
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Initial proposal data was not returned by the backend.
            </p>
          )}
        </PipelineStep>

        {/* Step 5 — Safety Engine */}
        <PipelineStep
          step={5}
          title="Safety engine — Cycle 1"
          icon={<ShieldAlert className="size-5" />}
          status={
            firstCycle?.safety.status === "BLOCKED"
              ? "blocked"
              : "safe"
          }
        >
          <p className="text-sm font-semibold">
            {firstCycle?.safety.status === "BLOCKED"
              ? "The deterministic safety engine blocked the initial proposal."
              : "All deterministic safety checks passed."}
          </p>

          {weatherBlock && (
            <div className="mt-3 rounded-2xl bg-status-alert/10 p-4 ring-1 ring-status-alert/20">
              <p className="text-sm font-semibold text-status-alert">
                Blocking rule: {weatherBlock.ruleId}
              </p>

              <p className="mt-1 text-sm text-foreground">
                {weatherBlock.reason}
              </p>
            </div>
          )}

          {failedChecks.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Failed deterministic checks
              </p>

              <div className="mt-2 space-y-2">
                {failedChecks.map((check) => (
                  <div
                    key={`${check.ruleId}-${check.reason}`}
                    className="rounded-xl bg-muted/60 p-3"
                  >
                    <p className="text-xs font-bold text-status-alert">
                      {check.ruleId} · {check.severity}
                    </p>

                    <p className="mt-1 text-xs text-muted-foreground">
                      {check.reason}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </PipelineStep>

        {/* Step 6 — Adversarial Review */}
        <PipelineStep
          step={6}
          title="Adversarial review — Cycle 1"
          icon={<Scale className="size-5" />}
          status={
            firstCycle?.review.verdict === "VETO"
              ? "veto"
              : "safe"
          }
        >
          <p className="text-sm font-semibold">
            {firstCycle?.review.verdict === "VETO"
              ? "The adversarial reviewer rejected the initial proposal."
              : "The adversarial reviewer approved the proposal."}
          </p>

          {firstCycle?.review.concerns.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Reviewer concerns
              </p>

              <ul className="mt-2 space-y-2">
                {firstCycle.review.concerns.map((concern) => (
                  <li
                    key={concern}
                    className="rounded-xl bg-muted/60 p-3 text-sm text-foreground"
                  >
                    {concern}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {firstCycle?.review.requiredChanges.length > 0 && (
            <div className="mt-3 rounded-2xl bg-status-alert/10 p-4 ring-1 ring-status-alert/20">
              <p className="text-xs font-semibold uppercase tracking-wide text-status-alert">
                Required change
              </p>

              <p className="mt-1 text-sm font-semibold text-foreground">
                {firstCycle.review.requiredChanges[0]}
              </p>
            </div>
          )}
        </PipelineStep>

        {/* Step 7 — Replan */}
        <PipelineStep
          step={7}
          title="Replan — Cycle 2"
          icon={<RefreshCw className="size-5" />}
          status="neutral"
        >
          <div className="rounded-2xl bg-muted/60 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Replan count
            </p>

            <p className="mt-1 text-lg font-bold">
              {decision.replanCount}
            </p>
          </div>

          {caseState.workflow.negativeConstraints.length > 0 && (
            <div className="mt-3 rounded-2xl bg-status-watch/10 p-4 ring-1 ring-status-watch/20">
              <p className="text-xs font-semibold uppercase tracking-wide text-status-watch">
                Negative constraint carried forward
              </p>

              <p className="mt-1 text-sm font-semibold text-foreground">
                {caseState.workflow.negativeConstraints[0]}
              </p>
            </div>
          )}

          {secondCycle?.proposal && (
            <div className="mt-3 rounded-2xl bg-primary/5 p-4 ring-1 ring-primary/15">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Revised proposal
              </p>

              <p className="mt-1 text-base font-bold text-foreground">
                {secondCycle.proposal.action.replaceAll("_", " ")}
              </p>

              <p className="mt-1 text-sm text-muted-foreground">
                {secondCycle.proposal.reason}
              </p>

              <p className="mt-2 text-xs text-muted-foreground">
                Confidence:{" "}
                {Math.round(secondCycle.proposal.confidence * 100)}%
              </p>
            </div>
          )}
        </PipelineStep>

        {/* Step 8 — Final Decision */}
        <PipelineStep
          step={8}
          title="Final decision"
          icon={<CheckCircle2 className="size-5" />}
          status="safe"
          isLast
        >
          <div className="rounded-2xl bg-status-good/10 p-4 ring-1 ring-status-good/20">
            <p className="text-lg font-bold tracking-tight text-status-good">
              {finalAction.toUpperCase()}
            </p>

            <p className="mt-2 text-sm text-foreground">
              {finalProposal.reason}
            </p>

            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Metric
                label="Reviewer"
                value={decision.reviewerVerdict}
              />

              <Metric
                label="Safety"
                value={decision.deterministicResult}
              />

              <Metric
                label="Confidence"
                value={`${Math.round(
                  decision.confidence * 100,
                )}%`}
              />
            </div>
          </div>

          <div className="mt-3 rounded-2xl bg-muted/60 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Decision reasoning
            </p>

            <p className="mt-1 text-sm text-foreground">
              {finalProposal.reasoningSummary}
            </p>
          </div>

          <p className="mt-3 text-xs text-status-good">
            Final action approved after deterministic safety
            validation and adversarial review.
          </p>
        </PipelineStep>
      </section>

      {/* Trace footer */}
      <div className="flex flex-col gap-2 rounded-2xl border border-dashed border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span>
          Decision trace ID:{" "}
          <span className="font-semibold text-foreground">
            {decision.decisionId}
          </span>
        </span>

        <span>Live data · KRISHI-NEXUS backend</span>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: ReactNode;
  valueClass?: string;
}) {
  return (
    <div className="rounded-2xl bg-muted/60 p-3">
      <p className="text-xs text-muted-foreground">
        {label}
      </p>

      <p
        className={cn(
          "mt-1 text-sm font-semibold text-foreground",
          valueClass,
        )}
      >
        {value}
      </p>
    </div>
  );
}