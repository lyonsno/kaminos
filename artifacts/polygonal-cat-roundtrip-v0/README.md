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

Run the local contract with:

```sh
python3 -m unittest test_roundtrip_contract.py -v
```

The submitted Greenroom job identities and requested routes are recorded in
`submissions.json`.
