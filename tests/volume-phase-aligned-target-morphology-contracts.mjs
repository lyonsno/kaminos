#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const assembler = join(root, 'volume-phase-aligned-target-morphology-witness.mjs');
const fixture = mkdtempSync(join(tmpdir(), 'kaminos-target-morphology-'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const writeJson = (name, value) => {
  const path = join(fixture, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
};
const png = name => {
  const path = join(fixture, `${name}.png`);
  const bytes = Buffer.concat([
    Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de', 'hex'),
    Buffer.from(name),
  ]);
  writeFileSync(path, bytes);
  return { path, byteLength: bytes.byteLength, sha256: sha256(bytes) };
};

const basinSha = 'b'.repeat(64);
const highFluidSha = '1'.repeat(64);
const lowFluidSha = '2'.repeat(64);
const pair = writeJson('pair.json', {
  schema: 'kaminos.volume.full-grid-field-pair.v0',
  identity: 'phase-aligned-exact-basin-field-pair-v0',
  status: 'captured',
  failurePhase: null,
  authority: 'downsampled-same-high-history-input-to-exact-high-target',
  lowGrid: 96,
  highGrid: 160,
  source: { exactBasinSourceCaptureSha256: basinSha },
  low: { fluid: { sha256: lowFluidSha }, front: { sha256: '3'.repeat(64) } },
  high: { fluid: { sha256: highFluidSha }, front: { sha256: '4'.repeat(64) } },
});
const pairSha = sha256(readFileSync(pair));

function held(name, role, grid, runtimeTruthAvailable, fluidSha) {
  return writeJson(`${name}.held.json`, {
    schema: 'kaminos.volume.phase-aligned-held-field.v0',
    identity: 'phase-aligned-held-field-render-role-v0',
    status: 'captured',
    failurePhase: null,
    role,
    runtimeTruthAvailable,
    renderOnly: true,
    source: {
      exactBasinSourceCaptureSha256: basinSha,
      pairManifestPath: pair,
      pairManifestSha256: pairSha,
    },
    receiver: { grid, fluid: { sha256: fluidSha }, front: { sha256: role === 'truthHigh' ? '4'.repeat(64) : '3'.repeat(64) } },
  });
}

function application(name, scale) {
  return writeJson(`${name}.application.json`, {
    schema: 'kaminos.volume.exact-basin-selective-composition.v0',
    identity: 'dense-topology-plus-support-aware-sparse-carriers-v0',
    status: 'captured',
    failurePhase: null,
    compositionAuthority: 'learned-selective-head-composition-not-filtered-high-truth-v0',
    runtimeTruthAvailable: false,
    source: {
      pairManifestPath: pair,
      pairManifestSha256: pairSha,
      exactBasinSourceCaptureSha256: basinSha,
      supportProbeManifestSha256: '5'.repeat(64),
    },
    relationship: { authority: 'downsampled-same-high-history-input-to-exact-high-target', lowGrid: 96, highGrid: 160 },
    residualBlend: { identity: 'low-plus-scaled-learned-residual-v0', scale },
    receiver: { grid: 160 },
  });
}

function render(name, sourceManifest, grid) {
  return writeJson(`${name}.render.json`, {
    schema: 'kaminos.volume.held-field-render.v0',
    identity: 'held-imported-field-neural-splat-render-v0',
    status: 'captured',
    failurePhase: null,
    initialFieldImport: {
      requested: { manifestPath: sourceManifest, manifestSha256: sha256(readFileSync(sourceManifest)), grid, advanceImportedSteps: 0 },
      effective: { grid, routeIdentity: 'native-3d-compute-fluid-raymarch-v0', effectiveRoute: 'native-3d-compute-fluid-raymarch-v0', backend: 'WebGPU:apple' },
    },
    importedRender: {
      path: png(name).path,
      byteLength: null,
      sha256: null,
      imageAuthority: 'cdp-canvas-clip-capture-after-render-only-frozen-sim-state',
      boundarySplatCompositionRequested: 'raymarch-under-splats-v0',
      boundarySplatCompositionEffective: 'raymarch-under-splats-v0',
      raymarchApplied: true,
      splatApplied: false,
      backend: 'WebGPU:apple',
      fallbackReason: null,
      importedFieldManifestPath: sourceManifest,
      importedFieldManifestSha256: sha256(readFileSync(sourceManifest)),
    },
  });
}

function finishRender(path) {
  const value = JSON.parse(readFileSync(path));
  const bytes = readFileSync(value.importedRender.path);
  value.importedRender.byteLength = bytes.byteLength;
  value.importedRender.sha256 = sha256(bytes);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

const truthHeld = held('truth', 'truthHigh', 160, true, highFluidSha);
const lowHeld = held('low', 'lowPhaseAligned', 96, false, lowFluidSha);
const deterministic = application('deterministic', 0);
const learned = application('learned', 1);
const truthRender = finishRender(render('truth', truthHeld, 160));
const lowRender = finishRender(render('low', lowHeld, 96));
const deterministicRender = finishRender(render('deterministic', deterministic, 160));
const learnedRender = finishRender(render('learned', learned, 160));

const out = join(fixture, 'out');
const args = [
  assembler,
  '--pair-manifest', pair,
  '--truth-manifest', truthHeld,
  '--truth-render-manifest', truthRender,
  '--low-manifest', lowHeld,
  '--low-render-manifest', lowRender,
  '--deterministic-manifest', deterministic,
  '--deterministic-render-manifest', deterministicRender,
  '--learned-manifest', learned,
  '--learned-render-manifest', learnedRender,
  '--out-dir', out,
];
const pass = spawnSync(process.execPath, args, { encoding: 'utf8' });
assert.equal(pass.status, 0, pass.stderr || pass.stdout);
const report = JSON.parse(readFileSync(join(out, 'manifest.json')));
assert.equal(report.status, 'captured');
assert.deepEqual(Object.keys(report.roles), ['truthHigh160', 'filteredLow96Native', 'deterministic96to160', 'learned96to160']);
assert.equal(report.roles.truthHigh160.targetAuthority, true);
assert.equal(report.roles.deterministic96to160.residualScale, 0);
assert.equal(report.roles.learned96to160.residualScale, 1);
assert.equal(report.renderer.effectiveForAllRoles, 'raymarch-only-v0');
assert.equal(report.pair.manifestSha256, pairSha);
assert.ok(existsSync(join(out, 'index.html')));

const lyingLearned = application('lying-learned', 0);
const lyingRender = finishRender(render('lying-learned', lyingLearned, 160));
const failedOut = join(fixture, 'failed');
const failed = spawnSync(process.execPath, [
  ...args.slice(0, -1), failedOut,
  '--learned-manifest', lyingLearned,
  '--learned-render-manifest', lyingRender,
], { encoding: 'utf8' });
assert.notEqual(failed.status, 0, 'zero-residual learned role must fail closed');
const failure = JSON.parse(readFileSync(join(failedOut, 'manifest.json')));
assert.equal(failure.status, 'failed');
assert.equal(failure.failurePhase, 'input-validation');
assert.match(failure.error, /learned.*scale/i);

console.log('phase-aligned target morphology contracts passed');
