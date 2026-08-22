# Physical-Form Atlas Wave-One Review

## Result

All 32 cells for seeds `81432` and `81433` completed through the requested
GPU Greenroom route and were inspected directly against the sole conditioning
source, [`../flux-81408/output.png`](../flux-81408/output.png). Four prompt
basins materially improve reconstruction legibility while preserving different
amounts of source identity:

1. **Painted silicone markings (`04`)** is the robustness leader. Both seeds
   produce a clean, connected head with compact attached ruff forms and no thin
   facial geometry. It simplifies the source, but does so consistently.
2. **Connected polystone facets (`09`)** is the strongest deliberately
   constructed carrier. Both seeds produce coherent, explicitly connected
   planar heads with almost no stray geometry. It is more stylized than `04`
   but offers Trellis an unusually legible volume decomposition.
3. **Rounded polystone masses (`11`)** is the strongest smooth-volume
   alternative. Seed `81432` shifts deerlike and adds a shoulder terminator;
   seed `81433` retains more source identity with a compact ruff terminator.
4. **Enamel polystone (`08`)** is a repeatable global smoothing lever. Although
   the wording targets the eyes, both seeds smooth and gloss the whole bust,
   suppress whiskers, and preserve broad connected surfaces.

Two exact alternates preserve more source nuance but are less repeatable:

- [`seed-81433/01-silicone-continuous-muzzle/output.png`](wave-1/seed-81433/01-silicone-continuous-muzzle/output.png)
  is the cleanest continuous carrier in wave one.
- [`seed-81432/02-silicone-shallow-facial-relief/output.png`](wave-1/seed-81432/02-silicone-shallow-facial-relief/output.png)
  has the best identity-rich shallow relief, but the second seed regrows thin
  whiskers.

These are image-basin promotions only. No output in this review has yet earned
a geometry, winding, collision, or production claim.

## What The Matrix Taught Us

- `01` is a robust low-frequency instruction, with meaningful seed variance in
  identity and polish.
- `02` has a higher identity ceiling than `01`, but thin whiskers are not
  reliably suppressed.
- `03` is highly seed-sensitive: one seed literalizes attached cheek wedges as
  bars, while the other produces excellent broad cheek forms.
- `04` is the most stable continuous-form prompt across the first two seeds.
- `05`, `06`, and `07` collapse into essentially the same whiskered polystone
  basin. Swapping `inset`, `painted`, and `glass` is a weak lever at this edit
  strength.
- `08` changes the whole material and surface organization rather than only the
  eyes. Its global effect is useful.
- `09` is highly repeatable and controls topology-facing shape language more
  strongly than the eye adjectives do.
- `10` retains its plate concept but varies sharply in density, from facial
  scale overgrowth to a disciplined featherlike collar.
- `11` reliably creates broad rounded masses, with moderate identity variance.
- `12` reliably creates coherent attached locks, but remains denser than the
  reconstruction target needs.
- `13` imports clothed puppet torso forms on both seeds.
- `14` and `16` import a foxlike game-character prior; whiskers vary by seed.
- `15` restores realistic fur, whiskers, and ornamental shoulders. It is a
  successful miniature image but a lower-priority Trellis conditioner.

The important control distinction is not simply realistic versus stylized.
Physical carrier nouns and low-frequency surface organization materially
change reconstruction legibility; local eye-material adjectives usually do
not, except when `enamel` expands into a global surface prior.

## Route And Timing Receipt

- Source: [`../flux-81408/output.png`](../flux-81408/output.png)
- Source SHA-256: `6451fcc15a6fc444e63943039229d958a202ae4ebc001addfc9b20bcb4d511d9`
- Requested route: `mflux_flux2_edit_promptfile`
- Effective executable in every inspected receipt:
  `/Users/noahlyons/dev/mlx-openai-server/.venv/bin/mflux-generate-flux2-edit`
- Effective working directory: `/Users/noahlyons/dev/mlx-openai-server`
- Model/config: `flux2-klein-9b`, Q4, `512x512`, 8 steps, guidance `1.0`,
  MLX cache limit `48GB`
- Seeds: `81432`, `81433`
- Completed cells: 32 of 32
- Duration: 33.7 seconds minimum, 64.1 seconds mean, 92.2 seconds maximum
- Fallback or ignored parameters: none
- Failure phase: none
- Output inventory per cell: `output.png`, `metadata.json`, and generator
  `output.metadata.json`
- Greenroom start receipt: [`start-receipt.json`](start-receipt.json)

The Greenroom receipts carry exact effective commands and job ids. The
`volatile_output` warning records that these files live in the feature
worktree until committed; it does not indicate a fallback route or partial
generation.

## Next Decision Boundary

Wave two is already registered with the same source, prompts, route, and config
for seeds `81434` and `81435`. Directly inspect those cells before choosing
exact Trellis inputs. If `04`, `08`, `09`, and `11` remain stable, nominate the
best identity-preserving seed from each as a four-basin reconstruction assay.
If a family splits again, preserve both the cleanest carrier and the
identity-rich useful miss rather than averaging them into one claim.
