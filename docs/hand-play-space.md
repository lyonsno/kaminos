# Glove Play Space

`hand-play-space` is an opt-in Workbench fixture stacked on `hand-goin-pile`.
It maps comfortable camera-facing hand motion into a broad game-space court.
This is an authored control mapping, not metric camera-to-world registration.
The existing hand, runway and pile experiments keep their original mapping.

The browser route returns unmirrored camera pixels, a pixel crop box, normalized
crop UV and upstream-regressed mesh joints. Wrist UV (index 0) is converted
through the exact inference crop into full-image coordinates. Camera-plane
translation controls avatar X/Y; depth is explicitly fixed. Both the mesh and
its jets use one whole-avatar mirror, rotation and scale. The mesh is centered
at its wrist rather than the mean of its vertices, so curling cannot shift
the whole glove by changing its centroid. Native inference remains untouched.

Defaults: horizontal reach 7, vertical reach 3, height 1.2, depth 1.8,
whole-glove tilt 65 degrees, mirrored camera control. `setPlaySpace` changes
these values without restarting camera or water. Numeric controls call the
same operation. Effective values, image-wrist coordinates, source capture,
fallback and full display transform are retained with the experiment events.
Controls are live state; reopening can reproduce them through `experiment_inputs`.

Four six-goin stacks form a broad receiving court; floor rings are noncolliding
inlays. Cannon bodies and particle impulses are unchanged. `goinPile.stackCenters`
authors X/Z stack positions; omitted centers preserve the previous pile layout.
Reset pile rebuilds water and bodies, not the camera. The existing shared camera
can orbit/frame the court. Terrain is not required and no target-following aim
assist changes fingertip direction.

Missing or malformed placement data fails visibly rather than substituting
detector-box motion. Detector-fallback predictions remain visibly diagnostic;
the existing fluid authority rule disables emission on fallback or stale input.
The fixture does not establish that wrist UV is stable under every pose or
that it is comfortable to use. Those remain natural-route observations.
