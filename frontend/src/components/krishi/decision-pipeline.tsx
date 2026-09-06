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
import { decisionScenario } from "@/data/mock-ai-decision";

type StepStatus = "proposed" | "blocked" | "veto" | "safe" | "neutral";

const badgeStyles: Record<StepStatus, string> = {
  proposed: "bg-status-watch/15 text-status-watch ring-status-watch/30",
  blocked: "bg-status-alert/12 text-status-alert ring-status-alert/25",
  veto: "bg-status-alert/12 text-status-alert ring-status-alert/25",
  safe: "bg-status-good/12 text-status-good ring-status-good/25",
  neutral: "bg-muted text-muted-foreground ring-border",
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
  icon: React.ReactNode;
  status?: StepStatus;
  isLast?: boolean;
  children: React.ReactNode;
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
      {/* Timeline rail */}
      {!isLast && (
        <div
          className="absolute left-[19px] top-10 w-px flex-1 bg-border"
          style={{ height: "calc(100% - 2.5rem)" }}
          aria-hidden
        />
      )}

      {/* Step marker */}
      <div className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/20">
        {icon}
      </div>

      {/* Step card */}
      <div
        className={cn("panel flex-1 p-4 sm:p-5", isLast && "border-primary/30 bg-primary-soft/40")}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Step {step}
            </p>
            <h3 className="mt-0.5 text-base font-bold sm:text-lg">{title}</h3>
          </div>
          <StepBadge status={status} />
        </div>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  );
}

export function DecisionPipeline() {
  const s = decisionScenario;

  return (
    <div className="space-y-6">
      {/* Scenario context card */}
      <section className="panel field-grid p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Decision scenario
            </p>
            <h2 className="mt-1 text-xl font-bold sm:text-2xl">
              {s.farm.crop} — {s.farm.variety}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {s.farm.location} · {s.farm.area} · {s.farm.growthStage} stage
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-status-watch/15 px-2.5 py-1 text-[11px] font-semibold text-status-watch ring-1 ring-status-watch/30">
            <span className="size-1.5 rounded-full bg-current" aria-hidden />
            Demo data
          </span>
        </div>
      </section>

      {/* Pipeline */}
      <section className="space-y-6" aria-label="AI decision pipeline">
        <PipelineStep
          step={1}
          title="Perception"
          icon={<ScanLine className="size-5" />}
          status="neutral"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl bg-muted/60 p-3">
              <p className="text-xs text-muted-foreground">Observation</p>
              <p className="mt-1 text-sm font-semibold text-foreground">{s.perception.title}</p>
            </div>
            <div className="rounded-2xl bg-muted/60 p-3">
              <p className="text-xs text-muted-foreground">Confidence</p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {s.perception.confidence}%
              </p>
            </div>
          </div>
          <p className="mt-3 text-xs italic text-muted-foreground">{s.perception.note}</p>
        </PipelineStep>

        <PipelineStep
          step={2}
          title="Field context"
          icon={<CloudRain className="size-5" />}
          status="neutral"
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Humidity" value={`${s.fieldContext.humidityPct}%`} />
            <Metric label="Rainfall (24h)" value={`${s.fieldContext.rainfallLast24hMm} mm`} />
            <Metric label="Soil moisture" value={`${s.fieldContext.soilMoisturePct}%`} />
            <Metric label="Forecast" value={s.fieldContext.forecastNote} />
          </div>
        </PipelineStep>

        <PipelineStep
          step={3}
          title="Risk & economics"
          icon={<TrendingUp className="size-5" />}
          status="blocked"
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric
              label="Risk level"
              value={s.riskEconomics.riskLevel}
              valueClass="text-status-alert"
            />
            <Metric
              label="Expected loss (DEMO / SEEDED)"
              value={`₹${s.riskEconomics.expectedLossINR.toLocaleString("en-IN")}`}
            />
            <Metric
              label="Intervention cost (DEMO / SEEDED)"
              value={`₹${s.riskEconomics.interventionCostINR.toLocaleString("en-IN")}`}
            />
            <Metric label="Source" value={s.riskEconomics.note} />
          </div>
        </PipelineStep>

        <PipelineStep
          step={4}
          title="Initial AI proposal"
          icon={<Leaf className="size-5" />}
          status="proposed"
        >
          <p className="text-sm font-semibold text-foreground">{s.initialProposal.title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{s.initialProposal.description}</p>
          <p className="mt-3 text-xs text-status-watch">
            This is a proposed decision, not the final decision.
          </p>
        </PipelineStep>

        <PipelineStep
          step={5}
          title="Safety engine"
          icon={<ShieldAlert className="size-5" />}
          status="blocked"
        >
          <p className="text-sm text-foreground">{s.safetyEngine.reason}</p>
        </PipelineStep>

        <PipelineStep
          step={6}
          title="Adversarial review"
          icon={<Scale className="size-5" />}
          status="veto"
        >
          <p className="text-sm text-foreground">{s.adversarialReview.reason}</p>
        </PipelineStep>

        <PipelineStep
          step={7}
          title="Replan"
          icon={<RefreshCw className="size-5" />}
          status="neutral"
        >
          <p className="text-sm text-foreground">
            Cycle {s.replan.cycle}: {s.replan.note}
          </p>
        </PipelineStep>

        <PipelineStep
          step={8}
          title="Final decision"
          icon={<CheckCircle2 className="size-5" />}
          status="safe"
          isLast
        >
          <div className="rounded-2xl bg-status-good/10 p-4 ring-1 ring-status-good/20">
            <p className="text-lg font-bold tracking-tight text-status-good">
              {s.finalDecision.title}
            </p>
            <p className="mt-2 text-sm text-foreground">{s.finalDecision.description}</p>
          </div>
          <p className="mt-3 text-xs text-status-good">
            This is the final decision. It clearly differs from the initial proposal.
          </p>
        </PipelineStep>
      </section>

      {/* Trace footer */}
      <div className="flex items-center justify-between rounded-2xl border border-dashed border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
        <span>Decision trace ID: KN-DEMO-KOLAR-TOM-001</span>
        <span>Generated for demo purposes only</span>
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
  value: React.ReactNode;
  valueClass?: string;
}) {
  return (
    <div className="rounded-2xl bg-muted/60 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-sm font-semibold text-foreground", valueClass)}>{value}</p>
    </div>
  );
}
