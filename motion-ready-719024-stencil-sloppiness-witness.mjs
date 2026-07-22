#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  deriveOracleStencilBinding,
  hashOracleStencil,
  perturbOracleStencilRegion,
  validateOracleStencilDocument,
} from './motion-ready-719024-stencil.js';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const sourceReportPath = resolve(args.get('--source-report') || '/tmp/kaminos-719024-oracle-stencil-smoke/report.json');
const reportPath = resolve(args.get('--report') || '/tmp/kaminos-719024-oracle-stencil-sloppiness.json');
const creaturePath = resolve(args.get('--creature') || './artifacts/motion-ready-719024/creature.glb');
const identity = Object.freeze({
  castId: 'motion-ready-719024',
  castHash: '8fed20d958ef48797c14ad1d3846a50eae05d43e6ae67f8805060b02f1abde8e',
  registrationHash: 'cb519913ad863441e88555b3d9fbd588ffef03650475de07c29ee1c71f500ff6',
});

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

function jaccard(left, right) {
  const a = new Set(left);
  const b = new Set(right);
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection++;
  const union = a.size + b.size - intersection;
  return union ? intersection / union : 1;
}

function weightedJaccard(left, right) {
  const a = new Map(left.vertexIndices.map((vertex, index) => [vertex, left.weights[index]]));
  const b = new Map(right.vertexIndices.map((vertex, index) => [vertex, right.weights[index]]));
  const vertices = new Set([...a.keys(), ...b.keys()]);
  let minimum = 0;
  let maximum = 0;
  for (const vertex of vertices) {
    const leftWeight = a.get(vertex) || 0;
    const rightWeight = b.get(vertex) || 0;
    minimum += Math.min(leftWeight, rightWeight);
    maximum += Math.max(leftWeight, rightWeight);
  }
  return maximum ? minimum / maximum : 1;
}

const sourceReport = JSON.parse(readFileSync(sourceReportPath, 'utf8'));
if (!sourceReport.ok) throw new Error('sloppiness witness requires a successful live authoring report');
if (!sourceReport.syntheticAuthoring) throw new Error('sloppiness witness source must declare whether authoring was synthetic');
const stencil = validateOracleStencilDocument(sourceReport.stencilDocument, identity);
assert.equal(await hashOracleStencil(stencil), sourceReport.stencilHash, 'source report stencil identity drifted');
const positions = readGlbPositionAccessor(readFileSync(creaturePath));
const baseline = await deriveOracleStencilBinding(stencil, positions, identity);
const perturbations = Object.freeze([
  { id: 'translate-right-0.02', translate: [0.02, 0, 0], radiusScale: 1 },
  { id: 'translate-up-0.02', translate: [0, 0.02, 0], radiusScale: 1 },
  { id: 'translate-forward-0.02', translate: [0, 0, -0.02], radiusScale: 1 },
  { id: 'radius-0.8', translate: [0, 0, 0], radiusScale: 0.8 },
  { id: 'radius-1.2', translate: [0, 0, 0], radiusScale: 1.2 },
]);
const results = [];
for (const region of stencil.regions) {
  const baselineRegion = baseline.regions.find(candidate => candidate.id === region.id);
  for (const perturbation of perturbations) {
    const perturbedStencil = perturbOracleStencilRegion(stencil, region.id, perturbation);
    const perturbedBinding = await deriveOracleStencilBinding(perturbedStencil, positions, identity);
    const perturbedRegion = perturbedBinding.regions.find(candidate => candidate.id === region.id);
    assert.notEqual(perturbedBinding.stencilHash, baseline.stencilHash);
    for (const neighbor of stencil.regions.filter(candidate => candidate.id !== region.id)) {
      assert.deepEqual(
        perturbedStencil.regions.find(candidate => candidate.id === neighbor.id),
        neighbor,
        `${region.id} perturbation rewrote neighboring semantic region ${neighbor.id}`,
      );
    }
    results.push({
      regionId: region.id,
      regionKind: region.kind,
      perturbation: perturbation.id,
      baselineVertexCount: baselineRegion.vertexIndices.length,
      perturbedVertexCount: perturbedRegion.vertexIndices.length,
      vertexCountDelta: perturbedRegion.vertexIndices.length - baselineRegion.vertexIndices.length,
      bindingJaccard: jaccard(baselineRegion.vertexIndices, perturbedRegion.vertexIndices),
      weightedBindingJaccard: weightedJaccard(baselineRegion, perturbedRegion),
      perturbedStencilHash: perturbedBinding.stencilHash,
    });
  }
}
const regionSummaries = stencil.regions.map(region => {
  const entries = results.filter(result => result.regionId === region.id);
  return {
    regionId: region.id,
    regionKind: region.kind,
    baselineVertexCount: entries[0].baselineVertexCount,
    minimumBindingJaccard: Math.min(...entries.map(entry => entry.bindingJaccard)),
    minimumWeightedBindingJaccard: Math.min(...entries.map(entry => entry.weightedBindingJaccard)),
    maximumAbsoluteVertexDelta: Math.max(...entries.map(entry => Math.abs(entry.vertexCountDelta))),
  };
});
const report = {
  schema: 'kaminos.motion-ready-719024.oracle-stencil-sloppiness-witness.v0',
  ok: true,
  sourceReportPath,
  sourceStencilHash: baseline.stencilHash,
  syntheticAuthoring: sourceReport.syntheticAuthoring,
  semanticQualityClaim: 'not-claimed',
  perturbationUnits: 'asset-local',
  perturbations,
  regionSummaries,
  results,
};
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ok: true, reportPath, regionSummaries }));
