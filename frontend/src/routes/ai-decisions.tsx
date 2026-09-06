import { createFileRoute } from "@tanstack/react-router";
import { BrainCircuit } from "lucide-react";

import { DecisionPipeline } from "@/components/krishi/decision-pipeline";

export const Route = createFileRoute("/ai-decisions")({
  head: () => ({
    meta: [
      { title: "AI Decision Trace — KRISHI-NEXUS" },
      {
        name: "description",
        content:
          "KRISHI-NEXUS AI decision pipeline: perception, field context, risk, proposal, safety, review, replan and final decision.",
      },
      { property: "og:title", content: "AI Decision Trace — KRISHI-NEXUS" },
      {
        property: "og:description",
        content:
          "Step-by-step agricultural AI decision trace from perception to final field recommendation.",
      },
    ],
  }),
  component: AiDecisionsPage,
});

function AiDecisionsPage() {
  return (
    <div className="space-y-5">
      <header className="panel field-grid p-5 sm:p-7">
        <h1 className="flex items-center gap-2 text-2xl font-bold sm:text-3xl">
          <BrainCircuit className="size-6 text-primary" />
          AI Decision Trace
        </h1>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">
          How KRISHI-NEXUS moves from a field signal to a safe, field-ready decision.
        </p>
      </header>

      <DecisionPipeline />
    </div>
  );
}
