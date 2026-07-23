import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fitted = await import('../lirm-reference-fitted-armature-core.mjs');

for (const name of [
  'createPreservedProxyArmatureProgram',
  'createFittedProxyRigRegistration',
  'createFittedProxyRigBinding',
  'createFittedProxyRigPose',
  'deformFittedProxyRigBinding',
  'createSmoothFittedProxyRigCurve',
  'createSmoothFittedProxyRigBinding',
  'createSmoothFittedProxyRigPose',
  'deformSmoothFittedProxyRigBinding',
  'createFittedProxyRigMechanismWitness',
  'runFittedProxyRigProof',
  'recordFittedProxyRigProofVisualInspection',
]) {
  assert.equal(typeof fitted[name], 'function', `expected fitted proxy-rig export ${name}`);
}

const durablePacketPath = new URL('../artifacts/lirm-speciation-armature-witness-v0/control-packets/lirm-armature-03/packet.json', import.meta.url);
const durablePacketBytes = readFileSync(durablePacketPath);
const packet = JSON.parse(durablePacketBytes.toString('utf8'));
const sourcePacketSha256 = `sha256:${createHash('sha256').update(durablePacketBytes).digest('hex')}`;
assert.throws(
  () => fitted.createPreservedProxyArmatureProgram(packet),
  /exact source packet byte hash/,
  'the exported helper must not synthesize provenance from parsed JSON',
);
const program = fitted.createPreservedProxyArmatureProgram(packet, { sourcePacketSha256 });
const initialParameters = Object.fromEntries(program.parameterSpecs.map(spec => [spec.id, spec.initial]));
const primitives = program.createPrimitives(initialParameters);

assert.equal(program.id, 'kaminos.lirm-preserved-proxy-armature.lirm-armature-03.v0');
assert.equal(program.sourceCandidateId, 'lirm-armature-03');
assert.equal(program.sourcePrimitiveCount, 30);
assert.equal(program.sourcePacketSha256, sourcePacketSha256);
assert.equal(primitives.length, packet.proxyPrimitives.length, 'source primitive topology must be frozen');
assert.deepEqual(
  primitives.map(primitive => primitive.sourcePrimitiveId),
  packet.proxyPrimitives.map((_primitive, index) => `lirm-armature-03:proxy-${index}`),
);
assert.equal(primitives.filter(primitive => primitive.role === 'bodyMass').length, 13);
assert.ok(primitives.every(primitive => ['ellipsoid', 'capsule'].includes(primitive.kind)));

const priorReportPath = fileURLToPath(new URL(
  '../artifacts/lirm-reference-fitted-armature-assay-v0/report.json',
  import.meta.url,
));
const priorReport = JSON.parse(readFileSync(priorReportPath, 'utf8'));
const donorSha256 = 'sha256:8fed20d958ef48797c14ad1d3846a50eae05d43e6ae67f8805060b02f1abde8e';
const fitReport = structuredClone(priorReport);
fitReport.status = 'assay-passed-inspected';
fitReport.requestedArmatureProgramId = program.id;
fitReport.effectiveArmatureProgramId = program.id;
fitReport.armatureProgram = {
  id: program.id,
  parameterVocabulary: program.parameterVocabulary,
  parameterSpecs: program.parameterSpecs,
};
fitReport.plan = {
  ...fitReport.plan,
  requestedArmatureProgramId: program.id,
  armatureProgram: fitReport.armatureProgram,
};
fitReport.parameterSpecs = program.parameterSpecs;
fitReport.initialParameters = initialParameters;
fitReport.fittedParameters = initialParameters;
fitReport.donor.sha256 = donorSha256;

