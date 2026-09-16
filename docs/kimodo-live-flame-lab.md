# Kimodo with the Elfinblue live flame

This lab adds text-to-motion generation to SF3D's authored Elfinblue route.
The flame keeps its existing device and rendering loop. Kimodo obtains a
second device through its inference kit, runs bounded DDIM submissions, then
plays the returned 30-joint motion in the panel. This is the same-GPU,
two-device comparison; it does not exercise a shared-device foreground-submit
interlock. Text encoding remains the external Kimodo Llama/LLM2Vec service.

From this checkout:

```sh
KIMODO_WEBGPU_CHECKOUT=/absolute/kimodo-webgpu bash serve-kimodo-elfinblue.sh 8096
```

The Kimodo checkout needs installed npm dependencies and its normal converted
`public/kimodo.bin`. Start its existing `tools/embed_server.py` on port 8098
using the normal Kimodo environment and
`--allow-origin http://127.0.0.1:8096` (match the lab port if changed). Open
`http://127.0.0.1:8096/kimodo-elfinblue.html`, select **Load Kimodo**, let the
flame run briefly for a baseline, then **Generate motion**. Prompt, duration,
and step count are editable. Cancel uses the producer's AbortSignal contract.
The endpoint is editable before model loading.

The launcher builds the producer, device helper and telemetry directly from
the caller's clean source checkout. Derived bundles, source manifest and
asset links live in ignored `artifacts/kimodo-live-flame/`; model weights are
never copied into Git. Conflicting asset mounts fail rather than substitute a
different checkout. The manifest identifies the source commit and SHA-256
hashes of bundles and model assets; the page compares loaded weight identity.
The entry page inherits the full SF3D preset URL and replaces only its
composition module. Flame settings and shaders are unchanged.

The panel reports page cadence separately from actual flame render and
simulation counters. It retains all observations in
`window.__kimodoLiveFlame.samples`, with performance time origin, visibility,
stage, source identity and per-run index ranges. The evidence download includes
these samples and the original generation receipt. Motion has a separate JSON
download. `coexistence-observed` requires a validated real Kimodo receipt and
advancing WebGPU flame counters in both baseline and inference. Missing,
inactive, fallback, reset, stalled or hidden-page observations lower the
verdict. Page cadence is not GPU presentation timing.

CPU checks:

```sh
node tests/kimodo-flame-evidence-contracts.mjs
node tests/kimodo-flame-witness-failures.mjs
```

For an agent-run browser witness, use registered command completion and the
inspected Greenroom CLI. The witness claims before opening Chrome and stops
on refusal; it releases after closing its browser. It records baseline,
inference and completed PNGs, uncapped samples, the generated motion download,
and a terminal `report.json` even on preflight failure. The caller chooses the
output directory and optional URL:

```sh
GREENROOM_BIN=/absolute/gpu-greenroom node scripts/witness-kimodo-live-flame.mjs /absolute/kimodo-webgpu /absolute/evidence http://127.0.0.1:8096/kimodo-elfinblue.html
```

The witness runs 6 seconds of motion at 100 steps, with the existing
minute-scale 10-minute generation deadline. Runtime observations, public
landing disposition and measured results belong in the run's evidence
report; this document does not imply the lab branch is merged.
