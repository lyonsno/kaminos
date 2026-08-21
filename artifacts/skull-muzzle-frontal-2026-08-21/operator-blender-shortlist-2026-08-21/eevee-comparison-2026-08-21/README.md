# Eevee Four-Cast Comparison

Question: Can the four shortlisted TRELLIS GLBs render as attractive,
spatially legible static visual casts in Blender Eevee without the severe
backface and ambient-occlusion ghosts seen in the Kaminos GTAO viewer route?

Result: yes for this operator-authored Eevee setup. All four casts remain
legible under one shared beauty-lighting treatment across frontal, oblique,
profile, and rear arrangements. Lighting and inter-part occlusion remain
stable enough to compare sculptural volume, and the severe Kaminos GTAO ghosts
do not appear. This materially lowers winding from a blanket static-render
blocker to a route-dependent defect that still requires per-cast inspection.

The comparison also preserves meaningful differences. The second cast has the
strongest naturalistic facial assembly and sculptural volume. The first is the
cleanest stylized cast. The third retains a strong faceted character read. The
fourth is coherent but carries the roughest surface and eye-region treatment.
The lighting is intentionally strong and clips some highlights, but the common
setup still exposes rather than erases the major geometric differences.

## Route

- Repo/worktree: `/private/tmp/kaminos-handy-candyman-skull-muzzle-0819`
- Branch: `cc/handy-candyman-crucible-shards-0713`
- Source HEAD before evidence preservation: `f5316c7ba7a3776f9224a92d323c8d9357941784`
- Mesh inputs: the four unchanged shortlist GLB links in the parent directory
- Renderer: Blender Eevee, operator-authored shared comparison scene
- Blender version: not recorded in the supplied screenshots
- Eevee scene controls: not yet recorded; visible evidence establishes the
  effective rendered result but does not identify which ray tracing, probe,
  Fast GI, shadow, material, exposure, or sampling settings produced it
- Capture time: 2026-08-21 18:25-18:26 EDT
- Capture route: operator screenshots of the Blender viewport/render surface

The [current Blender Eevee manual](https://docs.blender.org/manual/en/5.2/render/eevee/)
describes Eevee as a rasterization-based realtime PBR renderer capable of
high-quality final renders. Its [ray-tracing settings](https://docs.blender.org/manual/en/5.2/render/eevee/render_settings/raytracing.html)
include a surface-indirect-light pipeline, screen tracing, light-probe
fallbacks, denoising, and Fast GI approximation. Therefore, `not a path tracer`
is not an adequate description of its useful evidence ceiling for this assay.

## Images

- `01-oblique-lineup.png`: common oblique comparison of all four casts.
- `02-frontal-lineup.png`: common frontal comparison; best witness for facial
  assembly and eye alignment.
- `03-oblique-stagger.png`: separated oblique comparison that exposes cast
  silhouettes without overlap.
- `04-profile-stagger.png`: profile-biased comparison of muzzle depth and
  terminator shape.
- `05-rear-stagger.png`: rear comparison; best witness for unseen-side volume
  and bounded shell defects.
- `06-tight-oblique-lineup.png`: close oblique lineup under common lighting.

`sha256.txt` records SHA-256 hashes for all six raw screenshots.

Does not prove: consistent winding, correct face orientation, manifold or
watertight topology, absence of actual holes, collision suitability, clean
normal or texture baking, deformation, animation, arbitrary-light robustness,
Kaminos runtime behavior, or Cycles parity. It does prove that static beauty
rendering is not categorically blocked by the known winding defects under this
effective Eevee route.
