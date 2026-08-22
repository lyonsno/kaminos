# Physical-model micro-wording: four-seed review

Status: 64/64 images directly inspected across seeds `81427`-`81430` and
prompts `01`-`16`. Every generated cell is preserved. No contact sheet was
used as visual evidence.

## Fixed route

- Source: `../flux-81408/output.png`
- Source SHA-256: `6451fcc15a6fc444e63943039229d958a202ae4ebc001addfc9b20bcb4d511d9`
- Requested and effective route: `mflux_flux2_edit_promptfile`
- Model: `flux2-klein-9b`, Q4
- Config: 512 x 512, 8 steps, guidance 1.0, MLX cache limit 48 GB
- Comparison: exact source and route settings held fixed while wording and seed varied

## Exact-source ranking

1. `wave-1/seed-81427/05-silicone-inset-eyes/output.png`
   SHA-256: `597d937f3983bda4bbbc23cd59ab8005617211ce38881929e0d885975131bf9d`

   Best identity-to-simplicity compromise. It is a clean, whisker-free,
   low-frequency physical bust with inset eyes and joined facial masses. The
   four-seed review narrows the earlier claim: silicone wording reliably lowers
   surface frequency, but whisker suppression was favorable behavior of this
   exact seed, not a stable family property.

2. `wave-1/seed-81427/15-low-poly-connected-facets/output.png`
   SHA-256: `4848ebfe354b2287357446db9ecc22d31777a4ebcf209db7f3e619fd67615896`

   Best explicit geometry carrier. Connected facets make ownership and the
   complete neck terminator legible while preserving more identity than the
   smooth vinyl and ceramic basins.

3. `wave-2/seed-81429/14-ceramic-smooth-forms/output.png`
   SHA-256: `f21901f2dc169c85914f8967c71715ea883db959c1ee57621cc9ba355044fcf7`

   Cleanest topology-only envelope in the atlas: closed, whisker-free, and
   composed from continuous ears, horns, muzzle, nose, eyes, and neck. It spends
   substantial source identity and is therefore an assay carrier, not a promoted
   identity cast.

4. `wave-2/seed-81429/15-low-poly-connected-facets/output.png`
   SHA-256: `f2e54b2a70e1ac7515d2d22001bc6004fc118400dc1fef6b73ef0ff092831f2a`

   Strong alternate structural carrier. It is exceptionally clean and
   whisker-free, but more generic than the nominated `81427/15` source.

## Stable prompt behavior

- `15-low-poly-connected-facets` is the most reliable structural basin. All
  four seeds produced coherent connected busts; identity and whisker generation
  still vary.
- `13-vinyl-painted-eyes` and `14-ceramic-smooth-forms` can produce the cleanest
  continuous envelopes, but they often collapse identity into a generic mascot.
- `05-silicone-inset-eyes` reliably lowers surface frequency while preserving
  more identity than vinyl or ceramic. It does not reliably remove whiskers.
- `01`, `02`, `04`, `10`, and `16` retain more natural identity while tending
  to restore engraved fur, layered coat detail, or thin whiskers.
- `07`, `08`, and often `09` form coherent animation basins but frequently land
  as polished 2D art rather than an explicit physical model.
- Eye representation, coat organization, and thin facial structures move
  independently enough that a single broad style label cannot control all three.

## Useful misses

- `81428/10-console-adventure-solid-pieces` remains a valuable scale-plated
  dragon-creature basin even though it misses this identity.
- `81428/03-resin-layered-pieces` and `81430/03-resin-layered-pieces` show that
  `layered pieces` can redirect the face toward helmet, mask, or toy semantics.
- `81429/09` and `81429/10` are strong frontal animation designs with useful
  shape vocabulary, but they are illustration sources rather than physical-model
  evidence.
- The smooth vinyl and ceramic results are useful topology assays precisely
  because they expose how much identity can be lost while the envelope improves.

## Next decision

The two already-registered matched TRELLIS probes compare the exact `81427/05`
and `81427/15` sources at the established 8-step, no-cascade control. Their full
orbits decide whether smooth joined masses or explicit facets reconstruct more
cleanly on the effective native-MLX route.

The next image-generation atlas should keep a physical carrier fixed and vary
three controls separately: continuous muzzle construction, eye representation,
and coat-form organization. A companion style-expansion family should continue
searching stop-motion, adventure-game, tabletop-sculpt, and cel-painted physical
basins without changing camera, framing, pose, or projection in text.

Claim ceiling: the four-seed atlas establishes repeatable wording tendencies and
nominates exact conditioning images. It does not establish improved geometry,
winding, collision suitability, or production admission without matched
reconstruction and close-orbit inspection.
