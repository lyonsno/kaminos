# TRELLIS Cascade Ceiling Assay

Status: complete and visually inspected on 2026-08-21.

This is the operator-requested two-cell comparison from each source's existing
eight-step, cascade-disabled control to a twelve-step, cascade-enabled firing.
It is deliberately not an 8/10/12 staircase.

## Result

Twelve steps plus cascade did not produce a useful large delta on either
productive source. The existing eight-step, cascade-disabled route remains the
default for this source family.

- `feature-animation-81412/trellis-81414-steps12-cascade`: the front and
  oblique views are lateral to, and slightly harsher around the eyes and muzzle
  than, the eight-step control. The rear has somewhat larger coherent clumps,
  but no material whole-cast improvement. Runtime rose from 166.5 seconds to
  248.1 seconds, a 49.0% increase.
- `identity-hybrid-81416/trellis-81421-steps12-cascade`: the front and oblique
  views are close to the eight-step control, with at most a modest gain in
  facial fullness. The rear is visibly worse: a strong horizontal material
  discontinuity divides orange upper locks from a pale lower ruff. Runtime rose
  from 126.8 seconds to 192.7 seconds, a 52.0% increase.

The result is negative but informative: the larger schedule plus native
cascade does not earn its extra time for these two sources. It should not be
applied as a blanket quality upgrade.

## Route Identity

Both new cells requested and received the GPU Greenroom
`trellis2mlx_cascade_steps` route using native MLX TRELLIS at
`/Users/noahlyons/dev/trellis2mlx` commit
`677e7ac98c1a045beec451acd21376a3953b5976`, model
`microsoft/TRELLIS-image-large`, resolution 512, twelve steps, 100000 target
faces, 512 texture size, and simplify-first. The effective commands use
`generate.py` and contain no `--no-cascade`, so native cascade remained active.
No backend fallback occurred.

- Feature animation: Greenroom job `16bf6a2a7390`, source seed 81412, TRELLIS
  seed 81414, effective duration 248.1 seconds, exit 0. Control job
  `da74d654295c` used eight steps with cascade disabled.
- Identity hybrid: Greenroom job `8d5feef7a90a`, source seed 81416, TRELLIS
  seed 81421, effective duration 192.7 seconds, exit 0. Control job
  `5dfac5a7b3a0` used eight steps with cascade disabled.

Each output's `receipts/` directory preserves the exact Greenroom request,
status, terminal receipt, stdout, and stderr. Each `witnesses/` directory
preserves front, oblique, rear, rear-oblique, and direct-link registration
evidence.

## Cast Inventory

- Feature control GLB: 4,363,992 bytes,
  SHA-256 `61b67a7ad4692dc7f5206477c60fbf73b3db3aa4798888dd8ed3694e900005af`.
- Feature 12-step cascade GLB: 4,071,452 bytes,
  SHA-256 `a6b3d522c0f243d15ff012e72f60cd92dafd1b3185997a0de47f1d020ecaee7c`.
- Identity control GLB: 4,636,532 bytes,
  SHA-256 `504096d7acfaa7f9b928088ad2560255c09b98c39389f50fc43a92c89d06bbaa`.
- Identity 12-step cascade GLB: 4,633,988 bytes,
  SHA-256 `ded1d827763238533a21b46c49eaccc0e976288e2addcfecdf79f1b22ce627be`.

## Operator Smoke

The following Kaminos single-asset routes were replayed against
`lerms-preview=/private/tmp`. Both fetched the exact GLB through `/api/read`,
registered it as a live scene object, and produced a visually nonblank witness.

- Feature animation:
  `http://127.0.0.1:8104/index.html?mesh_root=lerms-preview&mesh_path=kaminos-handy-candyman-skull-muzzle-0819%2Fartifacts%2Fskull-muzzle-frontal-2026-08-21%2Ftrellis-cascade-ceiling-2026-08-21%2Ffeature-animation-81412%2Ftrellis-81414-steps12-cascade%2Foutput.glb`
- Identity hybrid:
  `http://127.0.0.1:8104/index.html?mesh_root=lerms-preview&mesh_path=kaminos-handy-candyman-skull-muzzle-0819%2Fartifacts%2Fskull-muzzle-frontal-2026-08-21%2Ftrellis-cascade-ceiling-2026-08-21%2Fidentity-hybrid-81416%2Ftrellis-81421-steps12-cascade%2Foutput.glb`

## Claim Ceiling

This pair shows that twelve steps plus cascade fails to materially improve two
already-productive conditioning basins on the current native MLX route. It
cannot separate the causal contribution of step count from cascade, establish
CUDA parity, establish general TRELLIS behavior, or admit production topology.
The matched rear witnesses are comparison evidence, not a claim that cascade
is a targeted unseen-side repair pass.

## Next Decision Boundary

Inspect the first two fresh seeds from the 64-cell FLUX physical-model
micro-wording atlas. Promote only source images that improve owned sculptural
geometry without collapsing identity, eye treatment, or the legible bust
terminator; reconstruct those sources at the proven eight-step,
cascade-disabled TRELLIS control before spending on another ceiling assay.

Call sign: Handy Candyman