const registration = fitted.createFittedProxyRigRegistration({
  fitReport,
  armatureProgram: program,
  expectedDonorSha256: donorSha256,
  requireEvidenceFiles: false,
});
assert.equal(registration.schema, 'kaminos.lirm-fitted-proxy-rig-registration.v0');
assert.equal(registration.fitMode, 'semantic-sdf-held-out-multiview-v0');
assert.equal(registration.sourceCandidateId, 'lirm-armature-03');
assert.equal(registration.sourcePrimitiveCount, 30);
assert.equal(registration.sourcePacketSha256, sourcePacketSha256);
assert.equal(registration.stationCount, 13);
assert.equal(registration.manualControlCount, 0);
assert.equal(registration.headDirection, '-Z');
assert.ok(registration.stations.every((station, index) => station.sourcePrimitiveId === `lirm-armature-03:proxy-${index}`));

assert.throws(
  () => fitted.createFittedProxyRigRegistration({
    fitReport: { ...fitReport, status: 'assay-passed-uninspected' },
    armatureProgram: program,
    expectedDonorSha256: donorSha256,
    requireEvidenceFiles: false,
  }),
  /visually inspected and accepted/,
);
assert.throws(
  () => fitted.createFittedProxyRigRegistration({
    fitReport,
    armatureProgram: program,
    expectedDonorSha256: 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    requireEvidenceFiles: false,
  }),
  /donor hash mismatch/,
);
const driftedFitReport = structuredClone(fitReport);
for (const item of [
  ...driftedFitReport.acceptance.visualInspection.artifacts,
  driftedFitReport.outputInventory.primaryWitness,
  driftedFitReport.outputInventory.depthWitness,
]) {
  item.path = `/destroyed/worktree/${item.path.split('/').at(-1)}`;
}
const relocatedRegistration = fitted.createFittedProxyRigRegistration({
  fitReport: driftedFitReport,
  fitReportPath: priorReportPath,
  armatureProgram: program,
  expectedDonorSha256: donorSha256,
});
assert.equal(relocatedRegistration.stationCount, 13, 'stale absolute witness paths must recover from exact sibling evidence');
driftedFitReport.acceptance.visualInspection.artifacts[0].sha256 = `sha256:${'0'.repeat(64)}`;
assert.throws(
  () => fitted.createFittedProxyRigRegistration({
    fitReport: driftedFitReport,
    fitReportPath: priorReportPath,
    armatureProgram: program,
    expectedDonorSha256: donorSha256,
  }),
  /inspection artifact hash mismatch/,
);

const traversalDir = await mkdtemp(join(tmpdir(), 'kaminos-fitted-proxy-rig-traversal-'));
const traversalReportDir = join(traversalDir, 'report');
const traversalOutsideDir = join(traversalDir, 'outside');
await mkdir(traversalReportDir);
await mkdir(traversalOutsideDir);
const traversalFitReport = structuredClone(fitReport);
for (const item of [
  ...traversalFitReport.acceptance.visualInspection.artifacts,
  traversalFitReport.outputInventory.primaryWitness,
  traversalFitReport.outputInventory.depthWitness,
]) {
  const name = item.path.split('/').at(-1);
  item.path = `../outside/${name}`;
  await writeFile(join(traversalOutsideDir, name), readFileSync(join(dirname(priorReportPath), name)));
}
assert.throws(
  () => fitted.validateReferenceFitReport(traversalFitReport, {
    reportPath: join(traversalReportDir, 'report.json'),
  }),
  /missing witness artifact/,
  'relative witness paths must not be reinterpreted against the supplied report path',
);

const positions = [];
for (let index = 0; index < registration.stations.length - 1; index += 1) {
  const a = registration.stations[index].position;
  const b = registration.stations[index + 1].position;
  positions.push(
    { x: a.x, y: a.y, z: a.z },
    { x: (a.x + b.x) * 0.5 + 0.07, y: (a.y + b.y) * 0.5 + 0.04, z: (a.z + b.z) * 0.5 },
  );
}
const binding = fitted.createFittedProxyRigBinding({ positions, registration });
assert.equal(binding.schema, 'kaminos.lirm-fitted-proxy-rig-binding.v0');
assert.equal(binding.vertexCount, positions.length);
assert.equal(binding.manualControlCount, 0);
assert.equal(binding.segmentIndices.length, positions.length);
assert.equal(binding.segmentMix.length, positions.length);
assert.equal(binding.localCoordinates.length, positions.length * 3);
assert.ok([...binding.segmentMix].every(value => value >= 0 && value <= 1));

