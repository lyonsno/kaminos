# Preview Bench Adapters

Kaminos Preview Bench adapters are composition surfaces for lanes that want
Kaminos to host, inspect, and witness a payload while the source lane owns its
domain logic.

Use a Preview Bench when a source lane has produced a live, fixture, or archived
evidence payload and needs an operator-facing Kaminos surface for smoke. Create
a project-specific route when the payload needs new host behavior.

## Route

The generic server-file route is:

```text
?world_chamber=lerms-underhill&posture=inspect&bench=terrain-preview&preview_bench_payload_root=lerms-preview&preview_bench_payload_path=your-payload.json
```

The generic URL route is:

```text
?world_chamber=lerms-underhill&posture=inspect&bench=terrain-preview&preview_bench_payload_url=http://127.0.0.1:8099/your-payload.json
```

Project-specific aliases such as `lerms_actor_motion_payload_root` may exist
for compatibility. New lanes can start with `preview_bench_payload_root`,
`preview_bench_payload_path`, or `preview_bench_payload_url`.

## Envelope

Kaminos reads a `kaminos.preview-bench.payload-report.v0` report that wraps a
source-owned payload:

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
      "display_authority_only"
    ],
    "debugSurfaces": [
      {
        "route": "browser/?debug=1",
        "role": "debug",
        "reason": "source-lane local debug view"
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

Source owns payload semantics, source schemas, domain truth, freshness claims,
and whether a payload is live, fixture, archived, stale, or fallback.

Kaminos owns host display, route/source/fallback badge rendering,
acceptance-surface validation, and browser witness capture.

The adapter preserves source schemas, domain semantics, debug route labels, and
downgrade visibility. Fixture, stale, proxy, and visual-only payloads keep their
downgrade state visible.

## Smoke

Use the reusable witness scenario:

```sh
node scene-object-witness.mjs \
  --url "http://127.0.0.1:8790/?world_chamber=lerms-underhill&posture=inspect&bench=terrain-preview&preview_bench_payload_root=lerms-preview&preview_bench_payload_path=your-payload.json" \
  --scenario preview-bench-payload-contract \
  --out /tmp/kaminos-preview-bench-payload.png \
  --report /tmp/kaminos-preview-bench-payload.json
```

The witness records the effective URL, server roots, payload schema, source
authority, downgrades, debug surface roles, and custody split. Acceptance
evidence includes the captured operator route and its report.
