# Preview Bench Adapters

Kaminos Preview Bench adapters are the handoff path for another lane that wants Kaminos to host, inspect, and witness a payload without Kaminos owning that lane's domain logic.

Use this when a source lane has produced a live, fixture, or archived evidence payload and needs an operator-facing Kaminos surface for smoke. Do not create a bespoke Kaminos route unless the payload needs new host behavior.

## Route

The generic server-file route is:

```text
?world_chamber=lerms-underhill&posture=inspect&bench=terrain-preview&preview_bench_payload_root=lerms-preview&preview_bench_payload_path=your-payload.json
```

The generic URL route is:

```text
?world_chamber=lerms-underhill&posture=inspect&bench=terrain-preview&preview_bench_payload_url=http://127.0.0.1:8099/your-payload.json
```

Project-specific aliases such as `lerms_actor_motion_payload_root` may exist for compatibility, but new lanes should start with `preview_bench_payload_root`, `preview_bench_payload_path`, or `preview_bench_payload_url`.

## Envelope

Kaminos reads a `kaminos.preview-bench.payload-report.v0` report that wraps a source-owned payload:

```json
{
  "ok": true,
  "schema": "kaminos.preview-bench.payload-report.v0",
  "route": "kaminos/preview-bench/payload-file",
  "reportPath": "/tmp/example-preview-payload.json",
  "payload": {
    "schema": "source-lane.preview-bench-payload.v0",
    "route": "source-lane/preview-bench/payload-file",
    "label": "Source Lane Payload",
    "acceptanceSurface": {
      "kind": "kaminos_preview_bench_payload",
      "worldChamberId": "lerms-underhill",
      "posture": "inspect",
      "bench": "terrain-preview",
      "routeQuery": "world_chamber=lerms-underhill&posture=inspect&bench=terrain-preview",
      "expectedHost": "kaminos_workbench_kiln_preview_bench"
    },
    "source": {
      "authority": "live_packet",
      "diaulos": "source-lane",
      "route": "source-lane/live-route"
    },
    "fields": [
      { "label": "Count", "value": 3 }
    ],
    "summary": {
      "count": 3
    },
    "downgrades": [
      "host_visualization_not_source_truth"
    ],
    "rejectedSurfaces": [
      {
        "route": "browser/?debug=1",
        "acceptanceSurface": false,
        "reason": "debug route is not Kaminos Preview Bench acceptance"
      }
    ],
    "custody": {
      "sourceOwns": ["payload semantics", "freshness", "domain truth"],
      "kaminosOwns": ["host display", "route/source/fallback badges", "witness capture"]
    }
  }
}
```

## Custody

Source owns payload semantics, source schemas, domain truth, freshness claims, and whether a payload is live, fixture, archived, stale, or fallback.

Kaminos owns host display, route/source/fallback badge rendering, acceptance-surface validation, and browser witness capture.

Kaminos does not rename source schemas, reinterpret domain semantics, or turn a debug route into an acceptance surface. If the payload is fixture, stale, proxy, or visual-only, that downgrade must stay visible.

## Smoke

Use the reusable witness scenario:

```sh
node scene-object-witness.mjs \
  --url "http://127.0.0.1:8790/?world_chamber=lerms-underhill&posture=inspect&bench=terrain-preview&preview_bench_payload_root=lerms-preview&preview_bench_payload_path=your-payload.json" \
  --scenario preview-bench-payload-contract \
  --out /tmp/kaminos-preview-bench-payload.png \
  --report /tmp/kaminos-preview-bench-payload.json
```

The witness must record the effective URL, server roots, payload schema, source authority, downgrades, rejected surfaces, and custody split. Sidebar text alone is not acceptance evidence.