const restPose = fitted.createFittedProxyRigPose({ registration, phase: 0, amplitude: 0 });
const rest = fitted.deformFittedProxyRigBinding({ binding, pose: restPose });
let maxRestError = 0;
for (let index = 0; index < positions.length; index += 1) {
  maxRestError = Math.max(
    maxRestError,
    Math.abs(rest[index * 3] - positions[index].x),
    Math.abs(rest[index * 3 + 1] - positions[index].y),
    Math.abs(rest[index * 3 + 2] - positions[index].z),
  );
}
assert.ok(maxRestError < 1e-10, `zero pose must reconstruct exactly, got ${maxRestError}`);

const activePose = fitted.createFittedProxyRigPose({ registration, phase: 0.21, amplitude: 0.12 });
const active = fitted.deformFittedProxyRigBinding({ binding, pose: activePose });
assert.equal(active.length, positions.length * 3);
assert.ok([...active].every(Number.isFinite));
assert.ok(active.some((value, index) => Math.abs(value - rest[index]) > 0.02), 'active cage pose must move the bound cast materially');

const smoothRestCurve = fitted.createSmoothFittedProxyRigCurve({
  stationPositions: registration.stations.map(station => station.position),
  sampleCount: 192,
});
assert.equal(smoothRestCurve.schema, 'kaminos.lirm-smooth-fitted-proxy-rig-curve.v0');
assert.equal(smoothRestCurve.samples.length, 192);
assert.equal(smoothRestCurve.arcCoordinates[0], 0);
assert.equal(smoothRestCurve.arcCoordinates.at(-1), 1);
for (let index = 1; index < smoothRestCurve.frames.length; index += 1) {
  const previous = smoothRestCurve.frames[index - 1];
  const current = smoothRestCurve.frames[index];
  const lateralDot = previous.lateral.x * current.lateral.x
    + previous.lateral.y * current.lateral.y
    + previous.lateral.z * current.lateral.z;
  assert.ok(lateralDot > 0.96, `rotation-minimizing frame flipped at sample ${index}: ${lateralDot}`);
}

const smoothFixturePositions = [];
const smoothFixtureNeighborhoods = [];
for (let station = 1; station < registration.stations.length - 1; station += 1) {
  const targetArc = registration.stations[station].t;
  let nearest = 1;
  for (let index = 2; index < smoothRestCurve.arcCoordinates.length - 1; index += 1) {
    if (Math.abs(smoothRestCurve.arcCoordinates[index] - targetArc)
        < Math.abs(smoothRestCurve.arcCoordinates[nearest] - targetArc)) nearest = index;
  }
  const neighborhood = [];
  for (const index of [nearest - 3, nearest - 1, nearest + 1, nearest + 3]) {
    const sample = smoothRestCurve.samples[index];
    const frame = smoothRestCurve.frames[index];
    neighborhood.push(smoothFixturePositions.length);
    smoothFixturePositions.push({
      x: sample.x + frame.lateral.x * 0.11 + frame.normal.x * 0.06,
      y: sample.y + frame.lateral.y * 0.11 + frame.normal.y * 0.06,
      z: sample.z + frame.lateral.z * 0.11 + frame.normal.z * 0.06,
    });
  }
  smoothFixtureNeighborhoods.push(neighborhood);
}

const smoothBinding = fitted.createSmoothFittedProxyRigBinding({
  positions: smoothFixturePositions,
  registration,
  sampleCount: 192,
});
assert.equal(smoothBinding.schema, 'kaminos.lirm-smooth-fitted-proxy-rig-binding.v0');
assert.equal(smoothBinding.vertexCount, smoothFixturePositions.length);
assert.equal(smoothBinding.arcCoordinates.length, smoothFixturePositions.length);
assert.ok([...smoothBinding.arcCoordinates].every(value => value >= 0 && value <= 1));

