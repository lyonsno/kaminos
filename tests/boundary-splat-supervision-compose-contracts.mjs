import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { composeBoundarySplatSupervisionCorpora } from '../boundary-splat-supervision-compose.mjs';

const schema = 'kaminos-boundary-splat-supervision-corpus-v0';
const authority = 'live-simulator-frozen-state-candidate-raymarch-v0';
const candidateOrder = ['candidate'];
const featureOrder = ['feature'];
const warmup = {
  authority: 'live-single-browser-sim-step-floor-v0',
  requestedMinSimStepCount: 240,
  achievedSimStepCount: 242,
  uncapped: true,
};

function corpus(inputRadius, id = 'frame-000') {
  return {
    schema,
    authority,
    candidateOrder,
    featureOrder,
    requestedFrameCount: 1,
    sameBrowserSequenceSuitable: true,
    sequenceAuthority: 'one-live-browser-sequence-v0',
    stepDeltaMs: 220,
    warmup,
    frames: [{
      id,
      sameStateCaptureId: `capture-${inputRadius}`,
      controlConditioning: {
        identity: 'boundary-splat-emitter-lifecycle-conditioning-v0',
        authority: 'effective-runtime-controls-frozen-sim-state-v0',
        sameStateCaptureId: `capture-${inputRadius}`,
        simStepCount: 242,
        values: {
          inputRadius,
          flowRate: 2.5,
          fireScale: 1.19,
          reactionFuelScale: 1,
          lifecycleEffect: 'none',
          lifecycleT: 0,
          quenchVapor: 0,
        },
      },
    }],
  };
}

const root = await mkdtemp(join(tmpdir(), 'kaminos-supervision-compose-'));
const broadPath = join(root, 'broad.json');
const narrowPath = join(root, 'narrow.json');
const outPath = join(root, 'combined.json');
const reportPath = join(root, 'report.json');
await writeFile(broadPath, `${JSON.stringify(corpus(0.68), null, 2)}\n`);
await writeFile(narrowPath, `${JSON.stringify(corpus(0.12), null, 2)}\n`);

const receipt = await composeBoundarySplatSupervisionCorpora({
  cohorts: [
    { label: 'broad', manifestPath: broadPath },
    { label: 'narrow', manifestPath: narrowPath },
  ],
  outPath,
  reportPath,
});

const combined = JSON.parse(await readFile(outPath, 'utf8'));
assert.equal(combined.schema, schema);
assert.equal(combined.authority, authority);
assert.equal(combined.requestedFrameCount, 2);
assert.equal(combined.sameBrowserSequenceSuitable, false);
assert.equal(combined.sequenceAuthority, 'explicit-multi-corpus-cohort-composition-v0');
assert.deepEqual(combined.frames.map(frame => frame.id), ['broad/frame-000', 'narrow/frame-000']);
assert.deepEqual(combined.frames.map(frame => frame.cohort), ['broad', 'narrow']);
assert.deepEqual(combined.frames.map(frame => frame.controlConditioning.values.inputRadius), [0.68, 0.12]);
assert.deepEqual(combined.warmup, warmup);
assert.equal(combined.composition.structuralValidationOnly, true);
assert.equal(combined.composition.sources.length, 2);
assert.match(combined.composition.sources[0].sha256, /^[0-9a-f]{64}$/);
assert.equal(receipt.status, 'composed');
assert.equal(receipt.output.frameCount, 2);

const report = JSON.parse(await readFile(reportPath, 'utf8'));
assert.equal(report.status, 'composed');
assert.equal(report.output.path, outPath);
assert.match(report.output.sha256, /^[0-9a-f]{64}$/);

const badPath = join(root, 'bad.json');
const badReportPath = join(root, 'bad-report.json');
await writeFile(badPath, `${JSON.stringify({ ...corpus(0.12), candidateOrder: ['wrong'] }, null, 2)}\n`);
await assert.rejects(
  composeBoundarySplatSupervisionCorpora({
    cohorts: [
      { label: 'broad', manifestPath: broadPath },
      { label: 'bad', manifestPath: badPath },
    ],
    outPath: join(root, 'bad-combined.json'),
    reportPath: badReportPath,
  }),
  /candidate order/,
);
const badReport = JSON.parse(await readFile(badReportPath, 'utf8'));
assert.equal(badReport.status, 'failed');
assert.equal(badReport.failurePhase, 'input-validation');
assert.match(badReport.error, /candidate order/);

await assert.rejects(
  composeBoundarySplatSupervisionCorpora({
    cohorts: [
      { label: 'same', manifestPath: broadPath },
      { label: 'same', manifestPath: narrowPath },
    ],
    outPath: join(root, 'duplicate.json'),
    reportPath: join(root, 'duplicate-report.json'),
  }),
  /cohort labels must be unique/,
);

const relativeBroadDir = join(root, 'relative-broad');
const relativeNarrowDir = join(root, 'relative-narrow');
await mkdir(relativeBroadDir);
await mkdir(relativeNarrowDir);
const relativeFrame = inputRadius => ({
  ...corpus(inputRadius).frames[0],
  candidates: { path: 'frame.candidates.f32' },
  target: { path: 'frame.target.png' },
  flowDebug: { path: 'frame.flow-debug.png' },
  structuralSupervision: {
    fields: {
      structure: { path: 'frame.sidecar-structure.f32' },
      meta: { path: 'frame.sidecar-meta.f32' },
    },
  },
});
const relativeBroadPath = join(relativeBroadDir, 'corpus.json');
const relativeNarrowPath = join(relativeNarrowDir, 'corpus.json');
await writeFile(relativeBroadPath, `${JSON.stringify({ ...corpus(0.68), frames: [relativeFrame(0.68)] }, null, 2)}\n`);
await writeFile(relativeNarrowPath, `${JSON.stringify({ ...corpus(0.12), frames: [relativeFrame(0.12)] }, null, 2)}\n`);
const relativeOutPath = join(root, 'relative-combined.json');
await composeBoundarySplatSupervisionCorpora({
  cohorts: [
    { label: 'broad', manifestPath: relativeBroadPath },
    { label: 'narrow', manifestPath: relativeNarrowPath },
  ],
  outPath: relativeOutPath,
  reportPath: join(root, 'relative-report.json'),
});
const relativeCombined = JSON.parse(await readFile(relativeOutPath, 'utf8'));
assert.equal(relativeCombined.frames[0].candidates.path, join(relativeBroadDir, 'frame.candidates.f32'));
assert.equal(relativeCombined.frames[0].target.path, join(relativeBroadDir, 'frame.target.png'));
assert.equal(relativeCombined.frames[0].flowDebug.path, join(relativeBroadDir, 'frame.flow-debug.png'));
assert.equal(relativeCombined.frames[0].structuralSupervision.fields.structure.path, join(relativeBroadDir, 'frame.sidecar-structure.f32'));
assert.equal(relativeCombined.frames[1].structuralSupervision.fields.meta.path, join(relativeNarrowDir, 'frame.sidecar-meta.f32'));

const aliasedPath = join(root, 'aliased-output.json');
await assert.rejects(
  composeBoundarySplatSupervisionCorpora({
    cohorts: [
      { label: 'broad', manifestPath: broadPath },
      { label: 'narrow', manifestPath: narrowPath },
    ],
    outPath: aliasedPath,
    reportPath: aliasedPath,
  }),
  /output and report paths must differ/,
);

console.log('boundary splat supervision compose contracts passed');
