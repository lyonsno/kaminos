# MoGe × Live Flame composition

Two entry points run MoGe-2 WebGPU depth inference beside the Kaminos pyro
volume, with on-device evidence of how the foreground behaves while the model
works. Both use the vendored library build `lib/moge-inference.js`
(from `moge-webgpu` `npm run build:lib`).

## Entry points

| Page | Fire | Device topology | Use |
| --- | --- | --- | --- |
| `moge-live-flame.html` | fixed scene controls (`FLAME_CONTROLS`, tall_plume, raymarch-only) | **one `GPUDevice`** shared by the volume prototype (`createKaminosVolumePrototype({ sharedGpuContext })`) and MoGe | the shared-device product route; kit-style foreground telemetry |
| `moge-elfinblue.html` → app route + `#composition_module_url=./moge-live-flame-inject.mjs` | the real app route, driven by a mounted basin promotion package | same GPU, **two devices** (the app does not expose its device) | run MoGe against an exact basin/preset with the app's own control pipeline |

Shared code (`moge-live-flame-shared.mjs`): frame monitor, MoGe load + warm-up,
cooperative run, depth paint (row-banded), and on-device chunk telemetry.
The vendored bundle is built from moge-webgpu `e9fc64b` (SHA256
`f76f6c47f447661f83227929ba23de21d07aeafa00a7b607302bebda9c55e019`).

## Composition-module seam (index.html)

`index.html` accepts an optional URL **hash** entry
`#composition_module_url=<module>`. After the volume prototype exists the app
imports the module and calls `mountComposition({ prototype, params })`. Absent
the entry it is a no-op. The module URL rides in the hash because settings
routes are contract-validated and reject unexpected query parameters.

`moge-live-flame-inject.mjs` is the first composition module: it acquires its
own device through the kit shared helper, loads MoGe, warms up, injects the HUD,
and mirrors the app's `#volume-backend` status.

## Running a basin (example: `elfinblue-fuckeryyy`)

Basin promotion packages are settings artifacts (206 basin controls + renderer
controls), not field snapshots. Mount one into a consumer settings store, bind
that store in the server, and open the package's loader route with the
composition module in the hash:

```sh
node volume-basin-promotion-package.mjs mount \
  --channel ~/.local/share/kaminos/basin-promotions/<handle>/current.json \
  --handle <handle> --revision <basinrev-…> \
  --settings-store artifacts/basin-mounts/settings-store \
  --origin http://127.0.0.1:8094 \
  --out artifacts/basin-mounts/<handle>.mount.json
./serve-elfinblue.sh 8094          # binds KAMINOS_VOLUME_SETTINGS_STORE to that store
open http://127.0.0.1:8094/moge-elfinblue.html
```

The mount receipt and the operator entry URL for `elfinblue-fuckeryyy`
(source `2c47968d`, `basinrev-3e9de5b6…`) are committed under
`artifacts/basin-mounts/`. Without the store binding the route fails loudly
with `settings preset not found`.

## HUD telemetry (measurement of record)

After each run the HUD shows worst frame gap, frame count, p50/p95 gap,
counts over 34 ms and 50 ms, chunk count, and the five worst queue waits by
chunk label. Headless-Chrome harness timings are compositor-quantized and only
relative; the operator's on-device HUD is authoritative.

Each button run, including failures, also saves an uncapped raw JSON capture
through the existing `POST /api/volume-capture` endpoint into this checkout's
`artifacts/volume-captures/`. The HUD shows the returned path only after a
matching save response. It records frame timestamps since the preceding
capture, input/inference/depth-paint phase boundaries, supported browser long
tasks, visibility changes, requested scheduler settings, and the actual route
result (whose nested scheduler receipt owns the event trace). Clock values are
`performance.now()` milliseconds with the page's `timeOrigin`. The initial
window includes labeled initialization/warm-up; later idle intervals are not
fixed-duration controlled baselines. Long-task absence does not rule out CPU
work below the browser's reporting threshold. Queue-fence spans are observed
waiting intervals, not hardware GPU execution timestamps.

`localStorage` retains only the latest **HUD summary**, not raw history. A failed
file save is explicitly **NOT SAVED** and the full capture remains in
`window.__mogeUnsavedCaptures`; keep the tab open for recovery. Closing the tab
before a run finishes can also lose that unfinished run. This is per-run
retention, not a crash-proof continuous journal. A missing committed image
fixture now records an input failure rather than substituting a synthetic card.
These timing captures are not volume-state snapshots: the generic endpoint's
returned volume-witness command is not a MoGe replay instruction. Their route
and browser metadata do not certify an immutable checkout; record the exercised
source separately, as the existing owned-server probe does.

## Witnesses

Greenroom job types (registered per worktree): `moge-elfinblue-smoke`
(fire-colour witness via screenshot sampling, cooperative run, verified
receipt, depth), `moge-elfinblue-hitch-probe` (rAF gaps aligned with
submit→retire occupancy spans), `moge-live-flame-smoke` (standalone page).

## Custody notes

Fire pipeline, presets and `index.html` belong to their owning lanes; the seam
is optional and additive. The one-device composition remains the standalone
page until the app exposes its device (or a `sharedGpuContext` seam).