const smoothRestPose = fitted.createSmoothFittedProxyRigPose({ registration, preset: 'rest' });
const smoothRest = fitted.deformSmoothFittedProxyRigBinding({ binding: smoothBinding, pose: smoothRestPose });
let smoothMaxRestError = 0;
for (let index = 0; index < smoothFixturePositions.length; index += 1) {
  smoothMaxRestError = Math.max(
    smoothMaxRestError,
    Math.abs(smoothRest[index * 3] - smoothFixturePositions[index].x),
    Math.abs(smoothRest[index * 3 + 1] - smoothFixturePositions[index].y),
    Math.abs(smoothRest[index * 3 + 2] - smoothFixturePositions[index].z),
  );
}
assert.ok(smoothMaxRestError < 1e-10, `smooth zero pose must reconstruct exactly, got ${smoothMaxRestError}`);

for (const preset of ['c-bend', 's-bend', 'asymmetric']) {
  const smoothPose = fitted.createSmoothFittedProxyRigPose({ registration, preset, amplitude: 0.31 });
  assert.equal(smoothPose.stationPositions.length, registration.stationCount);
  for (let index = 1; index < smoothPose.stationPositions.length; index += 1) {
    const restA = registration.stations[index - 1].position;
    const restB = registration.stations[index].position;
    const posedA = smoothPose.stationPositions[index - 1];
    const posedB = smoothPose.stationPositions[index];
    const restLength = Math.hypot(restB.x - restA.x, restB.y - restA.y, restB.z - restA.z);
    const posedLength = Math.hypot(posedB.x - posedA.x, posedB.y - posedA.y, posedB.z - posedA.z);
    assert.ok(Math.abs(posedLength - restLength) < 1e-9, `${preset} changed station-chain length at ${index}`);
  }
  const smoothActive = fitted.deformSmoothFittedProxyRigBinding({ binding: smoothBinding, pose: smoothPose });
  assert.ok([...smoothActive].every(Number.isFinite), `${preset} produced non-finite geometry`);
  for (const neighborhood of smoothFixtureNeighborhoods) {
    const edgeStrains = [];
    for (let edge = 0; edge < neighborhood.length - 1; edge += 1) {
      const left = neighborhood[edge];
      const right = neighborhood[edge + 1];
      const restDistance = Math.hypot(
        smoothRest[right * 3] - smoothRest[left * 3],
        smoothRest[right * 3 + 1] - smoothRest[left * 3 + 1],
        smoothRest[right * 3 + 2] - smoothRest[left * 3 + 2],
      );
      const posedDistance = Math.hypot(
        smoothActive[right * 3] - smoothActive[left * 3],
        smoothActive[right * 3 + 1] - smoothActive[left * 3 + 1],
        smoothActive[right * 3 + 2] - smoothActive[left * 3 + 2],
      );
      edgeStrains.push(posedDistance / restDistance);
    }
    const minStrain = Math.min(...edgeStrains);
    const maxStrain = Math.max(...edgeStrains);
    assert.ok(minStrain > 0.45 && maxStrain < 1.7, `${preset} produced unbounded local strain ${minStrain}..${maxStrain}`);
    assert.ok(maxStrain / minStrain < 1.5, `${preset} produced a strain discontinuity at a former station boundary: ${edgeStrains}`);
  }
}

