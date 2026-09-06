# KRISHI-NEXUS backend foundation

Phase 12 adds real retrieval/assessment components while leaving the deterministic FSM, safety engine, reviewer, memory, and the Synthesizer mock in place.

## Phase 12.2: Field Context Agent

`ToolFieldContextAgent` is a deterministic, mockable retrieval layer between the FSM and three tool boundaries:

- `farm.get_state(farmId, plotId)`
- `weather.get_forecast(location, startTime, hours)`
- `farm.get_history(farmId, plotId, fromDate, toDate)`

It copies only retrieved facts into `CaseState.farm`, `environment`, and `history`. `CaseState.context` separately records retrieved field names, derived context (currently empty), tool statuses, and conflicts. Missing, failed, timed-out, or conflicting context never receives fabricated fallback values; the workflow safely falls back before risk, synthesis, or safety evaluation.

## Phase 12.3: Risk & Economics Agent

`ToolRiskEconomicsAgent` deterministically converts Perception and Field Context facts into disease, weather, crop-stress, and overall risk factors. It retrieves money inputs through `economics.get_data(farmId, plotId, crop, cropStage)` and returns a typed crop value, expected loss, intervention cost, justification, and decision gate: `INTERVENE`, `MONITOR`, `WAIT`, or `SEEK_CONFIRMATION`.

No model selects prices, loss amounts, product names, chemicals, or dosages. Every monetary input must be supplied by the economic tool boundary. Missing, failed, timed-out, negative/non-finite, or conflicting values are recorded as structured flags and result in `SEEK_CONFIRMATION`; no value is manufactured. The built-in data is explicitly `SEEDED_DEMO`, is used only by deterministic tests/demo flow, and is not live market information. When cost is not justified, the mock synthesizer retains its role but emits `MONITOR`; concrete interventions remain downstream of the vetted knowledge base and safety engine.

## Perception model configuration

The Perception Agent reads `OPENAI_API_KEY` from the environment and uses `OPENAI_MODEL` when supplied (default: `gpt-4o`). It sends farmer text, an optional voice transcript, and image URLs/data URLs to the Responses API, requesting structured observations only. It records confidence and uncertainty, and has no treatment, chemical, dosage, or action fields.

```powershell
$env:OPENAI_API_KEY = "..."
$env:OPENAI_MODEL = "gpt-4o" # optional
npm run dev
```

The test suite injects a fake model boundary; it never uses an API key or calls a live model.

## Run

Requires Node.js 24+ (for built-in TypeScript stripping).

```powershell
npm run dev
```

The server listens on `http://localhost:3000`.

```powershell
Invoke-RestMethod http://localhost:3000/api/v1/demo/tomato -Method Post
```

Or submit an intake payload:

```powershell
Invoke-RestMethod http://localhost:3000/api/v1/decisions -Method Post -ContentType 'application/json' -Body '{"farmId":"FARM-001","plotId":"PLOT-A","language":"kn","farmerText":"Tomato leaves have dark spots and the affected area is increasing."}'
```

## Test

```powershell
npm test
```

The seeded demo deliberately proposes a foliar biological intervention during a rain window. `WX-001` blocks it, the mock planner replans to `WAIT_FOR_SAFE_WEATHER_WINDOW`, and the reviewer approves the safe plan. This provides an auditable end-to-end demonstration of the veto/replan architecture.

## Layout

- `src/types`: CaseState and decision contracts
- `src/agents`: replaceable mocked reasoning components
- `src/tools`: in-process MCP-compatible tool interfaces plus seeded data
- `src/rules`: deterministic safety gate
- `src/orchestrator`: finite-state decision pipeline
- `src/memory`: in-memory decision repository (replaceable by a database adapter)
- `src/api`: HTTP request handling

All price, weather, and treatment data are demo/seeded values only, not agronomic advice.
