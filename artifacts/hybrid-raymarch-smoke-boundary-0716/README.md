# Hybrid Raymarch Smoke Boundary Witness

Question: Can the current smoke-only raymarch compose around learned flame
splats without fallback, stale state, a broken control restore, or an obvious
lower-plume phase boundary defect?

Result: The revision-one v9 run proves that the exact production route is live
and that the smoke-only residual moves independently of learned-flame motion.
It captured six controlled states across static and grazing cameras. Every
state used the requested learned splat model, smoke-only raymarch, and
front/splat/back compositor with no fallback. Four same-state captures per
state measure the splat-only raster floor, hybrid contribution, post-hybrid
pixels, and the post-render live control state.

The earlier v3 run remains useful manually inspected route evidence, but fresh
GPT-5.5 review found that its automated motion predicate could pass on moving
flame alone and its final capture override could hide failed live-state
restoration. V9 closes those evidence defects without widening the original
decoded-pixel tolerance.

Visual disposition is narrower. The inspected static and grazing frames show a
faint smoke column attached to the flame without an obvious dark seam, duplicate
flame, detached collar, or impossible layer order. The current flame is heavily
white-compressed and the smoke contribution is weak, so this is not a final
phase-boundary quality pass. The next assay should use a medium source with
stronger smoke authority and a more legible splat appearance before reducing
smoke resolution or ray count.

## Route

- requested application route: `native-3d-compute-fluid-raymarch-v0`
- witness route: `hybrid-raymarch-smoke-boundary-v0`
- flame renderer: `live-boundary-sidecar-learned-attribute-splats-v0`
- learned model: `sha256:22284e5b930ef893e3c874ed1bd9efd077a16f29f14002155afe072f262ac472`
- smoke renderer: `native-3d-compute-fluid-raymarch-smoke-only-v0`
- compositor: `splat-depth-conditioned-front-back-smoke-compositor-v1`
- optical order: `front-smoke>splat>back-smoke`
- excluded raymarch authority: `raymarched-flame-interface-emission`
- source: `tall_plume` / `operator_fire_0622`, input radius `0.12`, flow rate `0.35`
- grid / render: `128^3`, majorant `24^3`, render scale `0.65`, `48` ray steps

## Evidence

- `tall-plume-v9/report.json`: revision-one requested/effective route, live
  control restoration, smoke-only residual motion, connected lower-front
  support, and unchanged decoded-pixel restoration authority.
- `tall-plume-v9/staticCamera/` and `tall-plume-v9/grazingCamera/`: original
  control, immediate control repeat, hybrid, and restored screenshots for all
  six controlled states.
- `tall-plume-v8/report.json`: complete fail-loud run that proved smoke residual
  motion and exposed one decoded-pixel restoration excursion; it was rejected.
- `tall-plume-v4/report.json`: fail-loud receipt proving the original frozen
  render restored controls internally but left public live debug state stale.
- `tall-plume-v5/report.json` and `tall-plume-v6/report.json`: fail-loud startup
  and capture receipts; neither produced accepted primary evidence.
- `tall-plume-v7/report.json`: fail-loud browser exception receipt that exposed
  a revision-local lexical placement error before primary output.
- `tall-plume-v3/report.json`: superseded automated acceptance candidate;
  retained only as the original manually inspected route witness.
- `tall-plume-v3/static-control-hybrid-restored-sheet.png`: inspected full-frame
  grid; columns are control, hybrid, restored and rows are consecutive states.
- `tall-plume-v3/static-lower-front-crop-sheet.png`: inspected enlarged grid in
  the same column/row order.
- `tall-plume-v3/staticCamera/` and `tall-plume-v3/grazingCamera/`: original
  screenshots for every bracketed frame.
- `tall-plume-v1/report.json`: fail-loud PNG-container-hash calibration run.
- `tall-plume-v2/report.json`: fail-loud decoded-pixel-envelope calibration run.

The restoration contract records PNG hash equality separately from full decoded
RGB comparison. It permits at most a two-level channel delta, a changed pixel
fraction of `0.00002`, and mean absolute channel delta of `0.00001`. V9 did not
widen those bounds. Its first static state changed `4 / 3,142,800` pixels both
for the immediate splat-only repeat and the post-hybrid control, with max delta
`1` and mean absolute channel delta `0.0000004243`.

V9 static-camera smoke-only residual motion reached mean absolute differences
`0.0339` and `0.0353`, with `0.35-0.37%` changed samples. Grazing-camera residual
motion reached `0.2052` and `0.2862`, with `1.83-2.80%` changed samples. The
lower-front regions derive from the largest eight-neighbor component in the
learned-splat luma mask. Across v9 they contain approximately `47-51%` learned
support density and `51-59%` changed smoke-residual pixels.

## Claim Boundary

This proves exact smoke-only raymarch composition around learned splats on one
tall-plume source across controlled state and camera motion, including smoke
motion independent of flame motion and live control restoration after every
override. It does not prove a medium or broad source, strong smoke/flame visual
continuity, reduced-resolution smoke, reduced ray count, pass-local GPU cost,
final appearance, or production acceptance.
