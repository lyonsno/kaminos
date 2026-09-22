import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

for (const id of [
  'basin-drive-session-label',
  'basin-drive-record',
  'basin-drive-mark-label',
  'basin-drive-mark',
  'basin-drive-stop',
  'basin-drive-replay',
  'basin-drive-state',
]) {
  assert.match(index, new RegExp(`id=["']${id}["']`), `cockpit exposes ${id}`);
}
assert.doesNotMatch(
  index,
  /id=["']volume-basin-drive-(?:record|mark|stop|replay)/,
  'recorder commands stay outside the canonical volume control id namespace',
);
assert.match(index, /createVolumeBasinDriveSessionRecorder/);
assert.match(index, /replayVolumeBasinDriveSession/);
assert.match(index, /from ['"]\.\/volume-basin-drive-session\.mjs['"]/);
assert.match(index, /function captureVolumeBasinDriveControlState\(/);
assert.match(index, /function startVolumeBasinDriveSession\(/);
assert.match(index, /function markVolumeBasinDriveSession\(/);
assert.match(index, /async function stopVolumeBasinDriveSession\(/);
assert.match(index, /async function replayLastVolumeBasinDriveSession\(/);
assert.match(index, /addEventListener\(['"](?:input|change|click)['"],[^;]+capture:\s*true/s);
assert.match(index, /\/api\/volume-basin-drive-sessions/);
assert.match(index, /\/api\/volume-basin-drive-session\?id=/);
assert.match(index, /window\.__kaminosStartVolumeBasinDriveSession\s*=/);
assert.match(index, /window\.__kaminosStopVolumeBasinDriveSession\s*=/);
assert.match(index, /window\.__kaminosReplayLastVolumeBasinDriveSession\s*=/);
assert.match(index, /effective\?\.artifactPath/);
assert.match(index, /effective\?\.eventCount/);
assert.match(index, /volumeCockpitLayoutReady/);

// Execute the actual cockpit replay entry with an incompatible API artifact.
// It must refuse before invoking replay or changing any controls.
const replayEntry = index.slice(index.indexOf('async function replayLastVolumeBasinDriveSession()'),
  index.indexOf("document.addEventListener('input', observeVolumeBasinDriveCockpitEvent"));
for (const compatibility of [undefined, {
  identity: 'kaminos.volume.basin-drive-replay-compatibility.v0',
  compatible: false, reasons: ['source-commit-mismatch'],
}]) {
  let replayInvoked = false;
  const context = vm.createContext({
    lastVolumeBasinDriveArtifactId: 'recorded-drive', lastVolumeBasinDriveArtifactPath: '/recorded-drive.json',
    activeVolumeBasinDriveRecorder: null, pendingVolumeBasinDriveSession: null,
    volumeBasinDriveStarting: false, volumeBasinDriveSaving: false, volumeBasinDriveReplaying: false,
    volumePrototype: {debugState: () => ({active: true, backend: 'WebGPU:apple'})},
    syncVolumeBasinDriveCommands() {}, volumeBasinDriveStatus() {},
    fetch: async () => ({ok: true, json: async () => ({
      identity: 'kaminos.volume.basin-drive-session-artifact.v0',
      artifactId: 'recorded-drive', artifactPath: '/recorded-drive.json', session: {},
      replayCompatibility: compatibility,
    })}),
    parseVolumeBasinDriveSession: () => ({}),
    replayVolumeBasinDriveSession: async () => {replayInvoked = true; return {};},
    applyVolumeBasinDriveControlEvent() {}, captureVolumeBasinDriveControlState() {},
  });
  vm.runInContext(replayEntry, context);
  await assert.rejects(context.replayLastVolumeBasinDriveSession(), /replay incompatible/);
  assert.equal(replayInvoked, false);
  assert.equal(context.volumeBasinDriveReplaying, false);
}

console.log('volume basin drive cockpit contracts passed');
