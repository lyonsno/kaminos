import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

import * as volume from '../volume-core.js';
import { validateGpuCombustibleObjectPixelSequence } from '../gpu-combustible-object-pixel-checks.mjs';

const volumeSource = await readFile(new URL('../volume-core.js', import.meta.url), 'utf8');
const runtimeSource = await readFile(new URL('../gpu-combustible-object-loop.mjs', import.meta.url), 'utf8');
const receiverSource = await readFile(new URL('../combustible-object-fire-gpu.mjs', import.meta.url), 'utf8');

assert.equal(
  volume.GPU_COMBUSTIBLE_OBJECT_LOOP_SCHEMA,
  'kaminos.gpu-combustible-object-loop.v0',
  'the runtime exposes a stable GPU-resident combustible-object schema',
);
assert.equal(
  volume.GPU_COMBUSTIBLE_OBJECT_LOOP_AUTHORITY,
  'same-device-pyro-material-emission-mechanics-v0',
  'one same-device authority covers exposure, material, emission, and mechanics',
);
assert.equal(
  typeof volume.validateGpuCombustibleObjectTerminalReceipt,
  'function',
  'terminal evidence has a falsifiable host-side validator without becoming runtime control',
);
assert.match(
  volumeSource,
  /setGpuCombustibleObjectLoop\s*\(/,
  'the volume prototype exposes the GPU-resident loop',
);
assert.match(
  volumeSource,
  /readGpuCombustibleObjectTerminalReceipt\s*\(/,
  'the volume prototype exposes terminal-only evidence readback',
);
assert.doesNotMatch(
  volumeSource,
  /readGpuCombustibleObjectTerminalReceipt\s*\([\s\S]{0,1200}(?:encodeSim|requestAnimationFrame|setControls)\s*\(/,
  'terminal receipt mapping cannot feed simulation, frame scheduling, or control mutation',
);

const encodeSimStart = volumeSource.indexOf('function encodeSim(encoder');
const loopUpdate = volumeSource.indexOf('gpuCombustibleObjectLoop.encode(encoder', encodeSimStart);
const sourceScatter = volumeSource.indexOf('combustibleObjectSourceReceiver.encode(encoder', encodeSimStart);
const fluidStep = volumeSource.indexOf("label: 'kaminos fluid sim pass'", encodeSimStart);
assert.ok(
  encodeSimStart >= 0 && loopUpdate > encodeSimStart && sourceScatter > loopUpdate && fluidStep > sourceScatter,
  'the GPU command graph orders material/source update before scatter and the authoritative fluid step',
);
assert.match(
  volumeSource,
  /gpuCombustibleObjectLoop\.encodePresentation\([\s\S]*currentTexture\.createView\(\)[\s\S]*gpuCombustibleObjectPresentationTransformValues/,
  'the GPU object presentation receives the camera-relative transform on every render',
);
const liveEncodeStart = runtimeSource.indexOf('function encode(encoder, fluidBuffer)');
const terminalReadStart = runtimeSource.indexOf('async function readTerminalReceipt(receiverStatsDescriptor)');
assert.ok(liveEncodeStart >= 0 && terminalReadStart > liveEncodeStart);
assert.doesNotMatch(
  runtimeSource.slice(liveEncodeStart, terminalReadStart),
  /mapAsync|MAP_READ/,
  'the live GPU material/emission/presentation loop never maps state to the host',
);
assert.doesNotMatch(
  runtimeSource,
  /Promise\.all\(\[\s*readBuffer\(materialBuffer[\s\S]*readBuffer\(eventBuffer[\s\S]*readBuffer\(sourceHeaderBuffer/,
  'terminal evidence is copied into one staging buffer rather than mapped from three hidden buffers',
);
assert.match(receiverSource, /terminalStatsDescriptor\s*\(/, 'the receiver exposes its GPU stats buffer for combined terminal evidence');
assert.match(runtimeSource, /receiverAudit/, 'the terminal receipt carries target-specific receiver acceptance evidence');
const receiverFinalizeStart = receiverSource.indexOf('fn finalizeApply()');
const receiverFinalizeGuard = receiverSource.indexOf('if (atomicLoad(&stats.status) != 4u) { return; }', receiverFinalizeStart);
const receiverFinalizeConsumedTick = receiverSource.indexOf('atomicStore(&stats.lastConsumedTick', receiverFinalizeStart);
assert.ok(receiverFinalizeStart >= 0, 'the receiver has a dedicated single-workgroup finalizer');
assert.ok(
  receiverFinalizeGuard > receiverFinalizeStart && receiverFinalizeGuard < receiverFinalizeConsumedTick,
  'the WGSL finalizer preserves stale and invalid status before advancing the consumed tick',
);

const pageUrl = new URL('../gpu-combustible-object-ignition.html', import.meta.url);
const witnessUrl = new URL('../gpu-combustible-object-ignition-witness.mjs', import.meta.url);
assert.equal(existsSync(pageUrl), true, 'the GPU-resident ignition browser route exists');
assert.equal(existsSync(witnessUrl), true, 'the GPU-resident ignition terminal witness exists');
const pageSource = await readFile(pageUrl, 'utf8');
const witnessSource = await readFile(witnessUrl, 'utf8');
assert.match(pageSource, /setGpuCombustibleObjectLoop\s*\(/);
assert.doesNotMatch(pageSource, /stepCombustiblePlank|ignitionRequested|readCombustibleObjectSourceReceipt|mapAsync/);
assert.match(pageSource, /gpu-combustible-object-orbit-camera-v0/, 'the route names its operator camera contract');
assert.match(pageSource, /setPointerCapture/, 'orbit drag retains pointer custody outside the canvas bounds');
assert.match(pageSource, /addEventListener\('wheel',[\s\S]*passive:\s*false/, 'wheel and trackpad zoom are active rather than page scroll');
assert.match(pageSource, /ORBIT_MIN_DISTANCE[\s\S]*ORBIT_MAX_DISTANCE/, 'camera zoom has explicit near and far inspection bounds');
assert.match(pageSource, /cameraControl:/, 'debug state exposes effective camera identity and interaction state');
assert.match(pageSource, /controls:\s*cameraControls/, 'the volume render loop updates the real operator camera controls');
assert.match(runtimeSource, /presentationTransform/, 'the GPU object overlay consumes the anchored camera transform');
assert.match(runtimeSource, /anchorNdcDepth/, 'the GPU object overlay reconstructs its anchor on the scene-depth plane');
assert.match(
  volumeSource,
  /gpuCombustibleObjectPresentationAnchorInverse[\s\S]*gpuCombustibleObjectPresentationAnchorNdcDepth[\s\S]*gpuCombustibleObjectPresentationTransform/,
  'the volume composes current camera projection against the witness presentation anchor',
);
assert.doesNotMatch(
  pageSource,
  /\.metric:nth-child\(n \+ 3\)\s*\{\s*display:\s*none/,
  'narrow viewports retain presentation and host-feedback authority diagnostics',
);
const stopIndex = pageSource.indexOf('setActive(false)');
const terminalIndex = pageSource.indexOf('readGpuCombustibleObjectTerminalReceipt()', stopIndex);
assert.ok(stopIndex >= 0 && terminalIndex > stopIndex, 'terminal receipt is read only after the render loop stops');
assert.match(witnessSource, /same-device-pyro-material-emission-mechanics-v0/);
assert.match(witnessSource, /hostCausalFeedbackCount/);
assert.match(witnessSource, /target.*firstExposureStep|firstExposureStep.*target/s);
assert.match(witnessSource, /supportLossStep/);
assert.match(witnessSource, /impactStep/);
assert.match(witnessSource, /receiverAudit\.auditObjectId/);
assert.match(witnessSource, /receiverAudit\.injectedHeat/);
assert.match(witnessSource, /cameraSmokeRequested/, 'the existing witness has an explicit operator-camera smoke mode');
assert.match(witnessSource, /Input\.dispatchMouseEvent/, 'camera smoke uses real browser pointer and wheel input');
assert.match(witnessSource, /cameraControlBefore[\s\S]*cameraControlAfter/, 'camera smoke preserves before and after control receipts');
assert.match(witnessSource, /cameraInputReceipt/, 'camera smoke records requested pointer and wheel input');
assert.match(witnessSource, /finalState\s*=\s*cameraState/, 'camera smoke persists its final live state into the report');
assert.match(
  witnessSource,
  /cameraState\.gpuLoop\.hostCausalFeedbackCount, 0/,
  'camera interaction cannot masquerade as causal simulation feedback',
);
assert.match(
  witnessSource,
  /validateGpuCombustibleObjectPixelSequence/,
  'the witness rejects blank, stale, and phase-incoherent screenshots from decoded pixels',
);
assert.match(
  witnessSource,
  /ignitionState\.simStepCount[\s\S]*targetMaterial\.ignitionStep[\s\S]*targetMaterial\.supportLossStep/,
  'terminal event evidence proves the ignition capture occurred after ignition and before support loss',
);

const recordedReport = JSON.parse(await readFile(
  new URL('../artifacts/gpu-combustible-object-ignition/run-003/report.json', import.meta.url),
  'utf8',
));
assert.throws(
  () => volume.validateGpuCombustibleObjectTerminalReceipt(recordedReport.terminalReceipt),
  /receiver|map|terminal/i,
  'pre-fix evidence without literal map accounting and target receiver acceptance cannot close the revised contract',
);
const revisedReceipt = structuredClone(recordedReport.terminalReceipt);
const recordedTarget = revisedReceipt.materials.find(material => material.objectId === 2);
revisedReceipt.terminalMapAsyncCount = 1;
revisedReceipt.terminalMappedBufferCount = 1;
revisedReceipt.terminalCopiedSourceBufferCount = 4;
revisedReceipt.receiverAudit = {
  routeIdentity: 'same-device-combustible-object-source-to-native-pyro-v0',
  status: 'applied',
  lastConsumedTick: revisedReceipt.sourceHeader.writeTick,
  auditObjectId: 2,
  acceptedRecords: 12,
  rejectedRecords: 0,
  targetOnlyDispatches: 8,
  injectedHeat: 1.25,
  injectedFuel: 0.75,
  injectedSoot: 0.25,
  injectedSmoke: 0.5,
  firstAcceptedStep: recordedTarget.ignitionStep,
  lastAcceptedStep: revisedReceipt.sourceHeader.writeTick,
  acceptedCell: [14, 12, 16],
  sourceGeneration: 1,
  topologyEpoch: 0,
  sourceFrameHash: revisedReceipt.sourceHeader.sourceFrameHash,
};
assert.equal(
  volume.validateGpuCombustibleObjectTerminalReceipt(revisedReceipt),
  revisedReceipt,
  'literal one-map evidence plus target-specific receiver acceptance closes the terminal contract',
);

function pngChunk(type, data) {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  return chunk;
}

function syntheticGpuObjectPng(phase, { blank = false, moveControl = false } = {}) {
  const width = 640;
  const height = 480;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 4;
      let color = [0, 0, 0];
      if (!blank) {
        color = [2, 3, 2];
        if (x >= 92 && x < 250 && y >= 163 && y < 187) color = [190, 84, 34];
        if (x >= 397 && x < 538 && y >= 156 && y < 175) color = [142, 119, 72];
        if (x >= 198 && x < 403 && y >= 269 && y < 293) {
          color = phase === 'initial' ? [182, 98, 43] : phase === 'ignition' ? [119, 58, 24] : color;
        }
        if (phase === 'final' && x >= 225 && x < 405 && y >= 320 && y < 358) color = [54, 25, 11];
        if (moveControl && x >= 397 && x < 538 && y >= 156 && y < 175) color = [92, 32, 24];
        if (y >= 100 && y < 104 && x >= 100 && x < 132) {
          const band = Math.floor((x - 100) / 4);
          color = [24 + band * 18, 18 + band * 7, 28 + band * 3];
        }
      }
      raw[offset] = color[0];
      raw[offset + 1] = color[1];
      raw[offset + 2] = color[2];
      raw[offset + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const visualProof = validateGpuCombustibleObjectPixelSequence({
  initial: syntheticGpuObjectPng('initial'),
  ignition: syntheticGpuObjectPng('ignition'),
  final: syntheticGpuObjectPng('final'),
});
assert.equal(visualProof.status, 'ok');
assert.ok(visualProof.deltas.initialToIgnitionTarget.changedRatio > 0.03);
assert.equal(visualProof.deltas.initialToIgnitionControl.changedRatio, 0);
assert.throws(
  () => validateGpuCombustibleObjectPixelSequence({
    initial: syntheticGpuObjectPng('initial'),
    ignition: syntheticGpuObjectPng('ignition'),
    final: syntheticGpuObjectPng('ignition'),
  }),
  /repeats|final|fallen/i,
  'a stale ignition frame cannot impersonate the terminal fall',
);
assert.throws(
  () => validateGpuCombustibleObjectPixelSequence({
    initial: syntheticGpuObjectPng('initial', { blank: true }),
    ignition: syntheticGpuObjectPng('ignition', { blank: true }),
    final: syntheticGpuObjectPng('final', { blank: true }),
  }),
  /blank|missing|degenerate/i,
  'route-correct blank screenshots cannot close visual evidence',
);
assert.throws(
  () => validateGpuCombustibleObjectPixelSequence({
    initial: syntheticGpuObjectPng('initial'),
    ignition: syntheticGpuObjectPng('ignition', { moveControl: true }),
    final: syntheticGpuObjectPng('final'),
  }),
  /control changed/i,
  'a changing matched control cannot close the selective ignition witness',
);

console.log('gpu combustible-object loop contracts: ok');
