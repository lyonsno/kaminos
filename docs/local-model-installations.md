# Installed models in every working copy

Register a local browser package once, then start any current Kaminos working
copy normally. The server reads the same installation record outside the repo:

```sh
python3 model_installations.py register flux3 --root /path/to/flux3-package
python3 model_installations.py status
python3 serve.py 8090
```

Registration validates the existing package and records its path. It does not
copy weights, start a model, or change another model's entry. Keep registered
packages in durable storage outside disposable worktrees. Register replacements
through the same command; concurrent registration preserves other entries.

The default record is `~/.config/kaminos/models.json`, or
`$XDG_CONFIG_HOME/kaminos/models.json` when that config root is set. `--config`
selects a registration/status file. `KAMINOS_MODEL_INSTALLATIONS` selects the
server's file. Relative package paths in a record belong to that record's
parent directory, independently of a server's working directory.

```json
{
  "schema": "kaminos.model-installations.v1",
  "models": {
    "flux3": { "root": "/path/to/flux3-package" },
    "klein": { "root": "/path/to/flux2-package" },
    "pup": { "root": "/path/to/pup-browser-package" }
  }
}
```

The supported installation names are `flux3`, `klein`, `pup`, `sam3`, and
`trellisPage`. Each uses its existing model-owned package format and serving
URL. FLUX and PUP admission checks required manifests, supported schema/layout,
and payload presence/length without reading gigabytes of weights. TRELLIS and
SAM startup checks establish the manifest; their runtimes own model admission.
This is availability metadata, not a numerical model-validation result.

## Invocation overrides

Existing model-specific environment variables remain explicit per-run overrides:

| Installation | Override | Serving route |
| --- | --- | --- |
| `flux3` | `KAMINOS_FLUX3_WEIGHTS_ROOT` | `/flux3-weights/` |
| `klein` | `KAMINOS_KLEIN_WEIGHTS_ROOT` | `/klein-weights/` |
| `pup` | `KAMINOS_PUP_WEIGHTS_ROOT` | `/pup-weights/` |
| `sam3` | `KAMINOS_SAM3_PACKET_ROOT` | `/sam3-packet/` |
| `trellisPage` | `KAMINOS_TRELLIS_CHECKPOINT_ROOT` | `/trellis-checkpoints/` |

An invalid override reports its own failure instead of choosing a different
installed package. An explicitly empty override disables that local mount.
A malformed installation record is diagnosed; it does not prevent an explicit,
valid invocation override from working. Existing FLUX.2 hosted-weight behavior
is preserved when its local mount is unavailable.

Selection is stable for a server invocation. Restart it after changing the
installation record; weight URLs do not switch packages during a running job.
Fresh `/api/runtime-config` requests recheck the selected package's availability.

## Diagnose availability

`/api/runtime-config` retains the existing `flux3`, `klein`, `pup`, `sam3`, and
`trellisPage` browser contracts. Its additive `modelAvailability` object reports
each selected root, selection source, installation file, validation scope,
status, and reason. Status distinguishes `not-installed`, `disabled`,
`invalid-configuration`, `unavailable`, and `available`. Missing manifests,
wrong component schemas, and missing/truncated payloads name their cause.
Generate and prompt-expansion refusals carry the server's diagnosis.

No feature should need to discover another lane's weight directory or add
model paths to its server launcher. Register installed packages once; use a
per-run override when the particular invocation intentionally needs one.
