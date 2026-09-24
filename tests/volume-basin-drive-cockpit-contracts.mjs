import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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

console.log('volume basin drive cockpit contracts passed');
