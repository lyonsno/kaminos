import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FLOW_KERNEL_DESCRIPTOR_ORDER,
  FLOW_KERNEL_DESCRIPTOR_SOCKET_IDENTITY,
  FLOW_KERNEL_DESCRIPTOR_STRIDE_FLOATS,
  decodeFlowKernelDescriptorCapture,
  flowKernelMomentDescriptor,
} from '../flow-kernel-descriptor-socket.mjs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const exporter = readFileSync(new URL('../volume-full-grid-field-export.mjs', import.meta.url), 'utf8');
const descriptorModule = readFileSync(new URL('../flow-kernel-descriptor-socket.mjs', import.meta.url), 'utf8');
const selectiveBindGroupStart = core.indexOf('function rebuildSelectiveHeadLiveBindGroups()');
const selectiveBindGroupEnd = core.indexOf('function selectiveHeadLiveRequestedRole()', selectiveBindGroupStart);
const selectiveBindGroupSource = core.slice(selectiveBindGroupStart, selectiveBindGroupEnd);
const descriptorCaptureStart = core.indexOf('async function sampleBoundarySplatKernelDescriptorCapture(instanceCount');
const descriptorCaptureEnd = core.indexOf('function readFlowKernelDescriptorCaptureChunk', descriptorCaptureStart);
const descriptorCaptureSource = core.slice(descriptorCaptureStart, descriptorCaptureEnd);
const descriptorDrainStart = exporter.indexOf('async function drainFlowKernelDescriptorCapture');
const descriptorDrainEnd = exporter.indexOf('function resolveInitialFieldManifest()', descriptorDrainStart);
const descriptorDrainSource = exporter.slice(descriptorDrainStart, descriptorDrainEnd);

assert.equal(FLOW_KERNEL_DESCRIPTOR_SOCKET_IDENTITY, 'flow-kernel-local-descriptor-socket-v0');
assert.equal(FLOW_KERNEL_DESCRIPTOR_STRIDE_FLOATS, 100);
assert.equal(FLOW_KERNEL_DESCRIPTOR_ORDER.length, FLOW_KERNEL_DESCRIPTOR_STRIDE_FLOATS);
assert.deepEqual(FLOW_KERNEL_DESCRIPTOR_ORDER.slice(0, 20), [
  'position.world.x', 'position.world.y', 'position.world.z', 'position.nativeCellIndex',
  'kernel.normalizedMass', 'kernel.firstMoment.x', 'kernel.firstMoment.y', 'kernel.firstMoment.z',
  'kernel.covariance.xx', 'kernel.covariance.xy', 'kernel.covariance.xz', 'kernel.covariance.yy',
  'kernel.covariance.yz', 'kernel.covariance.zz', 'kernel.radiusWorld', 'kernel.coherence',
  'structure.normal.x', 'structure.normal.y', 'structure.normal.z', 'structure.normalValid',
]);
assert.ok(FLOW_KERNEL_DESCRIPTOR_ORDER.includes('flow.divergence'), 'descriptor exposes divergence as a non-radiant scalar');
assert.ok(FLOW_KERNEL_DESCRIPTOR_ORDER.includes('validity.strengthZeroIdentity'), 'descriptor exposes exact strength-zero identity');
assert.ok(FLOW_KERNEL_DESCRIPTOR_ORDER.includes('majorant.importance'), 'descriptor exposes conservative local majorant state');
assert.ok(FLOW_KERNEL_DESCRIPTOR_ORDER.includes('gradient.micro.w.z'), 'descriptor exposes world gradients for every consumed channel');
assert.ok(!FLOW_KERNEL_DESCRIPTOR_ORDER.some(name => name.includes('tap') || name.includes('weight')), 'literal taps and weights stay private');

