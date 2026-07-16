# Hybrid Raymarch Smoke Boundary Witness

Question: Can the current smoke-only raymarch compose around learned flame
splats without fallback, stale state, a broken control restore, or an obvious
lower-plume phase boundary defect?

Result: The exact production route is live and moving. The successful v3 run
captured six controlled frames across static and grazing cameras. Every frame
used the requested learned splat model, the smoke-only raymarch, and the
front/splat/back compositor with no fallback. Bracketed splat-only controls
returned within the measured decoded-pixel restoration envelope.

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

- `tall-plume-v3/report.json`: successful requested/effective route, capture,
  restoration, motion, lower-front, and false-closure authority.
- `tall-plume-v3/static-control-hybrid-restored-sheet.png`: inspected full-frame
  grid; columns are control, hybrid, restored and rows are consecutive states.
- `tall-plume-v3/static-lower-front-crop-sheet.png`: inspected enlarged grid in
  the same column/row order.
- `tall-plume-v3/staticCamera/` and `tall-plume-v3/grazingCamera/`: original
  screenshots for every bracketed frame.
- `tall-plume-v1/report.json`: fail-loud PNG-container-hash calibration run.
- `tall-plume-v2/report.json`: fail-loud decoded-pixel-envelope calibration run.

The final restoration contract records PNG hash equality separately from full
decoded RGB comparison. It permits at most a two-level channel delta, a changed
pixel fraction of `0.00002`, and mean absolute channel delta of `0.00001`. The
successful first v3 frame changed `11 / 3,142,800` pixels, max delta `1`, mean
absolute channel delta `0.0000011667`. These bounds came from two complete
fail-loud runs rather than an unmeasured tolerance.

## Claim Boundary

This proves exact smoke-only raymarch composition around learned splats on one
tall-plume source across controlled state and camera motion. It does not prove a
medium or broad source, strong smoke/flame visual continuity, reduced-resolution
smoke, reduced ray count, pass-local GPU cost, final appearance, or production
acceptance.
