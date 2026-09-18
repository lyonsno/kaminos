# Static kiln bounce decision census

Read-only exploratory apparatus; not a GI implementation or selected transport representation. `measure.mjs` reuses the actual scene restore and existing GPU timing hooks, exposes scene handles through an explicitly retained browser-response injection, and saves all world-space caster triangles for offline re-analysis. No scene save, mesh edit, gain change, or flame-setting mutation. Original live/operator tabs are not driven.

```sh
node scratch/kiln-bounce-0918/check.mjs
node tests/scene-authoring-witness-contracts.mjs
node scratch/kiln-bounce-0918/measure.mjs OUTPUT ORIGIN SCENE 240 0.1,0.2,0.4 on
node scratch/kiln-bounce-0918/measure.mjs OUTPUT ORIGIN SCENE 240 0.1,0.2,0.4 off
```

Run browser work through the local job supervisor and GPU lease coordinator. The driver claims/releases its own lease; output paths are caller-selected. Browser dependency matches the existing retained kiln witness; no package installation is required on this workstation. Failed runs retain phase/error reports. The three pitches, 240 presentation intervals, and five GPU-profile repeats are explicit exploratory observations, not accepted visual resolutions, system limits, or statistical confidence bounds.

## Interpretation

- `world-triangles.f32`: little-endian world-space XYZ, nine float32 values per triangle, every visible declared ordinary mesh caster, draw ranges respected. `geometry.meshes` maps float offsets to material/transform identities. Static ordinary meshes only; skinned/instanced input fails. This is the caster set, not a guarantee that all possible receiving surfaces are included.
- `areaQuota = ceil(total triangle area / pitch²)`: illustrative equal-area sample budget. It is not a constructed patch mesh, quality bound, or proof that geometry can be merged at this scale.
- Centroid-cell counts do not rasterize triangle coverage. Opposite dominant-normal bins warn that cell-only merging loses distinctions; they do not distinguish true opposing surfaces from inconsistent source winding.
- Dense scalar-transfer bytes assume areaQuota² float32 coefficients. The estimate is a deliberately naive baseline, not a requirement of surface methods.
- Probe candidates cover the full bounding box. Counts precede rejection of solid/irrelevant space and are not an optimized sparse-probe layout. Cached-hit byte projections assume32 bytes/hit and128 or512 directions; neither format nor quality is established.
- Existing Three timestamps and separate irradiance replay are not full live-fluid GPU frame timing. Presentation intervals are not spare GPU milliseconds. Shared workstation load is uncontrolled. No measured runtime cost of either GI candidate is supplied.
- Material scalar metalness is multiplied by its texture when present; a scalar1 is not a declaration that the whole reconstructed kiln is metal. A diffuse bounce must use actual linear reflectance, not the already-lit output color.

Raw September18 evidence and process receipts live at `/Users/noahlyons/.local/state/kaminos/evidence/beaming-bounce-decision-0918/`, arms `first` (timestamps on) and `no-timestamps`. Both use scene `refractory-kiln_2026-09-18_04-24-18_a372a40fee0143609b479c40b8585232.kaminos.json` from Beaming8144, not an assertion about unsaved operator state. Their geometry bytes, saved scene, camera, and source GLB agree. No benchmark winner follows from this census alone.
