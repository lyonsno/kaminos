# Pyro carrier continuous controls 2026-07-01

Receipt for the cockpit repair after operator smoke found the previous `All loud`
mode too fake and the normal controls too shy.

## What changed

- `Carrier View` now selects which carrier contributes; it does not force
  false-color paint.
- `Pyro Drive` is continuous carrier gain in normal mode and isolate modes.
- `Diagnostic Paint` is a separate continuous overlay. `0` leaves carrier views
  in real material space.
- `Bite Border` and `Fold Border` add per-effect interface focus by reusing the
  already-computed flame/smoke interface signal. No new texture/state pass.

## Captures

All captures came from this worktree through:

`http://127.0.0.1:8099/?kaminos_volume_smoke=1&volume_scene=tall_plume&volume_tall_preset=operator_memory_fire_0701&volume_density=5.2&volume_fire=0&volume_radiance=3&volume_absorption=2&volume_glow=2.5&volume_smoke=2.8&volume_curl=2.7&volume_microdetail=2.5&volume_interface_shred=5&volume_fire_licks=1.7&volume_projection=1.5&volume_speed=5&volume_fire_scale=0.35&volume_detail_scale=0.5&volume_plume_height=1.2&volume_wind_strength=0.8&volume_wind_angle=0&volume_wind_height=-0.35&volume_input_radius=0.12&volume_flow_rate=0.35&volume_steps=160&volume_adaptive_rays=0&volume_occupancy_skip=0&volume_majorant_skip=1&volume_majorant_smooth=0.85&volume_majorant_guard=0.5&volume_temporal_accum=0&volume_temporal_jitter=0&volume_history_clamp=0.7&volume_render_scale=0.35&volume_resolution=128&volume_majorant_grid=48&volume_pressure_mode=global-p3&volume_pyro_detail=1&volume_pyro_material_gain=1.5&volume_pyro_interface_focus=1&volume_pyro_edge_bite=1&volume_pyro_bite_border=1&volume_pyro_smoke_fold=1&volume_pyro_fold_border=1&volume_quality_reason=pyro-continuous-controls-0701`

| Capture | Route suffix | Result |
| --- | --- | --- |
| `normal-high-drive.png` | `volume_pyro_carrier_view=normal&volume_pyro_overdrive=8&volume_pyro_diagnostic_paint=0` | Passed witness. Real material color, compact fire/smoke, no cyan paint. |
| `all-carriers-no-paint.png` | `volume_pyro_carrier_view=all&volume_pyro_overdrive=8&volume_pyro_diagnostic_paint=0` | Passed witness. End-range all-carrier view is smoke-dominant but not false-color/gonzo. |
| `all-carriers-painted.png` | `volume_pyro_carrier_view=all&volume_pyro_overdrive=8&volume_pyro_diagnostic_paint=0.55` | Passed witness. Cyan paint appears only because diagnostic paint is nonzero. |

Each capture has a matching `.json`, `.stdout.json`, `.full.png`, and
main-renderer screenshot when produced by `volume-witness.mjs`.

## Visual inspection

Inspected with `view_image`:

- `normal-high-drive.png`: readable tall-plume form, no cyan paint, no hard
  diagnostic posterization.
- `all-carriers-no-paint.png`: strongly smoke/fold-biased at maxed carrier
  settings; useful as an end-range basin, not a final look.
- `all-carriers-painted.png`: diagnostic cyan is bounded and optional.

One first normal capture failed with `volume route did not render enough frames`
at the expensive 128^3/160-step settings. It was rerun with a longer settle and
the final `normal-high-drive.json` is passing evidence.
