import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { InMemoryDecisionMemory } from "../memory/decision-memory.ts";
import { mockPerception } from "../agents/mocks.ts";
import { createDefaultOrchestrator, type DecisionInput, type DecisionOrchestrator } from "../orchestrator/decision-orchestrator.ts";

const memory = new InMemoryDecisionMemory();
const orchestrator = createDefaultOrchestrator(memory);
// The canned /api/v1/demo/tomato scenario has no attached image, so a real, network-calling
// Perception model can legitimately (and non-deterministically) report confidence below the
// orchestrator's 0.7 gate, since it cannot visually confirm a symptom from text alone — which
// stops the workflow at REQUEST_MORE_DATA before Field Context (and therefore the seeded farm/
// environment/history data) is ever retrieved. The demo endpoint exists to reliably showcase the
// full pipeline, so it uses the existing deterministic, keyword-matching mockPerception (unchanged,
// from mocks.ts — not a network call) instead. Every other dependency, including the seeded Field
// Context tool boundary, the Risk/Economics agent, and the real Decision Synthesizer/Adversarial
// Reviewer models, is unchanged from createDefaultOrchestrator's usual defaults. The general
// /api/v1/decisions endpoint is unaffected and still uses the real default Perception model.
const demoOrchestrator = createDefaultOrchestrator(memory, mockPerception);
const demo: DecisionInput = { farmId: "FARM-001", plotId: "PLOT-A", language: "kn", mode: "DECIDE", farmerText: "Tomato leaves have dark spots and the affected area is increasing." };
// CORS: allow a browser-based frontend hosted on a different origin (e.g. a Lovable app)
// to call the existing routes below. This only adds response headers / preflight handling;
// it does not change any JSON response body or request body shape.
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400"
} as const;
const send = (res: ServerResponse, status: number, payload: unknown) => { res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...CORS_HEADERS }); res.end(JSON.stringify(payload, null, 2)); };
const body = async (req: IncomingMessage): Promise<unknown> => { let raw = ""; for await (const chunk of req) raw += chunk; return raw ? JSON.parse(raw) : {}; };

// Exported so tests can exercise the exact same request-handling/CORS logic against an
// injected, deterministic orchestrator (no real model/network calls), without altering
// production wiring: `server` below still runs against the real default orchestrator.
// `demoTargetOrchestrator` defaults to `targetOrchestrator` so existing single-argument callers
// (tests) are unaffected; production wires it separately below to the demo-specific orchestrator.
export function createRequestHandler(targetOrchestrator: DecisionOrchestrator, demoInput: DecisionInput = demo, demoTargetOrchestrator: DecisionOrchestrator = targetOrchestrator) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      if (req.method === "OPTIONS") { res.writeHead(204, CORS_HEADERS); return res.end(); }
      if (req.method === "GET" && req.url === "/health") return send(res, 200, { status: "ok" });
      if (req.method === "POST" && req.url === "/api/v1/demo/tomato") return send(res, 200, await demoTargetOrchestrator.run(demoInput));
      if (req.method === "POST" && req.url === "/api/v1/decisions") {
        const input = await body(req) as Partial<DecisionInput>;
        if (!input.farmerText || typeof input.farmerText !== "string") return send(res, 400, { error: "farmerText is required" });
        return send(res, 200, await targetOrchestrator.run(input as DecisionInput));
      }
      return send(res, 404, { error: "not found" });
    } catch (error) { return send(res, 500, { error: error instanceof Error ? error.message : "unknown error" }); }
  };
}

export const server = createServer(createRequestHandler(orchestrator, demo, demoOrchestrator));