const packedTriangles = packed => {
  const triangles = [];
  for (let index = 0; index < packed.length; index += 9) {
    triangles.push([
      { x: packed[index], y: packed[index + 1], z: packed[index + 2] },
      { x: packed[index + 3], y: packed[index + 4], z: packed[index + 5] },
      { x: packed[index + 6], y: packed[index + 7], z: packed[index + 8] },
    ]);
  }
  return triangles;
};
const mechanismWitness = fitted.createFittedProxyRigMechanismWitness({
  restTriangles: packedTriangles(rest),
  posedTriangles: packedTriangles(active),
  registration,
  restPose,
  posedPose: activePose,
  binding,
  posedPositions: active,
  width: 80,
  height: 64,
  cameraIds: ['az045'],
});
assert.deepEqual(mechanismWitness.columns, [
  'rest-cast',
  'rest-proxy-xray',
  'posed-proxy-xray',
  'posed-displacement-heat',
]);
assert.deepEqual(mechanismWitness.cameraIds, ['az045']);
assert.ok(mechanismWitness.bytes.length > 1024, 'mechanism witness must be a nonempty PNG');
assert.equal(mechanismWitness.bytes[0], 0x89);
assert.equal(mechanismWitness.bytes.toString('ascii', 1, 4), 'PNG');

const failureDir = await mkdtemp(join(tmpdir(), 'kaminos-fitted-proxy-rig-failure-'));
const packetPath = join(failureDir, 'packet.json');
const fitReportPath = join(failureDir, 'fit-report.json');
await writeFile(packetPath, `${JSON.stringify(packet)}\n`);
const fitReportBytes = Buffer.from(`${JSON.stringify(fitReport)}\n`);
const expectedFitReportSha256 = `sha256:${createHash('sha256').update(fitReportBytes).digest('hex')}`;
for (const name of ['silhouette-residual-witness.png', 'depth-residual-witness.png']) {
  await writeFile(join(failureDir, name), readFileSync(join(dirname(priorReportPath), name)));
}
await writeFile(fitReportPath, fitReportBytes);
await assert.rejects(
  () => fitted.runFittedProxyRigProof({
    donorPath: join(failureDir, 'missing.glb'),
    sourcePacketPath: packetPath,
    fitReportPath,
    outDir: failureDir,
    expectedDonorSha256: donorSha256,
    expectedFitReportSha256,
  }),
  /missing donor/,
);
assert.ok(existsSync(join(failureDir, 'proof-report.json')), 'pre-output failure must leave a durable proof report');
const failureReport = JSON.parse(readFileSync(join(failureDir, 'proof-report.json'), 'utf8'));
assert.equal(failureReport.status, 'failed');
assert.equal(failureReport.failurePhase, 'donor-admission');
assert.equal(failureReport.requestedRoute, 'kaminos/fitted-proxy-rig/software-triangle-deformation-witness-v0');
assert.equal(failureReport.effectiveRoute, null);
assert.equal(failureReport.expectedDonorSha256, donorSha256);
assert.equal(failureReport.expectedFitReportSha256, expectedFitReportSha256);
assert.equal(failureReport.outputInventory.primaryWitness, null);

const fitHashFailureDir = await mkdtemp(join(tmpdir(), 'kaminos-fitted-proxy-rig-fit-hash-'));
await assert.rejects(
  () => fitted.runFittedProxyRigProof({
    donorPath: join(fitHashFailureDir, 'unused.glb'),
    sourcePacketPath: packetPath,
    fitReportPath,
    outDir: fitHashFailureDir,
    expectedDonorSha256: donorSha256,
    expectedFitReportSha256: `sha256:${'f'.repeat(64)}`,
  }),
  /fit report hash mismatch/,
);
const fitHashFailureReport = JSON.parse(readFileSync(join(fitHashFailureDir, 'proof-report.json'), 'utf8'));
assert.equal(fitHashFailureReport.status, 'failed');
assert.equal(fitHashFailureReport.failurePhase, 'fit-report-admission');

console.log(JSON.stringify({
  status: 'passed',
  sourcePrimitiveCount: primitives.length,
  stationCount: registration.stationCount,
  vertexCount: binding.vertexCount,
  maxRestError,
  smoothMaxRestError,
}, null, 2));