const tangent = [0.6, 0.8, 0];
const activeMoment = flowKernelMomentDescriptor({ strength: 0.5, radiusWorld: 0.04, tangent });
assert.equal(activeMoment.normalizedMass, 1);
assert.deepEqual(activeMoment.firstMoment, [0, 0, 0]);
assert.deepEqual(activeMoment.covariance, {
  xx: 0.000144,
  xy: 0.000192,
  xz: 0,
  yy: 0.000256,
  yz: 0,
  zz: 0,
});
assert.equal(activeMoment.strengthZeroIdentity, false);

const identityMoment = flowKernelMomentDescriptor({ strength: 0, radiusWorld: 0.12, tangent: [1, 0, 0] });
assert.equal(identityMoment.normalizedMass, 1);
assert.deepEqual(identityMoment.firstMoment, [0, 0, 0]);
assert.deepEqual(identityMoment.covariance, { xx: 0, xy: 0, xz: 0, yy: 0, yz: 0, zz: 0 });
assert.equal(identityMoment.effectiveRadiusWorld, 0);
assert.equal(identityMoment.strengthZeroIdentity, true);

const row = new Float32Array(FLOW_KERNEL_DESCRIPTOR_STRIDE_FLOATS);
row[4] = 1;
row[30] = 1;
row[28] = 1;
row[31] = 1;
const decoded = decodeFlowKernelDescriptorCapture(row, 1, 1, {
  kernelIdentity: 'flow-tangent-positive-symmetric-trilinear-v0',
  requestedControls: { strength: 0, radiusWorld: 0.03, coherence: 1 },
  effectiveControls: { strength: 0, radiusWorld: 0.03, coherence: 1 },
  sourceHashes: {
    fluidSha256: 'a'.repeat(64),
    frontSha256: 'b'.repeat(64),
    boundarySidecarSha256: 'c'.repeat(64),
    majorantSha256: 'd'.repeat(64),
  },
});
assert.equal(decoded.identity, FLOW_KERNEL_DESCRIPTOR_SOCKET_IDENTITY);
assert.equal(decoded.rowCount, 1);
assert.equal(decoded.kernel.strengthZeroIdentity, true);
assert.equal(decoded.sourceHashes.fluidSha256, 'a'.repeat(64));
const malformedIdentityRow = row.slice();
malformedIdentityRow[8] = 123;
malformedIdentityRow[14] = 0.12;
malformedIdentityRow[30] = 0;
assert.throws(() => decodeFlowKernelDescriptorCapture(malformedIdentityRow, 1, 1, {
  kernelIdentity: 'flow-tangent-positive-symmetric-trilinear-v0',
  requestedControls: { strength: 0, radiusWorld: 0.03, coherence: 1 },
  effectiveControls: { strength: 0, radiusWorld: 0.03, coherence: 1 },
  sourceHashes: {
    fluidSha256: 'a'.repeat(64),
    frontSha256: 'b'.repeat(64),
    boundarySidecarSha256: 'c'.repeat(64),
    majorantSha256: 'd'.repeat(64),
  },
}), /strength-zero identity/, 'socket refuses metadata-only identity when row moments and validity disagree');
assert.throws(() => decodeFlowKernelDescriptorCapture(row, 1, 1, {
  kernelIdentity: 'flow-tangent-positive-symmetric-trilinear-v0',
  requestedControls: { strength: 0, radiusWorld: 0.03, coherence: 1 },
  effectiveControls: { strength: 0, radiusWorld: 0.03, coherence: 1 },
  sourceHashes: { fluidSha256: 'not-a-hash' },
}), /source hash/, 'socket fails loud when authoritative field hashes are absent or malformed');

