#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const rootUrl = new URL('../', import.meta.url);
const coreUrl = new URL('../volume-core.js', import.meta.url);
const exporterUrl = new URL('../volume-full-grid-field-export.mjs', import.meta.url);
const initializerUrl = new URL('../volume-coarse-receiver-initial.py', import.meta.url);

assert.ok(existsSync(initializerUrl), 'canonical coarse receiver initializer exists');
const [core, exporter, initializer] = await Promise.all([
  readFile(coreUrl, 'utf8'),
  readFile(exporterUrl, 'utf8'),
  readFile(initializerUrl, 'utf8'),
]);

assert.match(core, /beginDebugFullFieldImport/, 'runtime exposes checksum-addressed full-field import begin custody');
assert.match(core, /writeDebugFullFieldImportChunk/, 'runtime exposes sequential chunk import custody');
assert.match(core, /finishDebugFullFieldImport/, 'runtime exposes import validation and application custody');
assert.match(core, /receiver-initialized-from-filtered-high-t-v0/, 'runtime names receiver initialization authority');
assert.match(core, /learned-selective-head-composition-not-filtered-high-truth-v0/, 'runtime names learned selective composition authority without impersonating high truth');
assert.match(core, /learned-selective-head-application-v0/, 'runtime names the selective head application route');
assert.match(core, /advanceDebugImportedFieldSteps/, 'controlled receiver stepping is atomic and bound to the applied import session');
assert.match(core, /renderLoopPaused:[\s\S]*state\.active = false/, 'applied imports remain held outside the animation loop');
assert.match(core, /fluidBuffers\[0\][\s\S]*fluidBuffers\[1\]/, 'runtime initializes both fluid ping-pong buffers');
assert.match(core, /frontBuffers\[0\][\s\S]*frontBuffers\[1\]/, 'runtime initializes both front ping-pong buffers');
assert.match(exporter, /--initial-field-manifest/, 'exporter accepts a canonical receiver initializer manifest');
assert.match(exporter, /kaminos\.volume\.exact-basin-selective-composition\.v0/, 'exporter admits the learned selective composition schema explicitly');
assert.match(
  exporter,
  /learned-selective-head-composition-not-filtered-high-truth-v0[\s\S]*mustNotBeAcceptedAs[\s\S]*filtered-high/,
  'selective composition admission preserves its explicit non-truth consumption contract',
);
assert.match(exporter, /--advance-imported-steps/, 'exporter advances imported state by an explicit caller-owned step count');
assert.match(
  exporter,
  /initialField[\s\S]*args\.has\('--advance-imported-steps'\)[\s\S]*requires explicit --advance-imported-steps/,
  'an imported-field run cannot silently turn an omitted advance into a plausible held receiver',
);
assert.match(exporter, /advanceDebugImportedFieldSteps/, 'exporter uses the atomic imported-state step API');
assert.match(exporter, /--render-png/, 'exporter can preserve an operator-facing imported-state render');
assert.match(exporter, /--render-only/, 'held visual assays can skip redundant full-field export');
assert.match(exporter, /--render-warmup-count/, 'held visual assays can settle renderer capacity without stepping the simulation');
assert.match(
  exporter,
  /frozen-same-state-capacity-settle-v0[\s\S]*renderWarmups/,
  'capacity-settle warmups remain explicit receipt-bearing same-state renders',
);
assert.match(
  exporter,
  /kaminos\.volume\.held-field-render\.v0[\s\S]*fieldExportSkipped[\s\S]*caller-requested-render-only-v0/,
  'render-only manifests fail loud about omitted field coverage instead of impersonating a full export',
);
assert.match(exporter, /Page\.captureScreenshot/, 'imported render is captured from the effective browser canvas');
assert.match(exporter, /importedRender/, 'manifest preserves imported render route and state identity');
assert.match(exporter, /witness-mounted-imported-canvas-v0/, 'witness explicitly mounts the renderer canvas into a visible capture surface');
assert.match(exporter, /canvas-clip-offscreen/, 'witness rejects an offscreen canvas instead of returning the visible app shell');
assert.match(exporter, /initialFieldImport/, 'export manifest preserves effective import identity');
assert.match(exporter, /importedAdvance/, 'export manifest preserves before/after receiver step identity');
assert.match(core, /requestedSteps === 0[\s\S]*imported-receiver-held-state-v0/, 'zero-step imports identify a held control');
assert.match(
  core,
  /SELECTIVE_COMPOSITION_AUTHORITY[\s\S]*requestedSteps > 0[\s\S]*selective-composition-held-only/,
  'learned selective compositions cannot be advanced as physical receiver state',
);
assert.match(core, /learned-selective-composition-held-render-v0/, 'held learned composition has an authority-specific render identity');
assert.match(core, /requestedSteps === 1[\s\S]*ordinary-receiver-single-simulation-step-v0/, 'one-step imports identify the ordinary receiver assay');
assert.match(core, /imported-receiver-multi-step-sequence-v0/, 'multi-step imports cannot impersonate the one-step assay');
assert.match(core, /receipt\.importedAdvance[\s\S]*already-advanced/, 'an imported receiver session cannot be advanced twice under a fresh one-step identity');
assert.match(
  core,
  /identity: 'imported-receiver-advance-rejected-v0'[\s\S]*reason: 'already-advanced'[\s\S]*priorAppliedReceipt: receipt/,
  'duplicate advance rejection preserves the applied import receipt instead of replacing custody with a failed import',
);
assert.match(initializer, /kaminos\.volume\.coarse-receiver-initial\.v0/, 'initializer emits a stable schema');
assert.match(initializer, /volume-overlap-box-filter-high-to-receiver-v0/, 'initializer uses the canonical overlap filter');
assert.match(initializer, /failurePhase[\s\S]*lastTrustworthyEvidence/, 'initializer preserves pre-output failure evidence');

