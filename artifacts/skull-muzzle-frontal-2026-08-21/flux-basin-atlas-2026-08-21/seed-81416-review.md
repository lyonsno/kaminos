# Seed 81416 Direct Review

All eighteen cells completed through requested and effective Greenroom route
`mflux_flux2_edit_promptfile` using `flux2-klein-9b` Q4 at 512 square, eight
steps, guidance 1.0, seed 81416, and a 48 GB MLX cache limit. Per-cell
`metadata.json` files record job ids, effective parameters, output inventory,
and timings. Durations ranged from 45.2 to 54.6 seconds. Every `output.png` was
opened and inspected directly; no cell was blank, missing, cached from another
seed, or silently routed through a fallback.

## Ranked Reconstruction Sources

1. `08-polished-low-poly/output.png` - strongest broad-plane control. The head,
   ears, horns, muzzle, nose, cheeks, and eye sockets resolve into explicit
   facets. The source identity is simplified, but the image gives TRELLIS an
   unusually legible geometry carrier.
2. `09-lifelike-character-maquette/output.png` - strongest physical-sculpture
   control. Broad coat locks, clean silhouette, and a coherent maquette surface
   survive, but this seed becomes unpainted with blank eye inserts and loses
   more identity than seed 81415.
3. `01-hybrid-broad-sculpture/output.png` - best identity-preserving hybrid in
   this seed. Natural adult proportions and facial organization survive while
   the coat becomes moderately broader. Fine strands remain, so it is not the
   cleanest reconstruction source.
4. `03-hybrid-carved-locks/output.png` - strongest explicit lock organization.
   It reliably selects dense carved relief and a wooden-sculpture material
   prior; useful for testing whether explicit coat ownership outweighs the
   literal material bias.
5. `11-painted-resin-bust/output.png` - crisp layered relief and strong feature
   separation, with a decorative bas-relief tendency and reduced naturalism.

## Cross-Seed Findings

- Prompt families are stable as distributions, not identity locks. The same
  words repeatedly select the same structural vocabulary, while finish,
  expression, and exact facial identity vary materially by seed.
- `maquette` reliably purchases physically owned surfaces and sculpted coat
  locks. Seed 81415 retained painted eyes and more expression; seed 81416
  produced an unpainted sculpt with blank eye inserts.
- `cinematic animated creature` and `modern stylized 3D game character`
  reliably produce clean character geometry, but this seed normalizes the
  source into a generic handsome fox or mascot. These are geometry basins with
  a substantial identity tax.
- `carved`, `resin`, `clay`, `ceramic`, `bronze`, `vinyl`, `cel`, and `felt`
  are not cosmetic modifiers. They select different structural priors: relief,
  modeled masses, smooth shell, monolithic cast, rounded toy parts, flattened
  planes, or literal fibers.
- Exact cells, not prompt labels, are the promotion unit. A prompt family may
  be reusable while only particular seeds preserve the desired source identity.

## Useful Misses

- `02-hybrid-owned-masses` under-reacts toward the source photograph and keeps
  fine fur.
- `04-cinematic-animation-natural` and `05-feature-animation-natural-eyes`
  are clean but genericize the creature.
- `06-modern-game-character` produces excellent molded pieces but enlarges the
  eyes and pushes mascot identity; `07-hand-painted-game-asset` flattens depth.
- `10-stop-motion-maquette` interprets the coat as dense literal fibers and
  whisker rods, making it more TRELLIS-hostile than the lifelike maquette.
- `12-colored-clay-maquette` gives clean clay masses but enlarged eyes and
  softened anatomy; `13-painted-carved-wood` is a strong literal wood carving.
- `14-glazed-ceramic` and `15-cast-bronze` create coherent shells while erasing
  eye/material differentiation.
- `16-soft-vinyl-figure` is an extremely clean toy basin with severe cute drift.
  `17-three-dimensional-cel` is comparatively flat. `18-crafted-felt-puppet`
  adds a literal tailored coat and is preserved as a style-bound useful miss.

## Next Firing Boundary

Use exact seed cells for matched TRELLIS probes. The first set should span
identity preservation (`81416/01`), broad planes (`81416/08`), and physical
maquette ownership (`81415/09` or `81416/09`). Do not claim improved geometry
until each selected source survives direct close orbit in the Kaminos viewer.
