import { createFileRoute } from "@tanstack/react-router";
import { Droplets, MapPin, Ruler, Sprout } from "lucide-react";

import { StatusPill } from "@/components/krishi/status-pill";
import { Progress } from "@/components/ui/progress";
import { cropCycle, farmer, fieldPlots, soilReadings } from "@/data/mock-farm";

export const Route = createFileRoute("/farm")({
  head: () => ({
    meta: [
      { title: "My Farm — KRISHI-NEXUS" },
      {
        name: "description",
        content:
          "Plot-level view of your land: area, crop, irrigation source and per-plot field status inside KRISHI-NEXUS.",
      },
      { property: "og:title", content: "My Farm — KRISHI-NEXUS" },
      {
        property: "og:description",
        content: "Plot-level view of land, crops and per-plot field status.",
      },
    ],
  }),
  component: FarmPage,
});

function FarmPage() {
  return (
    <div className="space-y-5">
      <header className="panel field-grid p-5 sm:p-7">
        <h1 className="text-2xl font-bold sm:text-3xl">My Farm</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {farmer.village}, {farmer.district}, {farmer.state}
        </p>
        <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { icon: Ruler, label: "Total area", value: farmer.landHolding },
            { icon: MapPin, label: "Plots", value: `${fieldPlots.length} plots` },
            { icon: Droplets, label: "Irrigation", value: farmer.irrigation },
            { icon: Sprout, label: "Main crop", value: cropCycle.crop },
          ].map((item) => (
            <div key={item.label} className="rounded-2xl border border-border bg-background/70 p-3">
              <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <item.icon className="size-3.5" />
                {item.label}
              </dt>
              <dd className="mt-1 text-sm font-semibold">{item.value}</dd>
            </div>
          ))}
        </dl>
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        {fieldPlots.map((plot) => (
          <article key={plot.name} className="panel p-5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-bold">{plot.name}</h2>
                <p className="text-sm text-muted-foreground">{plot.area}</p>
              </div>
              <StatusPill status={plot.status} />
            </div>
            <p className="mt-3 text-sm font-medium text-foreground">{plot.crop}</p>
            <p className="mt-1 text-sm text-muted-foreground">{plot.note}</p>
          </article>
        ))}
      </section>

      <section className="panel p-5">
        <h2 className="text-lg font-bold">Latest soil readings</h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {soilReadings.map((reading) => (
            <li key={reading.label} className="rounded-2xl border border-border bg-muted/40 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">{reading.label}</p>
                <StatusPill status={reading.status} label={reading.value} />
              </div>
              <Progress value={reading.progress} className="mt-2 h-1.5" />
              <p className="mt-2 text-xs text-muted-foreground">{reading.detail}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