assert.match(page, /volume_flow_kernel_descriptor_capture/, 'URL route exposes the diagnostic descriptor socket explicitly');
assert.match(core, /flowKernelDescriptorCaptureRequested/, 'runtime distinguishes requested descriptor capture');
assert.match(core, /flowKernelDescriptorCaptureEffective/, 'runtime reports effective descriptor capture');
assert.match(core, /sampleBoundarySplatKernelDescriptorCapture/, 'runtime reads the candidate-local descriptor socket');
assert.match(core, /readFlowKernelDescriptorCaptureChunk/, 'runtime exposes session-bound chunk reads instead of one giant CDP payload');
assert.match(core, /releaseFlowKernelDescriptorCapture/, 'runtime releases retained descriptor snapshots explicitly');
assert.ok(selectiveBindGroupStart >= 0 && selectiveBindGroupEnd > selectiveBindGroupStart, 'selective-head bind-group constructor is inspectable');
assert.match(selectiveBindGroupSource, /splat:[\s\S]*binding:\s*7[^\n]*majorantBuffer/, 'selective-head splat route binds the shared conservative majorant ABI');
assert.match(selectiveBindGroupSource, /splat:[\s\S]*binding:\s*8[^\n]*flowKernelDescriptorBuffer/, 'selective-head splat route binds the shared descriptor-output ABI');
assert.ok(descriptorCaptureStart >= 0 && descriptorCaptureEnd > descriptorCaptureStart, 'descriptor capture function is inspectable');
assert.match(descriptorCaptureSource, /descriptorSourceFluidBuffer/, 'capture names the effective fluid buffer that produced descriptor rows');
assert.match(descriptorCaptureSource, /descriptorSourceFrontBuffer/, 'capture names the effective front buffer that produced descriptor rows');
assert.match(descriptorCaptureSource, /readStorageBufferBytes\(\s*descriptorSourceFluidBuffer/, 'capture hashes the effective fluid state instead of only its imported ancestor');
assert.match(descriptorCaptureSource, /readStorageBufferBytes\(\s*descriptorSourceFrontBuffer/, 'capture hashes the effective front state instead of only its imported ancestor');
assert.doesNotMatch(descriptorCaptureSource, /fluidSha256:\s*importReceipt\.fluidSha256/, 'capture does not mislabel an advanced descriptor with its import-time fluid hash');
assert.doesNotMatch(descriptorCaptureSource, /frontSha256:\s*importReceipt\.frontSha256/, 'capture does not mislabel an advanced descriptor with its import-time front hash');
assert.match(core, /boundarySidecarSha256[\s\S]*majorantSha256/, 'capture hashes derived sidecar and majorant state');
assert.match(core, /reconstructionControls\.w/, 'descriptor writes are debug-gated independently of rendering semantics');
assert.match(core, /max\(vec4<f32>\(0\.0\), mix\(center\.sidecar/, 'descriptor path preserves nonnegative reconstructed extinction-bearing fields');
assert.doesNotMatch(core, /divergence[\s\S]{0,160}(radiance|colorOpacity|fireSignal)/i, 'divergence is not direct radiance authority');
assert.match(exporter, /--flow-kernel-descriptor-bin/, 'frozen exporter accepts a direct descriptor artifact path');
assert.match(exporter, /if \(flowKernelDescriptorBinPath\)[\s\S]*flowKernelDescriptorCapture:\s*true/, 'requesting a descriptor artifact directly enables its renderer capture input');
assert.match(exporter, /drainFlowKernelDescriptorCapture/, 'frozen exporter drains the browser socket without a transcription half-step');
assert.match(exporter, /descriptorSha256[\s\S]*sha256File/, 'frozen exporter checks the drained artifact against the browser checksum');
assert.doesNotMatch(descriptorModule, /packedFloat32Base64|packFlowKernelDescriptorCapture/, 'descriptor module does not retain a giant monolithic CDP payload path');
assert.match(descriptorDrainSource, /partial/, 'descriptor export withholds the final artifact path until all chunks and hashes validate');
assert.match(descriptorDrainSource, /exportError[\s\S]*releaseFlowKernelDescriptorCapture[\s\S]*if \(exportError\)[\s\S]*throw exportError/, 'descriptor export releases its browser session before rethrowing a chunk or checksum failure');

console.log('flow kernel descriptor socket contracts passed');
