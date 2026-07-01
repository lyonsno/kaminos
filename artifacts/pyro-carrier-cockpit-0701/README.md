# Pyro Carrier Cockpit 2026-07-01

Evidence for the tall-plume Pyro material carrier cockpit slice.

- `tall-pyro-cockpit-warm.png` / `.json`: passed Pyro material witness after a warm settle. Route requested `operator_memory_fire_0701`, Pyro gain `1.20`, border `0.85`, bite `0.45`, fold `0.35`, tint `0.25`. The report records 24 uploaded spatial memory cells, effective gain `1.2`, live fire authority `1`, smoke authority `0.784`, and `pyro-material-coupled-volume-signal`.
- `tall-pyro-fuel-off-reset.png` / `.json`: passed no-fire negative control with Pyro gain still requested and `volume_reaction_fuel=0`. The report records `blocked-reset`, effective gain `0`, uploaded cells `0`, reset reason `fuel-off`, zero fuel/reaction/fire/emission means, and zero fire-like pixels.
- `tall-pyro-gain-off.png` / `.json`: visual contrast route with the same tall-plume preset and Pyro material gain `0`. The strict fire-volume witness rejected it because the visible fire is intentionally narrow in this preset, but the report is useful as an off-axis comparison against the warm cockpit capture.
- `tall-pyro-cockpit.png` / `.json`: early-settle diagnostic capture. It showed live coupling state but was visually cold; the warm-settle capture above is the accepted smoke.
