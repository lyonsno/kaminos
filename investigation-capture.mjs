import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {observationSession} from './observation-session.mjs';

// read() is passive: {recording: recorder.snapshot(), context: ownerState}.
// capture() reads the existing display. Diagnostic hold/redraw is a subsequent,
// separately named observation, never a prerequisite to this capture.
export async function retainInvestigationCapture({out, source, recordingId, read, capture, note = ''}) {
  let before = null, after = null;
  return observationSession({out, source, capture, exercise: async ({retain}) => {
    try {
      await retain({name: 'display',
        observe: async () => {before = structuredClone(await read()); return before;},
        verify: async () => {
          after = structuredClone(await read());
          for (const observation of [before, after]) {
            assert.equal(observation.recording?.id, recordingId, 'Recording identity changed');
            assert.ok(typeof recordingId === 'string' && recordingId, 'Recording identity required');
            assert.deepEqual(observation.recording.source, source, 'Recording source changed');
            assert.equal(observation.recording.complete, true, 'Operation recording is incomplete');
            assert.ok(observation.context && typeof observation.context === 'object', 'Capture context required');
          }
          assert.ok(after.recording.sequence >= before.recording.sequence, 'Recording sequence regressed');
        }});
    } catch {
      // observationSession preserves and rethrows the primary retention failure
      // after writing this result, including the last successful passive reads.
    }
    const unchanged = before && after && before.recording.sequence === after.recording.sequence
      && isDeepStrictEqual(before.context, after.context);
    return {note, after, interval: !after ? 'unverified'
      : unchanged ? 'no-observed-change' : 'changed-during-capture'};
  }});
}