const root = await mkdtemp(join(tmpdir(), 'kaminos-coarse-receiver-contract-'));
const sourceDir = join(root, 'source');
const outDir = join(root, 'receiver-initial');
const failedDir = join(root, 'failed');
await Promise.all([mkdir(sourceDir), mkdir(outDir), mkdir(failedDir)]);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fluidChannels = [
  'velocityX', 'velocityY', 'velocityZ', 'densityCarrier', 'smokeDensity', 'heat', 'fuel', 'detail',
  'flame', 'ember', 'visibleFireCarrier', 'combustionFront', 'microdetail', 'interfaceShred', 'fireLick', 'emberFleck',
];
const highGrid = 5;
const receiverGrid = 3;

function fieldValues(grid, channels) {
  const values = new Float32Array(grid ** 3 * channels);
  for (let z = 0; z < grid; z += 1) {
    for (let y = 0; y < grid; y += 1) {
      for (let x = 0; x < grid; x += 1) {
        const cell = x + y * grid + z * grid * grid;
        for (let channel = 0; channel < channels; channel += 1) {
          values[cell * channels + channel] = x * 0.07 + y * 0.031 + z * 0.013 + channel * 0.005;
        }
      }
    }
  }
  return values;
}

async function artifact(name, values, shape, channelOrder) {
  const path = join(sourceDir, name);
  const bytes = Buffer.from(values.buffer, values.byteOffset, values.byteLength);
  await writeFile(path, bytes);
  return {
    kind: name.startsWith('fluid') ? 'fluid' : 'front',
    path,
    shape,
    channelOrder,
    dtype: 'float32',
    byteOrder: 'little-endian',
    byteLength: bytes.byteLength,
    floatCount: values.length,
    sha256: sha256(bytes),
  };
}

const fluid = await artifact('fluid.f32', fieldValues(highGrid, fluidChannels.length), [highGrid, highGrid, highGrid, fluidChannels.length], fluidChannels);
const front = await artifact('front.f32', fieldValues(highGrid, 1), [highGrid, highGrid, highGrid, 1], ['frontTopology']);
const sourceManifest = {
  schema: 'kaminos.volume.full-grid-field-export.v0',
  identity: 'full-grid-fluid-front-boundary-sidecars-v0',
  status: 'captured',
  failurePhase: null,
  completeFieldCoverage: true,
  sourceCapture: { identity: 'contract-basin', payloadSha256: 'a'.repeat(64), hashMatches: true },
  routeIdentity: 'native-3d-compute-fluid-raymarch-v0',
  effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
  prototypeIdentity: 'kaminos-volume-prototype-v0',
  backend: 'WebGPU:contract',
  grid: highGrid,
  deterministicReplay: { identity: 'deterministic-replay-same-route-controls-fixed-step-v0', completedSteps: 12, simStepCount: 12 },
  fluidComponents: fluidChannels.length,
  fluidChannelOrder: fluidChannels,
  frontChannelOrder: ['frontTopology'],
  sidecars: { fluid, front },
};
const sourceManifestPath = join(sourceDir, 'manifest.json');
await writeFile(sourceManifestPath, `${JSON.stringify(sourceManifest, null, 2)}\n`);

const reportPath = join(outDir, 'manifest.json');
const run = spawnSync('python3', [initializerUrl.pathname, '--source-manifest', sourceManifestPath, '--receiver-grid', String(receiverGrid), '--out-dir', outDir], { encoding: 'utf8' });
assert.equal(run.status, 0, run.stderr || run.stdout);
const report = JSON.parse(await readFile(reportPath, 'utf8'));
assert.equal(report.status, 'captured');
assert.equal(report.schema, 'kaminos.volume.coarse-receiver-initial.v0');
assert.equal(report.initializationAuthority, 'receiver-initialized-from-filtered-high-t-v0');
assert.equal(report.source.highSimStepCount, 12);
assert.equal(report.receiver.grid, receiverGrid);
assert.equal(report.receiver.initialSimStepCount, 0);
assert.deepEqual(report.receiver.fluid.shape, [receiverGrid, receiverGrid, receiverGrid, fluidChannels.length]);
assert.deepEqual(report.receiver.front.shape, [receiverGrid, receiverGrid, receiverGrid, 1]);
assert.ok(existsSync(report.receiver.fluid.path));
assert.ok(existsSync(report.receiver.front.path));

await writeFile(fluid.path, Buffer.alloc(fluid.byteLength, 0xff));
const failedReportPath = join(failedDir, 'manifest.json');
const reject = spawnSync('python3', [initializerUrl.pathname, '--source-manifest', sourceManifestPath, '--receiver-grid', String(receiverGrid), '--out-dir', failedDir], { encoding: 'utf8' });
assert.equal(reject.status, 2, 'initializer rejects corrupt high source bytes');
const failed = JSON.parse(await readFile(failedReportPath, 'utf8'));
assert.equal(failed.status, 'failed');
assert.equal(failed.failurePhase, 'source-validation');
assert.match(failed.reason, /sha256 mismatch/);
assert.ok(failed.lastTrustworthyEvidence.sourceManifestSha256);

console.log('coarse closure receiver contracts passed');
