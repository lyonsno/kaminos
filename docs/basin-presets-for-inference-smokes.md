# Load an exported fire basin for a cooperative inference smoke

Use the authored preset as the foreground workload. A generic `?kaminos_volume_smoke=1` route starts a default fire, not the exported look. The inference kit does not load basin files itself: the application loads the basin, then integrates that renderer with the model runtime.

Run the commands below from the **Kaminos worktree being served**. Choose a free port and caller-owned settings/output paths. Record that worktree's commit and the model port/kit version in the smoke result. An HTTP server is not a GPU workload; opening an active fire page is.

## 1. Identify the export you received

| Export | Load path |
| --- | --- |
| JSON with `identity: kaminos-volume-settings-preset-artifact-v2` and a `vsp-…` ID | Install the unchanged artifact into a consumer settings store, then use the preset loader below. |
| Directory with `current.json` and `revisions/basinrev-…/package.json` | Use the existing promotion `mount` command. It validates and installs the embedded preset and writes consumer URLs. |
| Only a screenshot, control fragment, drive-session recording, or simulation-field dump | This is not either of the above exports. Obtain the settings artifact or use the separate replay/import route appropriate to that object. |

A settings preset restores controls, renderer choices, and explicit presentation settings. It does **not** restore evolved fluid fields, camera pose, or an identical simulation instant. Preserve camera, viewport, warmup, and any live control history separately when they matter to a comparison.

## 2A. Plain settings-preset JSON

Set these paths to the received artifact and your own consumer store:

```sh
BASIN_PRESET=/absolute/path/to/exported-preset.json
BASIN_STORE=/absolute/path/to/consumer-settings
BASIN_PORT=8095

node --input-type=module - "$BASIN_PRESET" "$BASIN_STORE" <<'JS'
import { readFileSync, mkdirSync, existsSync, copyFileSync, constants } from 'node:fs';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { validateVolumeSettingsPresetDocument } from './volume-settings-preset-contract.mjs';
const [source, store] = process.argv.slice(2);
const artifact = JSON.parse(readFileSync(source, 'utf8'));
const schema = JSON.parse(readFileSync('volume-settings-preset-schema-v2.json', 'utf8'));
validateVolumeSettingsPresetDocument(artifact, artifact.presetId, schema);
const directory = join(resolve(store), 'presets');
mkdirSync(directory, { recursive: true });
const target = join(directory, `${artifact.presetId}.json`);
if (existsSync(target)) {
  assert.deepEqual(JSON.parse(readFileSync(target, 'utf8')), artifact,
    'consumer store already contains different content for this preset ID');
} else {
  copyFileSync(source, target, constants.COPYFILE_EXCL);
}
console.log(JSON.stringify({ presetId: artifact.presetId, installedPath: target }));
JS

python3 serve.py "$BASIN_PORT" --volume-settings-store "$BASIN_STORE"
```

Keep the server in a persistent terminal or an owned service. From another terminal, verify the installed artifact through the server (which also checks its content hash), then open the loader using the printed immutable ID:

```sh
curl --fail --show-error --silent \
  'http://127.0.0.1:8095/api/volume-settings-preset?id=vsp-REPLACE_WITH_EXPORTED_ID'
```

```text
http://127.0.0.1:8095/volume-settings-preset.html?preset=vsp-REPLACE_WITH_EXPORTED_ID
```

Substitute your selected port in both URLs. Use the complete `vsp-…` ID, not the display label. This minimal installation does not create a mutable alias, so the dropdown index may omit it; the immutable-ID loader still works. Do not POST an already exported artifact as if it were a newly authored preset, strip fields, or overwrite the operator's original store. If an older export fails local validation, use its matching source/schema or the existing schema-migration path; do not patch its content ID to force admission.

## 2B. Exported promotion directory

Keep `current.json` and its referenced revision directory together. Read the handle and exact revision from the received channel, then pin them explicitly:

```sh
node volume-basin-promotion-package.mjs mount \
  --channel /absolute/path/to/promotion/HANDLE/current.json \
  --handle HANDLE \
  --revision basinrev-EXACT_REVISION_HASH \
  --settings-store /absolute/path/to/consumer-settings \
  --origin http://127.0.0.1:8095 \
  --out /absolute/path/to/smoke-output/basin-mount.json

python3 serve.py 8095 \
  --volume-settings-store /absolute/path/to/consumer-settings
```

