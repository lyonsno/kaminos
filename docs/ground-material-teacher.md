# Authored ground material

The first independent ground teacher is a deterministic authored surface: a
continuous rough earth matrix and partly buried, closed faceted grit and clods.
It is a microgeometry source for capture and learning, not a soil simulation.
`ground-surface-teacher` in the Workbench lets you inspect the source, edit grain
count, relief and seed, and use normal scene camera, selection and lighting.

The source and grass experiments share Knotty Photon Fluffer's explicit triangle
surface tracer. The tracer supports diffuse/GGX, geometric visibility and surface
bounces. Ground geometry repeats around a central tile with a finite halo. This
does not establish infinite periodic transport or seamless learned repetition.

`SurfaceMaterialTeacher.evaluateMaterial` accepts the existing eight-float
NeuMIP queries: UV, incoming view XY, incoming light XY, LOD, unused. X/Z are
the material's U/V axes and +Y is outward. View and light must be in the open
upper hemisphere. The reference plane lies above the complete source. Each
query integrates a square box of width `2^LOD / resolution` in that plane.
It uses one unit directional light per query and zero environment, with the
selected surface-bounce count. Labels are linear RGB radiance divided by the
macro surface/light cosine, which the live material multiplies back in.
No image reconstruction or denoising enters these labels.

To run a small fit, prepare caller-owned JSON containing optional `source` and
`fit` objects and invoke through GPU Greenroom:

```sh
node tools/ground-material-fit.mjs /path/to/config.json /path/to/results
```

The tool records actual source and configuration, hardware identity, retained
training and held-out queries/labels, early checkpoints, archive digests, and
matched source/student RGB arrays. It defaults to 64 square, 2,000 updates,
2,048 queries per update, 65,536 stored training queries, eight path samples per
training label, and 32 per held-out label. These are preliminary experiment
settings, not convergence criteria. The finite label set is reused; training
does not produce a fresh independent path integral for every update. Data and
source remain in the selected output directory. On failure `report.json`
preserves the phase, last trustworthy results and error.

The direct source, learned archive and matching material-domain images answer
different questions. Loss reduction establishes fitting progress. The
Workbench exercises the material under scene camera and lighting. Actual
source/student comparison is needed to decide which structures survive and
whether a larger fit is worthwhile.
