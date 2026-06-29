# Asset Kiln Fire Language

The asset kiln should make route activity visible without lying about route
truth. Fire and smoke are the status body of the work: what is heating, what is
spending, what is cooling, what is cached, what failed, and what can be trusted.

Beaming's volumetric fire substrate gives Kaminos a real visual medium for this
language. Wake and Bake's specimen bench gives it the custody law: the fire
state must be driven by route receipts, source truth, activity state, and
promotion state.

The core rule:

```text
heat must mean evidence
```

If the flame looks strong, the substrate behind it must carry a strong enough
route state. If the route is fixture, fallback, partial, failed, request-only,
or cached, the flame language must say that visibly.

## Why Fire Belongs Here

The operator's loop is not only choosing inputs and reading outputs. It is
waiting, revising, noticing failure, and deciding whether to salvage. A sterile
spinner wastes that time. A generic progress bar overclaims precision. A kiln
can show useful process texture:

- the source is staged;
- the route is waiting for a backend;
- live compute is spending;
- the route is nearing output custody;
- output slots exist but are partial;
- a failure report landed;
- cached evidence is being recalled;
- a promoted asset has cooled.

The fire should help the operator keep working, not ask the operator to admire
the animation.

## Activity States

Kaminos route activity should map to visible combustion states.

| Route/evidence state | Visual language | Meaning |
| --- | --- | --- |
| No specimen/source | cold plate | Nothing has custody yet. |
| Source imported | staged clay, unlit fuel | Source exists; no route has spent. |
| Request-only | marked fuel, no flame | A request exists; no backend executed. |
| Queued/preparing | preheat, low smoke | Inputs/backend are preparing. |
| Live compute | full burn | A real backend is spending now. |
| Partial output | uneven ember, smoky burn | Useful output exists with weak custody. |
| Output settling | banked flame/coals | Route finished; artifacts are being linked. |
| Cached output | residual glow | Existing evidence is being recalled. |
| Fixture | controlled pilot flame | Contract/UI evidence only; not live compute. |
| Fallback | wrong-color/weak heat | Effective route differs from requested route. |
| Timeout | smoke plume without formed metal | A timeout report exists; no usable output. |
| Failed | snuff/collapse | Failure report is the evidence. |
| Promoted | cooled ingot/settled heat | Output crossed an explicit promotion gate. |

This table is a contract target, not a demand that every visual mode ship in
one slice. The important thing is that no state inherits a stronger visual class
than its receipt deserves.

## Route Activity Payload

The fire adapter should not infer truth from UI text. It should consume a route
activity payload derived from the same receipts and packet state as the rest of
Kaminos.

Minimum fields:

```json
{
  "schema": "kaminos.kiln.route-activity.v0",
  "activityState": "burning",
  "routePhase": "running",
  "truthMode": "live",
  "visualAuthority": "live-compute",
  "requestedRoute": "adapter.sharp-image-to-splat-live.v0",
  "effectiveRoute": "adapter.sharp-image-to-splat-live.v0",
  "backendClass": "browser-webgpu",
  "receiptId": "run-or-report-id",
  "sourceArtifactIds": ["source-image-001"],
  "conditioningArtifactIds": ["depth-001", "normal-001"],
  "outputSlots": [
    { "role": "splat", "status": "pending" }
  ],
  "sourceTruthWarnings": [],
  "startedAt": "2026-06-29T00:00:00Z",
  "elapsedMs": 0
}
```

The current `kaminos.kiln.activity-state.v0` can feed this shape. As the visual
adapter matures, the payload should keep route truth and visual tuning separate:
route state says what happened; fire genes say how it is rendered.

## Visual Authority

The fire adapter needs a visible authority class. This prevents gorgeous fire
from implying a strong backend claim.

Useful classes:

- `none`: no visible process should claim work;
- `fixture`: deterministic UI/contract witness only;
- `request-only`: request prepared but no generator/backend execution;
- `fallback`: effective route differs from requested route;
- `live-compute`: real backend execution in flight;
- `partial-output`: route produced useful weak-custody output;
- `failure-report`: route failed and report is the output;
- `cached`: previously computed evidence recalled;
- `promoted`: output accepted into a stronger asset role.

The UI can still be beautiful in weak states. It just cannot look authoritative
in the same way live compute does.

## Fire Genes

