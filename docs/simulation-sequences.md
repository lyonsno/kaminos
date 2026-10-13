# Render a simulation sequence

`simulation-sequence.mjs` schedules frames against the producer's fixed physics
clock. `sequence-directory.mjs` writes portable PNG files, a compact JSON manifest,
a starting-conditions record and an incremental frame ledger. Neither module
owns a solver, viewport, browser or video codec. Flame can supply the same adapter
without adopting the water representation. Flame conformance is not established
by the first Fluid consumer.

A caller supplies `adapter.read/hold/advanceToStep/render/capture`, a sink, and
`{startSeconds,endSeconds,fps}`. Read returns actual `{clock,source,conditions,view}`;
clock includes `runId,step,dt,paused,backend,renderer`. Render confirms its actual
step. Capture returns PNG bytes. The run remains paused; advancing backwards
requires an explicit producer restart or restore before invoking export.

Output cadence is independent of interactive playback speed and solver dt.
Samples run from start through the last cadence point at or before end, inclusive.
When a requested sample lies between solver ticks, nearest-tick sampling retains
both requested and actual time. It never changes dt to fit the requested fps.
No frame-count limit or history pruning is introduced.

## Existing shared Fluid consumer

`tools/render-fluid-sequence.mjs --inputs /chosen/job.json --out /chosen/sequence`
opens an independent test browser on a verified caller-selected server, exports
its actual shared canvas, and closes only that owned browser. Its input is:

```json
{
  "url": "http://127.0.0.1:20316/index.html?workspace=workbench&experiment=lazarus%2Ffinite-pbf",
  "repo": "/absolute/served/worktree",
  "browser": "/absolute/independent/Chrome-for-Testing-executable",
  "playwright": "/absolute/playwright-core/index.mjs",
  "viewport": {"width":1600,"height":1000},
  "sequence": {"startSeconds":0,"endSeconds":1,"fps":30}
}
```

Viewport specifies the app window, not the export image extent. Each PNG contains
the shared renderer canvas bitmap without DOM overlays; its effective dimensions are retained.
A separate host-owned output-size/capture seam is needed for arbitrary export
resolution without changing the inspected viewport. This command creates its
own fresh run; it never attaches to or replaces the operator's existing water.
For long/GPU-heavy exports use the shop's existing admission queue. Ordinary short
browser conformance smokes do not need serialization.

The adapter consumes existing exact advancement, which already renders, and
avoids an additional explicit render at that step. The host's ordinary scheduler
can still produce additional redraws. No claim of full render-only-on-sample or
GPU quiescence follows from this adapter. There are no per-frame particle
readbacks; only compact settings, route, camera and clock reads surround each
capture. Source hashes and effective backend/renderer are retained.

## Durability and efficiency

Frames are written in order, awaiting each capture and write before advancing.
The exporter retains one encoded image at a time; the directory writer also
holds that frame's decoded pixels for validation. Memory does not grow with
sequence duration. Runtime/source/settings/view drift rejects the run. Unchanged
images at different times are legal (stationary scenes are real output).

`sequence.json` always starts incomplete. The frame ledger records each image's
requested/actual time, step, byte count, checksum and verification status. Initial
source/config/view are stored once. Failure or cancellation keeps completed
frames and the last trustworthy frame; an invalid acquired image is retained as
unverified. A killed process leaves an incomplete manifest instead of successful
output. This is process-level file retention, not a claim of fsync durability
against power loss or resumable GPU state after restart.

`readSequence(out)` checks file identity, checksums and ledger counts. Existing
export manifests are reserved exclusively, so rerunning cannot overwrite an old
sequence. The caller selects a new destination. All frames remain retained;
video encoding or contact sheets can consume them separately. A video encoding
failure does not invalidate or delete the original sequence.

Current implementation is the reusable export core and scripted Fluid consumer.
The bottom transport UI, browser folder writer, job-progress controls, rewind,
checkpoint restoration and flame adapter are subsequent owner compositions.
