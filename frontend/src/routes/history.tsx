import { createFileRoute } from "@tanstack/react-router";
import { History } from "lucide-react";

import { StatusPill } from "@/components/krishi/status-pill";
import { aiDecisions } from "@/data/mock-farm";

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { title: "Decision History — KRISHI-NEXUS" },
      {
        name: "description",
        content:
          "A dated timeline of every KRISHI-NEXUS field decision for the season, with the action taken and its confidence.",
      },
      { property: "og:title", content: "Decision History — KRISHI-NEXUS" },
      {
        property: "og:description",
        content: "Dated timeline of field decisions for the season.",
      },
    ],
  }),
  component: HistoryPage,
});

function HistoryPage() {
  return (
    <div className="space-y-5">
      <header className="panel field-grid p-5 sm:p-7">
        <h1 className="flex items-center gap-2 text-2xl font-bold sm:text-3xl">
          <History className="size-6 text-primary" />
          Decision History
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Kharif 2026 · {aiDecisions.length} decisions recorded
        </p>
      </header>

      <ol className="panel divide-y divide-border p-0">
        {aiDecisions.map((decision) => (
          <li key={decision.id} className="flex flex-wrap items-start gap-3 p-5">
            <div className="w-28 shrink-0">
              <p className="text-sm font-semibold text-foreground">{decision.issuedAt}</p>
              <p className="text-xs text-muted-foreground">{decision.id}</p>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold">{decision.title}</h2>
                <StatusPill status={decision.status} />
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{decision.recommendation}</p>
            </div>
            <p className="shrink-0 text-xs font-semibold text-primary">
              {decision.category} · {decision.confidence}%
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}
