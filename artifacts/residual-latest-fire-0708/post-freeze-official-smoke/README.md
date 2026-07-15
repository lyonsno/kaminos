# Kaminos post-freeze official residual A/B — 2026-07-08

Question: after fixing look-freeze renderer-phase crawl, does the browser feature-RGBA residual still show a meaningful same-state visual delta at render scale 0.10?

Result: captured four same-state canvas clips under pinned sim/render phase. Inspect `index.html` for visual judgment.

Route:
- repo/worktree: /private/tmp/kaminos-kaminos-desperate-latest-fire-0707
- branch: cc/kaminos-desperate-latest-fire-0707
- commit: bee1e57c6b16e231db5b1d42f95f54eb943cfd8a
- route: http://127.0.0.1:18176/?kaminos_volume_smoke=1&volume_scene=tall_plume&volume_tall_preset=pyro_flow_small_bonfire_gamut_0707&volume_resolution=160&volume_majorant_grid=48&volume_pressure_mode=global-p3&volume_temporal_accum=0&volume_temporal_jitter=0&volume_render_scale=0.10&volume_residual_mode=webgpu-direct-residual&volume_residual_model_url=artifacts%2Fresidual-latest-fire-0707%2Fbrowser-feature-rs010-frontbite-feature-rgba.json&volume_residual_strength=1&volume_look_freeze=0
- model: artifacts/residual-latest-fire-0707/browser-feature-rs010-frontbite-feature-rgba.json
- backend: WebGPU:apple
- pinned sim step: 127
- pinned render phase: frame 127, time 3443.899999976158ms, authority look-freeze-pinned-render-phase

Images:
- `01_low_rs010_linear_off.png`: 0.10 linear-css-upscale / residual off; sha256 `1c92992cd2d37f9b2dcff63d4ed0302ebe88a78b83cff35685e73be9275194a5`
- `02_low_rs010_feature_rgba_residual_on.png`: 0.10 browser feature-RGBA residual / strength 1; sha256 `7ae88304172f69872fe17f4383c1c0a3f7c9713ad8dac82f489a05db59d0825f`
- `03_low_rs010_feature_rgba_residual_gain150.png`: 0.10 browser feature-RGBA residual / strength 1.5; sha256 `5634ddcef9d7bb3142fb06f1bd9c1c11c3aed3f4214d9aebfc5d51e6b24fae2f`
- `04_ref_rs100_native_off.png`: 1.00 native reference / residual off; sha256 `8ab9a38defc8e6723776e28c224139efd918e67c73c2c8442cee4f9e79343d5e`

Does not prove: final product beauty, temporal stability, or smoke readiness. This is a same-state fixed-freeze visual A/B for the current browser residual candidate.
## Visual read after inspection

The freeze predicate is clean: all captures stayed on sim step `127`, render phase frame `127`, and render phase time `3443.899999976158ms` while the frame counter continued advancing. The browser residual route loaded with `volumeResidualStatus: loaded` and `volumeResidualAuthority: browser-webgpu-direct-residual-v0`.

On this frozen frame, the strength-1 feature-RGBA residual is real but subtle. It changes about 27% of pixels, but the mean absolute channel delta is only about `0.30/255` (`pixel_delta_summary.json`). Strength `1.5` is more visible (`0.47/255` mean abs channel), but still nowhere near the native reference's additional flame grain. The current official model is therefore still a modest/detail-touch candidate, not a solved `0.10` reconstruction.

The native reference remains visibly sharper in the flame body and front grain. This does not kill the lane; it says the current browser-direct artifact is underdriving the available high-frequency target on this fixed-freeze official frame.

Live play route on the fixed branch/server used for this capture:

```text
http://127.0.0.1:18176/?kaminos_volume_smoke=1&volume_scene=tall_plume&volume_tall_preset=pyro_flow_small_bonfire_gamut_0707&volume_resolution=160&volume_majorant_grid=48&volume_pressure_mode=global-p3&volume_temporal_accum=0&volume_temporal_jitter=0&volume_render_scale=0.10&volume_residual_mode=webgpu-direct-residual&volume_residual_model_url=artifacts/residual-latest-fire-0707/browser-feature-rs010-frontbite-feature-rgba.json&volume_residual_strength=1
```

Useful local viewer:

```text
http://127.0.0.1:18176/artifacts/residual-latest-fire-0708/post-freeze-official-smoke/index.html
```

