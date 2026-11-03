# Formed Hill landscape

Open `?workspace=workbench&experiment=hill-geology` in Kaminos. The experiment mounts the formed rock and loose-earth surface in the native scene. The earlier `hill-terrain` experiment remains available for comparison.

The initial terrain is a gently folded upland dipping toward a central outlet on its front edge. Seeded small topographic variations initiate competing drainage paths. A priority flood supplies spill routes through depressions; an acyclic eight-neighbor drainage graph accumulates contributing area. Above the chosen channel source area, stream-power incision removes loose material first and then rock, modulated by buried tilted/folded resistance bands. Deposited sediment increases local slope and carrying capacity, solved together to avoid explicit deposition spikes. Weathering converts bedrock to loose cover; conservative slope transport moves that cover. Sediment leaving the open outlet is accounted separately. All other edges are closed to fluvial export.

This is a reduced formation model, not calibrated geological prediction. Formation steps have no claimed duration in years. Rainfall is implicit and spatially uniform, the channel threshold approximates channel initiation, and bedrock and loose material use equal volume density. No chemical species, groundwater, suspended-fluid dynamics, ice or volumetric fracture is simulated. The two mechanical layers retain a procedural stratigraphy description; their representation remains a single surface per horizontal sample. Rock color follows that same stratigraphy; cover thickness controls how much is exposed.

## Preparation and caching

Formation is separate from live playback. The bundled default is a prepared binary cache. New settings run the identical deterministic formation module in a dedicated CPU worker; the worker terminates on completion, disposal or superseding settings. The UI keeps the previous terrain visible and marks preparation as pending. Generation is a preparation cost, not part of the game frame loop. Automated qualifying preparation and numerical browser runs go through Greenroom.

Memory and IndexedDB caches are keyed by the complete normalized recipe and solver version. The binary stores a JSON header and float32 material state with a payload checksum. Load rejects incomplete/corrupt data, mismatched recipes and unsupported solver versions. A persistent-storage failure is visible and leaves the computed result usable in memory. Solver changes that reinterpret results require a version change. The cache represents the **formed initial landscape**, not later live edits; velocity and actor-memory channels are zero.

Default: 129×129 samples, 32,768 triangles, approximately261KiB on disk. The shared GPU instance currently owns2,130,304 bytes of storage arrays plus393,216 bytes of triangle indices, excluding renderer/shadow/driver allocations. Initialization uploads the cached material fields and derives geometry, normals and colors on the host WebGPU device. Idle terrain dispatches no evolution. Optional settling uses the existing GPU transport and interpolation; no terrain state is read back in playback, controls or rendering. The 60Hz composed game budget remains unmeasured.

The same file contract works outside the browser:

```sh
node tools/hill-form.mjs --config experiments/hill-terrain/cache/default.recipe.json --output /chosen/path/landscape.hill
```

The tool writes a terminal `.report.json` on success or failure, with effective recipe, source hash, output checksum and material accounting. Run it through the shop queue for substantial configurations. `encodeFormation`/`decodeFormation` are shared by the tool and browser. The Workbench `recipe` operation returns the current inputs; `cache` returns the encoded initial state. These are not evolved-state checkpoints or scene-document reconstruction.

## Controls and integration

Seed, formation age, initial relief, rock-bed tilt/thickness, resistance contrast, channel source area, incision and weathering tune automatically after a short debounce. Rebuilding replaces the initial terrain and resets optional settling. Native scene selection, transforms and camera navigation remain available. Framing uses an initial envelope; exact CPU surface picking and geometry export remain unavailable because they would consult stale CPU geometry.

`window.kaminosHillGeology.read()` distinguishes requested inputs, effective formed recipe, cache source, pending work and GPU provenance. `.gpu()` supplies the existing same-device height/material surface and local-to-world transform. `.snapshot()` is an explicit offline numerical witness only. Initial rock/soil and geological preparation are not player or creature history. Fluid and creature interaction are later composition work.

## Verification

```sh
npm test -- --only tests/hill-formation.mjs,tests/hill-formation-cache.mjs,tests/hill-geology-witness.mjs,tests/hill-terrain.mjs,tests/hill-terrain-experiment.mjs,tests/hill-terrain-witness.mjs
```

The tests cover deterministic formation, drainage exits/cycles, material accounting, channel initiation, uniform-slope stability, excavation-sensitive rock resistance, cache corruption/recipe mismatch, cancellation and GPU source admission. `tools/hill-geology-witness.mjs` takes explicit `--url`, `--root`, `--out`, `--browser`, and `--playwright` paths. It compares the actual GPU state with the retained cache, checks idle stability and cache reload, exercises native controls and a worker-generated configuration, captures the scene and checks disposal. Raw arrays and source/config identities are retained. Numerical checks do not establish visual plausibility; inspect the native frames.

Formation references: [Cordonnier et al., uplift and fluvial erosion](https://perso.liris.cnrs.fr/apeytavi/website/publication/hal-01262376/), [Sculpting Mountains, subsurface geology](https://pubmed.ncbi.nlm.nih.gov/28368822/), and [Yoo et al., hillslope weathering and sediment transport](https://www.usgs.gov/publications/spatial-patterns-and-controls-soil-chemical-weathering-rates-along-a-transient). These motivate the process selection; this implementation is not a reproduction of those full models.
