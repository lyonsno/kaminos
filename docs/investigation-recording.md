# Record An Exploration

The shared recorder retains effective scene operations as the investigator uses
the real workbench. Capture retains the displayed PNG, complete operation prefix,
passive scene/camera/clock reads around that image, and the investigator's note.
An agent reads the same retained data through `readObservationSession()`.

## Source Integration

Import the shared channel where the ordinary operation already finishes:

```js
import {investigationOperations} from './investigation-recording.mjs';

if (investigationOperations.active) {
  investigationOperations.emit({
    kind: 'fluid.controls', phase: 'applied', target: 'fluid',
    requested: receipt.requested,
    effective: solver.getDebugState(),
    clock: window.kaminosFingerFluidBenchSessionState(),
  });
}
```

The source owns these values and the meaning of its phase. Include intermediate
inputs, cancellations/restoration and asynchronous completion at their actual
operation boundaries. Camera values include position, target, up and projection
parameters. Actor attribution is explicit when known; omitted attribution becomes
`unattributed`. Source hooks remain inactive when no recorder is subscribed.

```js
const recording = createInvestigationRecording({
  id: crypto.randomUUID(), source: effectiveSource,
  initial: actualStartingState,
  startingConditions: {kind: 'live-runtime', reconstructAfterRestart: false},
});
const prefix = recording.snapshot();
const final = recording.finish();
```

Snapshots preserve all operations and issues. `complete` describes successful
retention of events delivered to this recorder. Source integration and its
consumer exercise establish which actions reach it. In-memory recording lasts
for the page lifetime; capture/finish provides file durability.

## Capture And Read

In Node, `retainInvestigationCapture({out, source, recordingId, read, capture,
note})` uses the existing observation retention. `read` passively returns
`{recording: recording.snapshot(), context: actualContext}`. `capture` reads the
displayed image. Supply caller-selected output directories for each capture.
The first read is retained before screenshot acquisition; the second read
brackets changes during capture. Diagnostic hold/redraw belongs to a subsequent
observation. `no-observed-change` means the two supplied reads match; it is a
bounded observation about those fields. `changed-during-capture` preserves a
valid image with an interval instead of assigning it an exact simulation instant.

```js
const report = await readObservationSession('/chosen/capture/report.json');
const before = report.observations[0].effective;
const {after, note, interval} = report.result;
```

Keep the complete directory, including V8 sidecars. Failures preserve raw state,
any acquired image and their failure phase. Source drift, changed recording
identity or incomplete ingress produce a failed retention report.

## Mounted Fluid Consumer

`mountFluidInvestigation({page, out, source, guide})` attaches the shared component
through the existing `kaminosFluidWorkbenchSetInvestigation(node)` operation. Its
Try This and Why This Matters sections are independent; ordinary navigation and
Fluid controls stay available. Capture writes to the caller's output home and
Finish retains the final recording while leaving the browser's water alive.

`examples/fluid-investigation.mjs` composes this consumer with
`tools/fluid-session-run.mjs`. Pass `--visible` on initial launch and input JSON
with `repo` and a fresh `out` directory; `guide` can override the worked question.
The Node process remains attached while capture/finish buttons use its file
writer. A terminal supervisor can own that process. The visible browser's native
viewport is preserved on subsequent agent attachment.

Current composition boundary: Fluid/navigation source wiring belongs to the
workspace owner; scene-edit operation values and full camera restoration belong
to the editor owner. Exercise the actual input callbacks when integrating. This
slice supplies recording and handback; replay consumes owner-supported operations
and starting conditions in a subsequent join. A live water observation carries
live-runtime starting conditions. Reconstructed water after restart needs an
implemented checkpoint or reproducible setup/prelude. An assay can use a retained
exploration; promotion to a regression test adds its expected behavior.
