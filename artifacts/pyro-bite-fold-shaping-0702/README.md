# Pyro Bite/Fold Shaping Receipt - 2026-07-02

This bundle records the first pass where the Pyro material-memory carrier gained separate shape controls for torn flame-edge bite, lower-boundary bite wake, and longer smoke fold wake.

## What changed

- `Bite Teeth` shifts the bite predicate from broad flame body toward high-gradient interface teeth.
- `Bite Wake` lets bite climb through the lower rising boundary instead of only biting the root.
- `Fold Wake` lengthens the smoke fold carrier downstream into the plume body.
- The controls are packed into `pyro_shape_controls` and do not add a new texture fetch.
- Carrier debug state records `biteShape`, `foldShape`, and the effective shape controls.

## Visual read

- `baseline-no-pyro.png`: same tall-plume/operator route with Pyro disabled. It preserves live smoke but only a faint ember, and the old fire-volume witness gate fails because visible fire is below threshold. This is retained as a comparison artifact, not as a passing proof.
- `shaped-normal.png`: production-ish view with Pyro enabled. The lower fire body reads stronger and more bitten while the smoke remains live and subordinate.
- `bite-teeth-wake.png`: bite isolate. The carrier concentrates around the lower flame/rising-boundary event rather than tinting the whole plume.
- `fold-long-wake.png`: fold isolate. The smoke carrier extends upward into the plume as a longer wake/memory path.
- `fuel-off-negative.png`: fuel-off route with Pyro still requested. Witness passes `no-fire-volume`; fuel/reaction/fire/radiance all read zero and the carrier reports zero effective gain/energy/uploaded cells.

## Witness summary

| Artifact | Mode | Result | Key receipt |
| --- | --- | --- | --- |
| `baseline-no-pyro.json` | `fire-volume` | expected fail | live smoke, Pyro disabled, fire-like pixels below beauty gate |
| `shaped-normal.json` | `pyro-material` | pass | `effectiveGain=1.5`, `uploadedCells=24`, `biteShape=1.00t/0.80w`, `foldShape=1.00w` |
| `bite-teeth-wake.json` | `pyro-material` | pass | bite isolate with live spatial coupling and same shape controls |
| `fold-long-wake.json` | `pyro-material` | pass | fold isolate with live spatial coupling and same shape controls |
| `fuel-off-negative.json` | `no-fire-volume` | pass | `reactionFuelScale=0`, `fuelMean=0`, `reactionMean=0`, `fireLayerMean=0`, `radianceMean=0`, carrier energy/uploaded cells zero |

## Smoke URL

Use the local server route:

```text
http://127.0.0.1:8099/?kaminos_volume_smoke=1&volume_scene=tall_plume&volume_tall_preset=operator_memory_fire_0701&volume_density=5.2&volume_fire=0&volume_radiance=3&volume_absorption=2&volume_glow=2.5&volume_smoke=2.8&volume_curl=2.7&volume_microdetail=2.5&volume_interface_shred=5&volume_fire_licks=1.7&volume_projection=1.5&volume_speed=5&volume_fire_scale=0.35&volume_detail_scale=0.5&volume_plume_height=1.2&volume_wind_strength=0.8&volume_wind_angle=0&volume_wind_height=-0.35&volume_input_radius=0.12&volume_flow_rate=0.35&volume_steps=160&volume_adaptive_rays=0&volume_occupancy_skip=0&volume_majorant_skip=1&volume_majorant_smooth=0.85&volume_majorant_guard=0.5&volume_temporal_accum=0&volume_temporal_jitter=0&volume_history_clamp=0.7&volume_render_scale=0.35&volume_resolution=128&volume_majorant_grid=48&volume_pressure_mode=global-p3&volume_pyro_detail=1&volume_pyro_material_gain=1.5&volume_pyro_interface_focus=1&volume_pyro_edge_bite=1&volume_pyro_bite_border=1&volume_pyro_bite_teeth=1&volume_pyro_bite_wake=0.8&volume_pyro_smoke_fold=1&volume_pyro_fold_border=0.65&volume_pyro_fold_wake=1&volume_pyro_diagnostic_paint=0&volume_pyro_overdrive=5&volume_quality_reason=pyro-bite-fold-shaping-0702
```

The expected smoke result is still not final-realism. It should feel like the Pyro carrier is now grabbing actual simulation events: bite wakes near the lower flame/rising boundary, fold wakes in the smoke body, and both die when live fire authority dies.
