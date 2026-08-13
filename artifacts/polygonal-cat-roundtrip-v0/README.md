# Polygonal Cat Round Trip

This assay asks whether FLUX's naturalistic polygonal-cat interpretation retains
its visual language after spatial reconstruction strongly enough to steer a
second FLUX pass into different compact-prompt basins.

The frozen source is the exact `This shape as a cat.` seed 80301 output from the
authored-envelope campaign. `submit_reconstructions.py` sends that image to
SF3D and Trellis through GPU Greenroom. The collector admits only terminal
receipts bound to the exact source, route type, output directory, and nonempty
GLB. It then renders matched six-view orbits and builds
`reconstruction-sheet.html` for perceptual selection.

Selection is deliberately hierarchical: first choose the reconstruction that
is most convincingly a coherent, naturalistic cat; use visible tessellation
scale as the secondary comparison. The second FLUX matrix is frozen only after
that visual selection, because morphology fidelity is the load-bearing
variable and raw face count is not a useful substitute for it.

The admitted selection is Trellis view `az180-el12`. `selection.json` binds the
selected plate and GLB by digest. `second-pass.json` freezes the first causal
return as one matched cell: the selected Trellis plate under the original
`This shape as a cat.` prompt, seed 80301, and original FLUX settings. Run
`submit_second_pass.py` idempotently, then `await_second_pass.py` to admit the
effective receipt and build `roundtrip-second-pass-sheet.html` with input,
prompt/settings, and output adjacent.

Run the local contract with:

```sh
python3 -m unittest test_roundtrip_contract.py -v
```

The reconstruction Greenroom identities are recorded in `submissions.json`;
the causal-return identity is recorded in `second-pass-submission.json`.

`cycle-2/` closes the next causal link. It freezes the exact second FLUX output,
submits that image through the same SF3D and Trellis routes, renders complete
matched orbits, and compares cycle-1 and cycle-2 Trellis geometry in Blender.
The registration is diagnostic and shape preserving: cycle 2 may receive only
translation, rotation, and one uniform scale. Raw side-by-side views remain
adjacent to registered overlays so pose correction cannot impersonate
morphological stability. The complete operator-facing record is
`cycle-2/cycle-2-sheet.html`.
