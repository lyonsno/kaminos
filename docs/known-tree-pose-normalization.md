# Provisional known-tree pose normalization

This offline experiment estimates a temporary instance of an existing named
joint tree from a registered generated surface. It does not infer a new rig or
establish anatomical joint truth. Authored source rigs, meshes and saved global
registrations remain unchanged. SciPy supplies sparse least squares and the
nearest-surface-cell index; nothing is added to live playback.

`tools/pose-normalization-build.py --plan <json> --stage fit --voxel-size .08
--out <new-directory> --report <independent-report.json>` authenticates both
retained case packages and the exact generating frame. Every positive-area
surface cell contributes to a capsule-union objective; the voxel size controls
geometric resolution rather than retaining only the first N samples. Zero-area
vertices remain in the body but provide no area evidence to the fit. Soft
segment-length, radius and positional priors regularize the existing tree.
The solver's own default evaluation capacity is retained and its termination,
surface residuals, unsupported segments and all fitted positions are returned.

The current foot feature is explicitly quadruped-specific: Y-up, X-lateral,
front along negative Z, separated limbs. Each known quadrant's lower surface
patch supplies provisional MTP/toe-tip correspondences. Crossed or fused limbs,
missing anatomy, an incorrect global orientation, or another morphology are
outside this feature's established evidence. Radius tables are rough source
proxy choices, not measurements of bone or muscle anatomy. A lower objective
does not prove correct joint placement; inspect the three diagnostic views.

For a fit-only protected-region diagnostic, repeat `--fixed-joint <source-name>`.
These joint positions are removed from the optimization and remain exactly at
the registered source positions; proxy radii and all other joint positions stay
free. Unknown names and contradictory anchors fail visibly. Requested names
and effective `fixedJointIndices` are recorded. Holding the axial joints fixed
prevents invented backbone bends by construction, not by recovering anatomy:
it deliberately leaves any source torso mismatch unresolved. This is an
explicit diagnostic option, not the new default fit or a successful correction.
Correction consumes the recorded fit and rejects this fit-only CLI option.

`--stage correct --fit-report <completed-fit-report>` reuses that exact fit
without editing the plan. It derives a surface-geodesic segment partition with
the authenticated retained binder. Segment-local rigid transport preserves
radial offsets; axial stretch is explicit. Blending these maps is a first
correction baseline, not a full embedded-deformation/ARAP solve and not a muscle
or skin-sliding model. Unknown disconnected components retain the binder's
explicit pelvis-carry policy and are reported, not silently cleaned away.

Two different outputs are retained:

- `pose-only/surface.npz` changes segment directions but preserves the fitted
  segment lengths. It is not a moving result on the unchanged source frame;
  it would need an explicitly proportion-retargeted rig/motion consumer.
- `rig-proportions/manifest.json` also matches the generating rig's lengths,
  preserving the named tree and exact retained motion consumer. This can change
  the cat's proportions. Reported length ratios and displacement quantify that
  price; do not label this candidate pose-only.

Both outputs preserve input vertex/index inventory. Source hashes, fit data,
requested parameters, effective Python/NumPy/source revision and failure phase
live in the caller's report. New output directories must be empty. The report
must not alias a retained input or a generated package. Authenticated failure
reports are evidence of failure, not a completed comparison.

Tests: `.venv/bin/python -m unittest discover -s tests -p test_pose_normalization.py -v`.
Actual large-cast computation goes through Greenroom with this Python command
directly as its payload. A completion observer runs separately; placing a
detaching supervisor inside the queue does not serialize its child.
