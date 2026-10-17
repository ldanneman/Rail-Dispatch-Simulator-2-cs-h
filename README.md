# Rail Dispatch Simulator

Interactive freight-rail dispatch and optimisation simulator (React + Vite, JavaScript, Yarn). A deterministic scheduling engine assigns routes and departure times to shipments on an 8-terminal / 15-connection network; every number in the UI is computed from that engine's output. No backend, no API keys; state is kept in `localStorage`.

## Run
```bash
yarn install
yarn dev          # development server (http://localhost:5173)
yarn test         # Vitest: 146 tests
yarn build        # production build -> dist/   (yarn preview to serve it)
```

## What is in the app
| Page | Purpose |
|---|---|
| Dashboard | KPIs, network map coloured by utilization, alerts and bottlenecks, outcome by priority, terminal throughput, connection utilization |
| Shipments | search / sort / filter table; per-shipment route, per-connection schedule, waiting and failure reason |
| Timeline | movements by connection or by shipment on an hourly axis, with disruption windows |
| Disruptions | closures, travel-time increases, capacity cuts, release delays; recalculation and an impact report against the baseline |
| Compare | any two scenarios: headline metrics, shipment-level differences, connection utilization |
| Test Lab | scenarios (presets, seed generator, fork, reset), network editor, shipment editor, run/pause/rewind/recalculate/reset with playback, detailed schedule, capacity by hourly slot, JSON import/export with validation |
| Assumptions | the exact rules and formulas |

The 100-shipment baseline is generated from seed 11 and is **immutable** (frozen in memory, never stored). Everything else is a scenario you can fork, edit, import, export and compare.

## Optimisation strategy (short version)
Time is integer hours; slots are one hour; intervals are half-open; the planning horizon is 168 h. Capacity = maximum movements *entering* a connection per hourly departure slot (both directions of a connection share it). Shipments are scheduled in order of priority, then least slack, then deadline, release and id. Each gets its exact earliest-arrival route (time-dependent Dijkstra over the remaining capacity, waiting allowed) and reserves its slots; a bounded refinement promotes late/unrouted shipments within their priority class and keeps a pass only if strictly better. Shipments with no feasible route within the horizon are *undeliverable* with a recorded reason; a missed deadline is merely *late*. It is a deterministic heuristic, not a proven optimum. An independent verifier re-checks every schedule.

## Documentation
Full documentation (architecture, algorithms, data model, JSON schema, metrics, pages, components, functions, testing and limitations) is in the Obsidian vault folder `code_projects/Rail_Dispatch_Simulator_claude_sonnet_5.5/` (start at `00 Index.md`). The JSON import format has a machine-readable schema in `schema/rail-scenario.schema.json`.

## Layout
`src/engine` (pure scheduling/analysis) → `src/data` (generator, presets, validation, serialization) → `src/state` (reducer, persistence) → `src/components`, `src/pages` (UI). Tests are in `tests/`.
