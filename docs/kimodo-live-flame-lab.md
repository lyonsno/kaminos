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
node tests/kimodo-motion-frame.mjs
node tests/kimodo-witness-terminal.mjs
node tests/kimodo-witness-watchdog.mjs
node tests/kimodo-frame-admission.mjs
node --experimental-vm-modules tests/kimodo-witness-cleanup.mjs
node tests/kimodo-flame-witness-failures.mjs /absolute/kimodo-webgpu
```

For an agent-run browser witness, use registered command completion and the
inspected Greenroom CLI. The witness claims before opening Chrome and stops
on refusal; it releases after closing its browser. It records baseline,
inference and completed PNGs, uncapped samples, the generated motion download,
and a terminal `report.json` even on preflight failure. The caller chooses the
output directory and optional URL:

```sh
GREENROOM_BIN=/absolute/gpu-greenroom node scripts/witness-kimodo-live-flame.mjs /absolute/kimodo-webgpu /absolute/evidence http://127.0.0.1:8096/kimodo-elfinblue.html <expected-host-40hex-commit> <expected-producer-40hex-commit>
```

The witness runs 6 seconds of motion at 100 steps, with the operator's
10-minute overall browser-work deadline and 120-second producer/load/download
no-progress detector. A stalled page is aborted/closed, its last trustworthy
telemetry is retained, and its renewable lease is released. These witness-only
timers do not limit the interactive product UI. Runtime observations, public
landing disposition and measured results belong in the run's evidence
report; this document does not imply the lab branch is merged.
## Evidence admission

The browser witness requires explicit caller-owned expected host/producer
commits, a clean committed host checkout and a build at those exact revisions.
The pins are not inferred from the build being tested. Its effective source proof hashes actual browser response
bytes against that Git tree and the build manifest, including loaded bundles
and all three support assets. Temporary redirect selectors carry navigation
identity only; the admitted final URL, preset and loaded runtime carry the
source claim. The producer's receipt-bound weights hash covers
the consumed binary. It also checks the admitted Elfinblue preset receipt.
The witness verifies a new CDP-completed motion download against both terminal
output digests, dimensions and generation identity. A useful generation may
still leave the overall witness failed.

Coexistence means both flame counters advance within each of three equal-time
portions of inference. This is temporal coverage, not a smoothness guarantee;
all samples and page cadence distributions are retained. Page cadence is not
GPU execution timing. A renewable Greenroom lease covers the browser run.

## Frame-admission comparison

The Scheduling selector has three explicit modes, fixed for each generation:
`telemetry-only` preserves the prior callback behavior; `frame-admission`
waits for Kimodo's current queue prefix to finish, then observes a fresh flame
render AND simulation counter advance before returning to inference. The
flame keeps its separate device and loop. This is cooperative admission, not
a shared-device interlock or a presentation guarantee. Hidden/unavailable or
reset flame state fails; cancellation also interrupts the waiting boundary.

`layer-chunk-admission` is the bounded follow-on experiment. It encodes the
same 16 transformer layers in the same order but submits four consecutive
4-layer duties per pass, waiting for a fresh flame render and simulation
advance after each. It does not alter weights, DDIM steps, duration, buffer
dependencies, or model math. The default producer schedule remains one
16-layer duty per pass.

The evidence JSON retains every admission event, producer encode/admit/readback
timestamp, and full kit duty report, on `performance.now()` with time origin.
CPU encoding intervals and queue-prefix completion are distinct from isolated
GPU execution timing. None of the modes changes layers, steps, duration or weights.
The default remains telemetry-only until a comparison earns a promotion.

Append `telemetry-only`, `frame-admission`, or `layer-chunk-admission` after the
witness's two commit pins to select and verify that exact mode. The witness validates complete pass/duty
identity and actual counter advances, in addition to the existing source and
motion checks. The optional mode argument is required for scheduling claims.
