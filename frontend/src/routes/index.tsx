import { createFileRoute, Link } from "@tanstack/react-router";
import {
  CalendarDays,
  CloudSun,
  Droplets,
  MapPin,
  Ruler,
  Sprout,
  Thermometer,
  Wind,
  ArrowUpRight,
  FlaskConical,
} from "lucide-react";

import { AskKrishiNexus } from "@/components/krishi/ask-krishi-nexus";
import { StatusPill } from "@/components/krishi/status-pill";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { aiDecisions, cropCycle, farmer, soilReadings, weather } from "@/data/mock-farm";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Farm Dashboard — KRISHI-NEXUS" },
      {
        name: "description",
        content:
          "KRISHI-NEXUS farm dashboard: crop stage, weather advisory, soil status and the latest AI field decisions in one control room.",
      },
      { property: "og:title", content: "Farm Dashboard — KRISHI-NEXUS" },
      {
        property: "og:description",
        content: "Crop stage, weather advisory, soil status and the latest AI field decisions.",
      },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const latest = aiDecisions[0]!;

  return (
    <div className="space-y-5">
      {/* Greeting */}
      <section className="field-grid overflow-hidden rounded-3xl border border-border bg-card p-5 shadow-card sm:p-7">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-primary">Sunday, 6 September 2026 · Kharif season</p>
            <h1 className="mt-1 text-2xl font-bold text-foreground sm:text-3xl">
              Namaskara, {farmer.name.split(" ")[0]}
            </h1>
            <p className="mt-1 max-w-lg text-sm text-muted-foreground">
              Your fields have {aiDecisions.filter((d) => d.status !== "good").length} items needing
              attention today. Rain is likely — irrigation is on hold.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusPill status="watch" label="1 field alert" />
            <StatusPill status="good" label="Advisory current" />
          </div>
        </div>

        <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryStat icon={MapPin} label="Location" value={`${farmer.village}, ${farmer.district}`} />
          <SummaryStat icon={Ruler} label="Land holding" value={farmer.landHolding} />
          <SummaryStat icon={Droplets} label="Irrigation" value={farmer.irrigation} />
          <SummaryStat icon={CalendarDays} label="Season" value={cropCycle.season} />
        </dl>
      </section>

      <AskKrishiNexus />

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Crop */}
        <article className="panel p-5 lg:col-span-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Current crop
              </p>
              <h2 className="mt-1 flex items-center gap-2 text-lg font-bold">
                <Sprout className="size-5 text-primary" />
                {cropCycle.crop}
              </h2>
              <p className="text-sm text-muted-foreground">
                Variety {cropCycle.variety} · sown {cropCycle.sownOn}
              </p>
            </div>
            <StatusPill status="good" />
          </div>

          <div className="mt-5">
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-semibold text-foreground">{cropCycle.stage}</span>
              <span className="text-muted-foreground">{cropCycle.stageProgress}% of cycle</span>
            </div>
            <Progress value={cropCycle.stageProgress} className="mt-2 h-2.5" />
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <MiniStat label="Days after sowing" value={`${cropCycle.daysAfterSowing} days`} />
              <MiniStat label="Expected harvest" value={cropCycle.expectedHarvest} />
              <MiniStat label="Next operation" value="N top dressing" />
            </div>
          </div>
        </article>

        {/* Weather */}
        <article className="panel p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Weather today
              </p>
              <h2 className="mt-1 flex items-center gap-2 text-lg font-bold">
                <CloudSun className="size-5 text-sky" />
                {weather.temperatureC}°C
              </h2>
              <p className="text-sm text-muted-foreground">{weather.condition}</p>
            </div>
            <StatusPill status={weather.status} />
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <WeatherChip icon={Thermometer} label="Feels" value={`${weather.feelsLikeC}°`} />
            <WeatherChip icon={Droplets} label="Humidity" value={`${weather.humidityPct}%`} />
            <WeatherChip icon={Wind} label="Wind" value={`${weather.windKph} kph`} />
          </div>

          <p className="mt-4 rounded-2xl bg-sky/10 p-3 text-sm text-foreground">
            <span className="font-semibold">{weather.rainChancePct}% rain chance.</span>{" "}
            {weather.advisory}
          </p>

          <ul className="mt-4 grid grid-cols-5 gap-1 text-center text-[11px]">
            {weather.forecast.map((day) => (
              <li key={day.day} className="rounded-xl bg-muted px-1 py-2">
                <p className="font-semibold text-foreground">{day.day}</p>
                <p className="text-muted-foreground">{day.highC}°</p>
                <p className="text-sky">{day.rainPct}%</p>
              </li>
            ))}
          </ul>
        </article>

        {/* Soil */}
        <article className="panel p-5 lg:col-span-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Soil &amp; field status
              </p>
              <h2 className="mt-1 flex items-center gap-2 text-lg font-bold">
                <FlaskConical className="size-5 text-soil" />
                Plot readings
              </h2>
            </div>
            <Button asChild variant="ghost" size="sm" className="rounded-full">
              <Link to="/farm">
                Field map
                <ArrowUpRight className="size-4" />
              </Link>
            </Button>
          </div>

          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {soilReadings.map((reading) => (
              <li key={reading.label} className="rounded-2xl border border-border bg-muted/40 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-foreground">{reading.label}</p>
                  <StatusPill status={reading.status} label={reading.value} />
                </div>
                <Progress value={reading.progress} className="mt-2 h-1.5" />
                <p className="mt-2 text-xs text-muted-foreground">{reading.detail}</p>
              </li>
            ))}
          </ul>
        </article>

        {/* Recent decision */}
        <article className="panel flex flex-col p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Recent AI decision
              </p>
              <h2 className="mt-1 text-lg font-bold leading-snug">{latest.title}</h2>
            </div>
            <StatusPill status={latest.status} />
          </div>

          <p className="mt-3 text-sm text-muted-foreground">{latest.recommendation}</p>

          <ul className="mt-4 space-y-2 text-sm">
            {latest.rationale.map((reason) => (
              <li key={reason} className="flex gap-2 text-muted-foreground">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                {reason}
              </li>
            ))}
          </ul>

          <div className="mt-4 flex items-center justify-between rounded-2xl bg-primary-soft/70 px-3 py-2 text-xs font-semibold text-primary">
            <span>Confidence {latest.confidence}%</span>
            <span>{latest.window}</span>
          </div>

          <Button asChild variant="outline" className="mt-4 rounded-full">
            <Link to="/ai-decisions">See all decisions</Link>
          </Button>
        </article>
      </div>
    </div>
  );
}

function SummaryStat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-background/70 p-3">
      <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </dt>
      <dd className="mt-1 text-sm font-semibold text-foreground">{value}</dd>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-muted/50 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

function WeatherChip({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl bg-muted/50 px-2 py-2.5">
      <Icon className="mx-auto size-4 text-muted-foreground" />
      <p className="mt-1 text-sm font-semibold text-foreground">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}
