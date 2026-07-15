# LIRM Silhouette Latent Harvest v0

This witness records the first uncapped checkpoint-only harvest from the beta
`0.01` MLX convolutional SDF VAE. The source corpus contains `2,421`
identity-free silhouette SDFs. Sampling used seed `991`, temperature `0.7`, and
the corrected positive-inside decode contract.

## Result

- Greenroom job: `c5f5a51bfaec`
- Effective Greenroom command: recorded in the job receipt under
  `/Users/noahlyons/.local/state/gpu-greenroom/done/c5f5a51bfaec/receipt.json`
- Runtime: `157.4s`
- Generated fields: `96`
- Accepted for downstream conditioning: `94`
- Copied training silhouettes: `0`
- Unusable silhouettes: `2` (`prior-shape-0006`, `prior-shape-0053`, both
  rejected for touching the frame)
- Foreground occupancy range: `0.247620` to `0.596619`

The contact sheet was visually inspected at original resolution. The learned
prior produces squat shells, tall bifurcated bodies, hooked and crescent forms,
lateral appendage masses, asymmetrical tripod-like profiles, and a few
multipart shapes. Rounded contiguous masses remain the dominant family.

## Selected 3D Control Fanout

The first morphology-diverse accepted subset is:

`prior-shape-0009, prior-shape-0014, prior-shape-0021, prior-shape-0026,
prior-shape-0032, prior-shape-0039, prior-shape-0043, prior-shape-0052,
prior-shape-0063, prior-shape-0066, prior-shape-0069, prior-shape-0087`

These silhouettes exercise star-like, heart-like, narrow-necked, pronged,
tripod, lateral-mass, hooked, crescent, legged, arched, and perforated profiles.
They feed the rounded-extrusion conditioning bridge for clay, depth, normal,
mask, and transparent-clay controls.

## Evidence

- `contact-sheet.png`: visually inspected 8 by 12 witness.
- `receipt.sanitized.json`: route identity, source receipt and checkpoint hashes,
  effective configuration, novelty/usability assays, and all 96 generation
  records.
- Contact-sheet SHA-256:
  `5ae9b8e72cf96b00c9404d8534db08f1b9573bd24b4ab32c6c0d570939618fb5`
- Sanitized-receipt SHA-256:
  `744b294cad9ab59710a8202223249cf2dc3f34d285e9b45209ca83916b636abc`

The source checkpoint receipt preserves its historical
`normalized_sdf < 0` witness metadata. This harvest records
`normalized_sdf > 0` as the effective decode and retains the historical value
under `sourceModel.receiptMaskDecode`.
