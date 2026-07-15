# LIRM Silhouette Latent Extrusion v0

This witness records the repaired latent-silhouette to 3D conditioning bridge.
The source is the morphology-diverse 12-shape subset selected from the beta
`0.01` VAE harvest. Each accepted binary mask is reconstructed as a
pixel-metric positive-inside signed-distance field before the rounded extrusion
is raymarched.

## Result

- Effective route: `cpu-sdf-raymarch-rounded-extrusion-v0`
- Source route: `mlx-sdf-vae-prior-sample-v0`
- Source distance contract: `mask-derived-chamfer-signed-distance`
- Resolution: `96` pixels per body and control channel
- Generated bodies: `12`
- Runtime: `17.957` seconds wall time
- Hit-pixel-fraction range: `0.233398` to `0.364041`
- Source receipt hash:
  `sha256:e3ad78648cd33a831a50b6c491ef5078d5fb445378239810ae2d90df4e677bc1`

The clay, depth, and normal sheets were visually inspected at original
resolution. Unlike the rejected pre-fix witness, which collapsed all twelve
inputs into nearly identical rectangular slabs, the corrected witness
preserves bifurcations, hooks, lateral lobes, narrow waists, detached-looking
lower masses, and the near-ring profile. These remain shallow rounded
extrusions rather than authored anatomy; their purpose is to carry distinct
silhouette gestalt into honest 3D image-generator controls.

The preserved sheets are first-class outputs of the recorded route. Their
exact hashes, dimensions, grid layout, and body count are bound in
`receipt.sanitized.json`. All three sheets were visually inspected at original
resolution after the receipt-bound run.

## Evidence

- `clay-contact-sheet.png`
  SHA-256 `6a994208d6e00b01ebba6a3a08400ff84c25d22a1c79e8b0821f75a473eee0d2`
- `depth-contact-sheet.png`
  SHA-256 `a7ba3c38588302f9de4f1d48f036cb9121df43c589d9bf5e807adf1a7fb2ddd3`
- `normal-contact-sheet.png`
  SHA-256 `408b5472fb49a911e7dae9f44813e07f281899d49a5b49eaf3967eb7b41f6b7e`
- `receipt.sanitized.json`
  SHA-256 `49122419b8e7653ee4aaec8a58a42843551ddb3041cc2a8b2805ec3cab2e07d3`

The discrimination regression renders two deliberately dissimilar normalized
latent fields and requires a hit-pixel-fraction spread above `0.08`. This fails
on the old scale-mismatched path and passes after metric reconstruction.