Use `loader.targetUrl` from the **written mount JSON** for the ordinary cockpit. The CLI's stdout wraps it under `mount.loader.targetUrl`. This target already contains the validated controls and preset identity. Do not replace it with a generic fire URL. The consumer server must use the same settings store passed to `mount`. Mount validates package provenance; it does not switch your running checkout to the package's source commit. Verify the effective server source separately.

The [promotion reference](../artifacts/basin-promotions/README.md) covers author-side export and revision replacement. Its committed historical example is not automatically the latest accepted emissive basin.

## 3. Check what actually loaded

First inspect `/api/runtime-config` for the effective server checkout and commit. In the loaded cockpit, these existing browser surfaces provide the preset admission and live renderer state:

```js
const preset = window.__kaminosVolumeSettingsPresetReceipt;
const fire = window.__kaminosVolumePrototype?.debugState();
console.log({ preset, fire });
```

Require the expected preset ID, a live active renderer, no initialization error, and the intended backend/composition. Compare `fire.controls` with the requested semantic settings, not just the URL or dropdown label. DOM control descriptors such as `volume-physical-mode` are not the camel-case values accepted by `volumePrototype.setControls()`; passing `artifact.preset.domControls` directly to the core is not a valid import.

For the operator-accepted **ring burner new emission yellow blue** export, the immutable ID is `vsp-15a78ecf2663c80ec416e9931ef182fca82eb2edde9d052bc64d798179c0295b`. Its distinguishing settings are baked structure, physical mode **2**, explicit material law **1**, grid **128**, **160** ray steps, flow **0.85**, and render scale **0.3**. These are cross-checks, not a replacement for loading the full artifact. Material law0 intentionally preserves older emission behavior; “emissive mode” alone does not identify this look. Obtain the actual export from its owner; this guide does not install it implicitly.

“Loading presets…” remaining on screen is not a successful load. Inspect module startup errors and the preset API. A loaded page, populated controls, or HTTP200 alone is not a rendering check. After ordinary settling, inspect the actual live fire once; use the existing witness if the task needs retained images. Do not silently lower grid, scale, steps, change baked to live, or select a legacy model to make a scheduling result look better. Explicit workload variants are fine when recorded as variants.

## 4. Compose with cooperative model execution

Preset loading and scheduling are separate responsibilities:

- **Same device:** the fire and inference must receive the same `GPUDevice` object for a same-device claim. Two tabs, two `requestDevice()` calls, or matching adapter names do not establish that. `createKaminosVolumePrototype` accepts `sharedGpuContext: { device, queue: device.queue, adapter }` for its prototype-owned renderer. A custom host must supply the complete normalized controls through `getControls`; use the cockpit's route application/readback as the reference, not a hand-picked subset of old defaults.
- **Frame ownership:** sharing a device does not make the prototype's private animation loop a kit foreground opportunity. The model host must wire the actual renderer's frame work into the runtime's foreground interface, or explicitly measure independent same-device rendering. Name which route was exercised.
- **Do not substitute a different renderer:** `productFrameOwner: 'caller'`, `initializeProductFrame()` and `encodeProductFrame()` implement the separately named **smoke-raymarch-under-splats** product path. That API is not an interchangeable way to display the ordinary emissive raymarch basin. Matching controls do not establish matching appearance across those paths.
- **Model duties:** use the kit's cooperative execution boundaries and [foreground-opportunity integration](../webgpu-inference-kit/docs/integration-reference.md#put-real-foreground-work-between-inference-duties). Runtime-owned boundaries service pending foreground work before the next inference encode. A browser yield by itself does not prove that fire was submitted or presented.

The loader and mount commands do not create a model route, load weights, or install this scheduler wiring. Reuse the model port's existing host/adapter and record any missing connection as incomplete integration, not as a preset-loading success.

For a useful cooperative smoke, retain: basin ID/revision and source commits; requested/effective fire controls and renderer route; model route, backend and kit version; actual same-device binding; scheduler mode and boundary/foreground receipts; complete model output/terminal status; and foreground frame intervals covering the inference interval. A fire-only visual check establishes appearance, not inference completion or scheduling performance. A full model output with a frozen or substituted fire does not establish the intended cooperative smoke.

## GPU access versus in-page scheduling

In this shop, consult the [GPU Greenroom README](https://github.com/lyonsno/gpu-greenroom#cooperative-external-leases-and-bumps) before agent-run GPU smokes. Its external lease/bump protocol coordinates machine access with other agents. The inference kit's cooperative scheduler coordinates fire and model duties **inside the admitted workload**. Neither replaces the other. An operator-authorized visual check is not automatically an isolated timing benchmark; HTTP-only import/mount checks need no rendering run.