Beaming's fire substrate already exposes useful axes: fire intensity, smoke,
curl, radiance, absorption, glow, microdetail, interface shredding, fire licks,
wind, plume height, ray budget, pressure strategy, and staged pressure tiers.

The asset kiln needs route-facing genes on top:

- `heatClass`: cold, preheat, burn, bank, glow, snuff, cooled;
- `fuelClass`: fixture, imported, local-webgpu, hosted-api, adapter, cached;
- `truthClass`: fixture, fallback, live, partial, failed, promoted;
- `spendIntensity`: how hard the backend is spending;
- `custodyStrength`: how strong the output evidence is;
- `failureSharpness`: how abrupt the snuff/collapse should be;
- `cacheWarmth`: how much residual glow cached work earns;
- `outputSlotCount`: how many visible products are expected;
- `warningLoad`: how much source-truth warning should tint or disturb the
  flame.

These genes should be derived from route activity first, then exposed for
operator tuning only where tuning does not change truth.

## Source Tile Ignition

The strongest product image is not "the whole app is on fire." It is a source
tile entering the kiln.

For the route tray and specimen bench:

1. The source tile receives a low preheat rim when selected for a route.
2. The route row opens a small kiln mouth with requested/effective route
   identity.
3. Live compute ignites the tile or route mouth.
4. Output slots appear as separate heated silhouettes.
5. Partial outputs cool unevenly and keep warning badges.
6. Failed routes snuff into a durable report row.
7. Promoted outputs cool into stable asset rows.

The operator should be able to glance at the tray and understand which tile is
burning, why it is burning, and what truth class the burn carries.

## Partial, Timeout, And Failure

Partial output is not failure. It is weak material.

MoGE depth/normal/pointmap outputs may arrive as partial anonymous ImageData
truth layers. They should glow as useful conditioning matter, but the UI must
carry `anonymous_imagedata_receipt_partial` until artifact custody is stronger.

Timeout is not generic failure. A timeout means the route spent but crossed a
witness boundary before producing usable output. The visual should feel like
smoke without formed metal: process happened, output did not settle.

Failure should snuff cleanly into a report. It should not leave an ambiguous
pretty ember that looks like an artifact.

## Fixture And Fallback Heat

Fixtures and fallbacks are valuable. They are also weak.

A fixture route may prove UI, packet shape, witness wiring, or a false-closure
guard. It should get a pilot flame or controlled bench heat, not full burn.

A fallback route should visibly differ from the requested route. If an operator
asked for a hosted generator and received a fixture because the API was
unconfigured, the kiln should not look like hosted generation happened.

This is the visual version of:

```text
requested route is not source truth
```

## Cache Glow

Cached work should not look cold or live.

When a route recalls cached output, the kiln can show residual warmth: the
material is real enough to reuse, but no new backend spend is happening. This
matters because the operator should not confuse a quick cached result with a
fresh route success.

## Budget And Cadence

The kiln should have an operator-facing budget posture:

- quiet: no background route burning;
- warm: small local truth-layer passes allowed;
- hot: route tray may run active local/hosted work;
- forge: expensive batch routes and visual fire are allowed to spend.

This budget should control both compute and spectacle. If the box is under
heavy contention, Kaminos should not secretly turn every tile into a live
volumetric show.

## Witness Requirements

A fire witness must prove more than nonblank flame.

It should record:

- route activity payload;
- requested/effective route;
- backend class;
- visual authority class;
- fire genes/effective parameters;
- source-truth warnings;
- visible state label;
- screenshot or frame;
- whether the route is fixture, fallback, partial, failed, cached, live, or
  promoted.

The witness should fail if:

- a fixture route displays full live-compute burn;
- a fallback hides its fallback reason;
- partial output lacks a partial warning;
- a failed route leaves a candidate artifact;
- a cached route looks like fresh compute;
- the visual state and route receipt disagree.

## Implementation Path

Near-term slices:

1. Add `kaminos.kiln.route-activity.v0` as the bridge between route receipts
   and fire state.
2. Attach route activity to Composition Tray rows and Specimen Packet route
   evidence.
3. Build a compact tile-level fire adapter using Beaming's volume substrate.
4. Add weak/strong visual-authority classes before adding more dramatic fire.
5. Add snuff, bank/coals, cache glow, and partial-output ember states.
6. Add a witness that verifies route truth and visual state agree.

The final product target is an asset kiln where inference latency has texture,
but every flame still tells the truth.
