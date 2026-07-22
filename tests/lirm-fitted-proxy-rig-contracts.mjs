import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fitted = await import('../lirm-reference-fitted-armature-core.mjs');

for (const name of [
  'createPreservedProxyArmatureProgram',
  'createFittedProxyRigRegistration',
  'createFittedProxyRigBinding',
  'createFittedProxyRigPose',
  'deformFittedProxyRigBinding',
  'runFittedProxyRigProof',
  'recordFittedProxyRigProofVisualInspection',
]) {
  assert.equal(typeof fitted[name], 'function', `expected fitted proxy-rig export ${name}`);
}

const packet = JSON.parse(readFileSync(
  new URL('../artifacts/lirm-speciation-armature-witness-v0/control-packets/lirm-armature-03/packet.json', import.meta.url),
  'utf8',
));
const program = fitted.createPreservedProxyArmatureProgram(packet);
const initialParameters = Object.fromEntries(program.parameterSpecs.map(spec => [spec.id, spec.initial]));
const primitives = program.createPrimitives(initialParameters);

assert.equal(program.id, 'kaminos.lirm-preserved-proxy-armature.lirm-armature-03.v0');
assert.equal(program.sourceCandidateId, 'lirm-armature-03');
assert.equal(program.sourcePrimitiveCount, 30);
assert.equal(primitives.length, packet.proxyPrimitives.length, 'source primitive topology must be frozen');
assert.deepEqual(
  primitives.map(primitive => primitive.sourcePrimitiveId),
  packet.proxyPrimitives.map((_primitive, index) => `lirm-armature-03:proxy-${index}`),
);
assert.equal(primitives.filter(primitive => primitive.role === 'bodyMass').length, 13);
assert.ok(primitives.every(primitive => ['ellipsoid', 'capsule'].includes(primitive.kind)));

const priorReport = JSON.parse(readFileSync(
  new URL('../artifacts/lirm-reference-fitted-armature-assay-v0/report.json', import.meta.url),
  'utf8',
));
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
});
assert.equal(registration.schema, 'kaminos.lirm-fitted-proxy-rig-registration.v0');
assert.equal(registration.fitMode, 'semantic-sdf-held-out-multiview-v0');
assert.equal(registration.sourceCandidateId, 'lirm-armature-03');
assert.equal(registration.sourcePrimitiveCount, 30);
assert.equal(registration.stationCount, 13);
assert.equal(registration.manualControlCount, 0);
assert.equal(registration.headDirection, '-Z');
assert.ok(registration.stations.every((station, index) => station.sourcePrimitiveId === `lirm-armature-03:proxy-${index}`));

assert.throws(
  () => fitted.createFittedProxyRigRegistration({
    fitReport: { ...fitReport, status: 'assay-passed-uninspected' },
    armatureProgram: program,
    expectedDonorSha256: donorSha256,
  }),
  /visually inspected and accepted/,
);
assert.throws(
  () => fitted.createFittedProxyRigRegistration({
    fitReport,
    armatureProgram: program,
    expectedDonorSha256: 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
  }),
  /donor hash mismatch/,
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

const failureDir = await mkdtemp(join(tmpdir(), 'kaminos-fitted-proxy-rig-failure-'));
const packetPath = join(failureDir, 'packet.json');
const fitReportPath = join(failureDir, 'fit-report.json');
await writeFile(packetPath, `${JSON.stringify(packet)}\n`);
await writeFile(fitReportPath, `${JSON.stringify(fitReport)}\n`);
await assert.rejects(
  () => fitted.runFittedProxyRigProof({
    donorPath: join(failureDir, 'missing.glb'),
    sourcePacketPath: packetPath,
    fitReportPath,
    outDir: failureDir,
    expectedDonorSha256: donorSha256,
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
assert.equal(failureReport.outputInventory.primaryWitness, null);

console.log(JSON.stringify({
  status: 'passed',
  sourcePrimitiveCount: primitives.length,
  stationCount: registration.stationCount,
  vertexCount: binding.vertexCount,
  maxRestError,
}, null, 2));
