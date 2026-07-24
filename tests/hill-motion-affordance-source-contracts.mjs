import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  decodeHillMotionAffordancePacket,
  sampleHillTerrainSurface,
} from '../hill-motion-affordance-source.mjs';

const root = new URL('../', import.meta.url);
const [packet, data] = await Promise.all([
  readFile(
    new URL('artifacts/motion-ready-719024/hill/motion-affordance-packet.json', root),
    'utf8',
  ).then(JSON.parse),
  readFile(
    new URL('artifacts/motion-ready-719024/hill/motion-affordance-data.json', root),
    'utf8',
  ).then(JSON.parse),
]);

const source = decodeHillMotionAffordancePacket({ packet, data });
assert.equal(source.sourceRef, packet.source.sourceRef);

for (const [label, mutate, pattern] of [
  ['packet route', value => { value.packet.route = 'fallback'; }, /route identity/],
  ['data frame', value => { value.data.sourceTruth.frameId = 'stale'; }, /source truth identity/],
  ['data backend', value => { value.data.sourceTruth.backend = 'fallback'; }, /source truth identity/],
  ['grid spacing', value => { value.data.grid.spacing.x = Number.NaN; }, /grid spacing/],
  ['world bounds', value => { value.data.worldBounds.x.max = Number.NaN; }, /world bounds/],
]) {
  const candidate = { packet: structuredClone(packet), data: structuredClone(data) };
  mutate(candidate);
  assert.throws(
    () => decodeHillMotionAffordancePacket(candidate),
    pattern,
    `${label} corruption must fail Hill decoding`,
  );
}

const corruptSource = structuredClone(source);
corruptSource.channels.height.values[0] = Number.NaN;
assert.throws(
  () => sampleHillTerrainSurface(
    corruptSource,
    corruptSource.worldBounds.x.min,
    corruptSource.worldBounds.z.min,
  ),
  /non-finite height/,
  'non-finite height samples must never be silently converted to zero',
);

process.stdout.write('Hill motion affordance source contracts passed\n');
