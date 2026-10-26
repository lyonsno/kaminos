# Iron Gland Gesture Capture

The `iron-gland` Workbench experiment records personal hand movements for later
temporal-controller work. It does not train a model or interpret the prompted
curl as a working control gesture. The reconstructed hand remains the visible
feedback; camera pixels are retained privately as inference input, not displayed
as a scene background.

Start the camera, then **Record take**. **Neutral** is the default: a one-minute
sequence to find a comfortable no-turn shape, carry it through small whole-hand
movements, and lower/reacquire it twice. It collects neutral demonstrations;
there is no trained neutral detector or neutral-confidence feedback yet.

Select **Turns** to retain the longer sequence. Its instructions cover comfortable exploration,
cupped neutral, whole-hand movement with fingers held neutral, slight opposite
turns, sustained holds, returns, lowering/re-entry, partial reversals and an
unpaced final block. The two main blocks use different movement and hold durations.
Pause suspends the instruction clock, not recording. Repeat restarts the current
instruction while keeping the earlier observations and a repeat event. Finish
saves a partial take unless the complete instruction sequence has elapsed.

Countdowns and paced counts are collection cues, never continuous angle or
velocity targets. Free exploration remains unlabeled. Cue entry/repeat/pause
events use the browser monotonic clock, independently of inference completion.
Suspending the page cannot advance through unseen instructions. Moving the page
out of view pauses instructions; the source recording continues until Finish or
camera Stop. Actual source and inference cadence must be evaluated from timestamps.

## Retained Data

The local Python app host writes under
`~/.local/state/kaminos/iron-gland-captures/<uuid>/`. Set
`KAMINOS_IRON_GLAND_CAPTURE_ROOT` on that host to choose another root. Revision
trees are not the data destination. There is no automatic cleanup or retention
expiry. Camera recordings can include the room and other people in view; they
remain local. Recording begins only on an explicit action.

- `manifest.json`: effective model identity, source, runtime revision, camera
  settings, protocol, clock origin, video MIME type and terminal status.
- `topology.u16`: MobRecon triangle indices, Uint16 little-endian.
- `frames/00000000.png`: exact unmirrored full input canvas for each inference.
- `frames/00000000.json`: source-video timestamps, input dimensions, instruction
  at acquisition, capture/completion times, crop/detector result and binary layout.
- `frames/00000000.f32`: concatenated Float32 little-endian native mesh/UV,
  reflected meter-space mesh/crop UV and `decoder3d.sampled` (21 x 256).
  Each layout entry gives its name, shape, element offset and element count.
  Detector misses retain PNG/JSON but have no feature buffer.
- `events/00000000.json`: actual instruction transitions and capture lifecycle.
- `video/00000000.webm` (or `.mp4`): ordered MediaRecorder chunks. Concatenate
  them in numeric order to reconstruct the camera recording; later chunks are
  not independently decodable clips. No audio is requested.

Every successful file write returns its byte length and SHA-256. Writes are
atomic; retrying identical bytes is idempotent, replacing different bytes is
rejected. Completion checks the on-disk inventory and float layout. Errors never
delete previous data. An abruptly closed browser can leave `status: recording`;
that means unfinalized, not completed. A failed or partial take remains available
for diagnosis. A complete take says the collection sequence and persistence
finished, not that movements matched instructions or a controller will learn them.

## Operations

The Workbench operations used by both UI and automation are `beginCapture({label,mode})`,
`finishCapture()`, `pauseCapture()` and `repeatCapture()`. Existing `stop()` drains
in-flight inference and finalizes a partial capture. Changing handedness/model
settings during a take is rejected. `read().capture` reports the destination,
cue, state, saved/observed counts and pending writes.
`mode` is `neutral` (default) or `turns`; unknown values fail before capture
persistence starts. The manifest preserves `settings.captureMode` and the exact
instruction sequence. The mode is locked in the UI during a take. Existing
captures without this field retain their original recorded protocol. The end of
either instruction sequence does not stop recording; Finish remains explicit.

`POST /api/iron-gland-capture?action=start` accepts JSON capture metadata.
`action=write&id=<uuid>&name=<file>` accepts raw bytes at the specified relative
capture path. `action=finish&id=<uuid>` accepts terminal JSON. GET without an id
returns the configured root; GET with an id returns its manifest. This is a local
app-host route, not a public upload service or arbitrary filesystem writer.

For replay, use the saved PNG, recorded crop/detector settings and exact model
identity. Feature alternatives can be extracted from retained pixels or video;
the first feature choice does not destroy the underlying observations. Hold out
whole repetitions/reacquisitions for later validation, not neighboring random
frames. Training and control-quality validation are separate work.
