# Watching TRELLIS generation

While TRELLIS is running from Kaminos's Generate panel, choose **Watch TRELLIS in
3D** to see its occupied volume in the existing viewport. The normal camera
controls still work. **Frame voxels** restores the inspection view; **Close
history** restores the camera view from before inspection.

The first live snapshot is the completed sparse structure on a 32³ grid. The
1024 cascade also exposes the refined 64³ support that it already computes for
the next shape stage. These are occupied cells, without fine surface geometry or
material colors. They are milestones rather than a picture of every denoising
step, and producing them requires no additional neural decoder pass.

For an asset with retained snapshots, select it in **Assets** and choose
**Generation history**. Use the snapshot selector or shared replay controls to
move between stages. Older assets may have no retained history. Reference replays
are labeled explicitly; a timeline marked as playback spacing does not represent
measured generation time.

Viewing is optional. The model and final asset do not wait for the view or its
history saves. If a source retires before its copy can be admitted, the history
records that missed snapshot. If saving fails after capture, **Retry saving
history** reuses the captured coordinates; it does not restart generation.

## Storage and integration

`authoring-trellis-history.mjs` consumes model preview events through the app's
existing foreground service and presents retained GPU coordinates with
`trellis-voxel-view.mjs`. Coordinates stay on the GPU for live display. A separate,
optional readback retains the complete coordinates for later replay, outside
model completion and its pending-read bookkeeping.

`models/trellis2/voxel-history.js` defines the shared frame/history format.
Frames retain run, stage, route, sampling position, packed coordinate layout,
grid and source/export transforms. Saved frames also carry complete byte counts
and SHA-256 digests. `/api/trellis-history?runId=…` returns the manifest;
adding `frameId=…` returns its verified coordinate bytes. The POST route stores
immutable frames and terminal status. Generation origin records link assets by
their existing run identity.

The default history directory is `.trellis-history` under the server's generated
mesh root. `KAMINOS_TRELLIS_HISTORY_DIR` selects a persistent alternative. Changing
that path changes which histories the server can serve; keep it with the asset
store when moving a developer runtime.

For retained model trajectories, `models/trellis2/replay-voxel-history.mjs` accepts
`--input request.json --out chosen-directory` and writes decoder frames and a
terminal report there. This executes the production coarse decoder and belongs
in the GPU queue. `models/trellis2/import-voxel-history.mjs --input history.json
--out receipt.json --server URL --repo-root checkout` imports an existing frame
bundle through the same HTTP storage route used by live capture;
it does not perform model inference. Both preserve exact input/source identity
and write failure reports. An associated coarse GLB must carry the same completed
support digest. Intermediate noisy samples and predicted clean samples must not
be presented as interchangeable observations.
