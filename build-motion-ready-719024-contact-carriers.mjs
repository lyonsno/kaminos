#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  deriveCrawlerContactCarriers,
  validateCrawlerContactAtlas,
} from './motion-ready-719024-core.js';

const root = new URL('./', import.meta.url);
const artifactDirectory = new URL('artifacts/motion-ready-719024/', root);

function readAccessor(json, binary, accessorIndex) {
  const accessor = json.accessors[accessorIndex];
  const view = json.bufferViews[accessor.bufferView];
  const componentBytes = accessor.componentType === 5125 ? 4 : accessor.componentType === 5123 ? 2 : 4;
  const components = accessor.type === 'VEC3' ? 3 : 1;
  const stride = view.byteStride || componentBytes * components;
  const start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const values = new (accessor.componentType === 5125 ? Uint32Array : accessor.componentType === 5123 ? Uint16Array : Float32Array)(accessor.count * components);
  for (let item = 0; item < accessor.count; item++) {
    for (let component = 0; component < components; component++) {
      const source = start + item * stride + component * componentBytes;
      values[item * components + component] = accessor.componentType === 5125
        ? binary.readUInt32LE(source)
        : accessor.componentType === 5123
          ? binary.readUInt16LE(source)
          : binary.readFloatLE(source);
    }
  }
  return values;
}

function readGlbMesh(bytes) {
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').replace(/\0+$/, ''));
  let binaryOffset = 20 + jsonLength;
  while (binaryOffset % 4) binaryOffset++;
  const binaryLength = bytes.readUInt32LE(binaryOffset);
  const binary = bytes.subarray(binaryOffset + 8, binaryOffset + 8 + binaryLength);
  const primitive = json.meshes[0].primitives[0];
  return {
    positions: readAccessor(json, binary, primitive.attributes.POSITION),
    triangleIndices: readAccessor(json, binary, primitive.indices),
  };
}

const receipt = JSON.parse(await readFile(new URL('receipt.json', artifactDirectory), 'utf8'));
const atlasBytes = await readFile(new URL('contact-atlas.json', artifactDirectory));
const atlasHash = createHash('sha256').update(atlasBytes).digest('hex');
const atlas = validateCrawlerContactAtlas(JSON.parse(atlasBytes.toString('utf8')));
const { positions, triangleIndices } = readGlbMesh(await readFile(new URL('creature.glb', artifactDirectory)));
const carriers = deriveCrawlerContactCarriers(positions, triangleIndices, atlas, {
  castId: atlas.castId,
  castHash: receipt.files['creature.glb'].sha256,
  registrationHash: receipt.files['registration.json'].sha256,
  atlasHash,
});
const outputUrl = new URL('contact-carriers.json', artifactDirectory);
await writeFile(outputUrl, `${JSON.stringify(carriers, null, 2)}\n`);
console.log(JSON.stringify({
  schema: carriers.schema,
  castId: carriers.castId,
  vertexCount: carriers.vertexCount,
  triangleCount: carriers.triangleCount,
  componentCount: carriers.componentCount,
  patches: carriers.patches.map(patch => ({
    id: patch.id,
    carrierComponents: patch.carrierComponentCount,
    carrierVertices: patch.carrierVertexIndices.length,
    collarComponents: patch.collarComponentCount,
    collarVertices: patch.collarVertexIndices.length,
  })),
  output: resolve(outputUrl.pathname),
}, null, 2));
