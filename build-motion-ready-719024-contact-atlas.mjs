#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  MOTION_READY_719024_CAST_ID,
  deriveCrawlerContactAtlas,
  validateAxialCrawlerRegistration,
} from './motion-ready-719024-core.js';

const root = new URL('./', import.meta.url);
const artifactDirectory = new URL('artifacts/motion-ready-719024/', root);

function readGlbPositionAccessor(bytes) {
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').replace(/\0+$/, ''));
  let binaryOffset = 20 + jsonLength;
  while (binaryOffset % 4) binaryOffset++;
  const binaryLength = bytes.readUInt32LE(binaryOffset);
  const binary = bytes.subarray(binaryOffset + 8, binaryOffset + 8 + binaryLength);
  const primitive = json.meshes[0].primitives[0];
  const accessor = json.accessors[primitive.attributes.POSITION];
  const view = json.bufferViews[accessor.bufferView];
  const stride = view.byteStride || 12;
  const start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const positions = new Float32Array(accessor.count * 3);
  for (let vertex = 0; vertex < accessor.count; vertex++) {
    const source = start + vertex * stride;
    positions[vertex * 3] = binary.readFloatLE(source);
    positions[vertex * 3 + 1] = binary.readFloatLE(source + 4);
    positions[vertex * 3 + 2] = binary.readFloatLE(source + 8);
  }
  return positions;
}

const receipt = JSON.parse(await readFile(new URL('receipt.json', artifactDirectory), 'utf8'));
const registration = validateAxialCrawlerRegistration(JSON.parse(
  await readFile(new URL('registration.json', artifactDirectory), 'utf8'),
));
const positions = readGlbPositionAccessor(await readFile(new URL('creature.glb', artifactDirectory)));
const atlas = deriveCrawlerContactAtlas(positions, registration, {
  castId: MOTION_READY_719024_CAST_ID,
  castHash: receipt.files['creature.glb'].sha256,
  registrationHash: receipt.files['registration.json'].sha256,
});
const outputUrl = new URL('contact-atlas.json', artifactDirectory);
await writeFile(outputUrl, `${JSON.stringify(atlas, null, 2)}\n`);
console.log(JSON.stringify({
  schema: atlas.schema,
  castId: atlas.castId,
  vertexCount: atlas.vertexCount,
  patches: atlas.patches.map(patch => ({
    id: patch.id,
    contactVertices: patch.vertexIndices.length,
    influenceVertices: patch.influenceVertexIndices.length,
    restCentroid: patch.restCentroid,
  })),
  output: resolve(outputUrl.pathname),
}, null, 2));
