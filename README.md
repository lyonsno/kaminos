# Kaminos

Kaminos is a browser-native WebGPU scene and material lab. The current prototype includes realtime volumetric fire and smoke running directly in the browser, with a tunable tall-plume fire volume, spatial pressure tiers, debug overlays, and witness tooling for preserving route identity and visual evidence.

The fire volume is still an internal primitive rather than a polished public API. The landing state is intentionally honest about that boundary: it demonstrates high-fidelity dancing flame and smoke in-browser today, while the next integration work is expected to package the effect into scene-placeable primitives and consumer routes such as kiln activity states.

## Local Smoke

Serve the checkout and open the volume smoke route:

```sh
python3 serve.py 8095
```

```text
http://127.0.0.1:8095/?kaminos_volume_smoke=1&volume_scene=tall_plume
```
