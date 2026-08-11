import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  CAST_CLEANUP_REPORT_SCHEMA,
  CAST_CLEANUP_SPEC_SCHEMA,
  buildCastCleanupSpec,
  validateCastCleanupReport,
} from '../cast-cleanup-core.mjs';

const SOURCE_SHA = 'a'.repeat(64);
const SCRIPT_SHA = 'b'.repeat(64);

function makeSpec() {
  return buildCastCleanupSpec({
    sourcePath: '/observed/mannequin-80413.glb',
    sourceSha256: SOURCE_SHA,
    sourceByteLength: 8_400_000,
    sourceGeometry: {
      vertexCount: 148_476,
      triangleCount: 127_143,
      connectedComponentCount: 24_032,
      bounds: {
        min: [-0.1565, -0.3864, -0.5002],
        max: [0.1576, 0.3834, 0.4993],
        extent: [0.3141, 0.7698, 0.9995],
      },
    },
    blenderScriptPath: '/observed/blender-cast-cleanup.py',
    blenderScriptSha256: SCRIPT_SHA,
    outputDirectory: '/observed/output',
  });
}

function output(profileId) {
  const profileHashByte = { gentle: '1', balanced: '2', strong: '3' }[profileId];
  const viewHashByte = { left: '4', right: '5', front: '6', rear: '7' };
  return {
    profileId,
    path: `/observed/output/${profileId}/cast.glb`,
    sha256: profileHashByte.repeat(64),
    byteLength: 120_000,
    geometry: {
      vertexCount: 20_000,
      triangleCount: 39_996,
      connectedComponentCount: 1,
      bounds: {
        min: [-0.15, -0.38, -0.49],
        max: [0.15, 0.38, 0.49],
        extent: [0.3, 0.76, 0.98],
      },
    },
    renders: ['left', 'right', 'front', 'rear'].map(viewId => ({
      viewId,
      path: `/observed/output/${profileId}/renders/${viewId}.png`,
      sha256: viewHashByte[viewId].repeat(64),
      byteLength: 50_000,
    })),
  };
}

function successReport(spec = makeSpec()) {
  return {
    schema: CAST_CLEANUP_REPORT_SCHEMA,
    status: 'succeeded',
    requestedRoute: {
      id: 'kaminos_blender_cast_cleanup',
      sourcePath: spec.source.path,
      sourceSha256: spec.source.sha256,
      specSha256: spec.specSha256,
    },
    effectiveRoute: {
      id: 'blender-cast-cleanup-v0',
      blenderVersion: '5.1.2',
      sourcePath: spec.source.path,
      sourceSha256: spec.source.sha256,
      scriptPath: spec.worker.path,
      scriptSha256: spec.worker.sha256,
      specSha256: spec.specSha256,
    },
    sourceWitness: {
      geometry: structuredClone(spec.source.geometry),
    },
    outputs: spec.profiles.map(profile => output(profile.id)),
    failurePhase: null,
    lastTrustworthyEvidence: 'All output bytes and matched-view renders were hashed after export',
  };
}

test('cleanup spec binds the observed source and orders three scale-derived profiles', () => {
  const spec = makeSpec();

  assert.equal(spec.schema, CAST_CLEANUP_SPEC_SCHEMA);
  assert.equal(spec.source.sha256, SOURCE_SHA);
  assert.equal(spec.source.geometry.connectedComponentCount, 24_032);
  assert.deepEqual(spec.profiles.map(profile => profile.id), ['gentle', 'balanced', 'strong']);
  assert.ok(spec.profiles[0].voxelSize < spec.profiles[1].voxelSize);
  assert.ok(spec.profiles[1].voxelSize < spec.profiles[2].voxelSize);
  for (const profile of spec.profiles) {
    assert.equal(profile.voxelSize, spec.source.geometry.bounds.extent[2] * profile.voxelSizeToMaxExtent);
    assert.equal(profile.componentPolicy, 'largest-connected-surface');
  }
  assert.match(spec.specSha256, /^[0-9a-f]{64}$/);
});

test('successful report requires exact source, worker, spec, complete outputs, and four matched views', () => {
  const spec = makeSpec();
  const report = successReport(spec);

  assert.deepEqual(validateCastCleanupReport(report, spec), {
    accepted: true,
    status: 'succeeded',
    profileIds: ['gentle', 'balanced', 'strong'],
  });

  const wrongSource = structuredClone(report);
  wrongSource.effectiveRoute.sourceSha256 = '0'.repeat(64);
  assert.throws(() => validateCastCleanupReport(wrongSource, spec), /effective source hash/i);

  const partial = structuredClone(report);
  partial.outputs[1].renders.pop();
  assert.throws(() => validateCastCleanupReport(partial, spec), /matched views/i);

  const staleSpec = structuredClone(report);
  staleSpec.effectiveRoute.specSha256 = '0'.repeat(64);
  assert.throws(() => validateCastCleanupReport(staleSpec, spec), /effective spec hash/i);

  const contaminatedImport = structuredClone(report);
  contaminatedImport.sourceWitness.geometry.vertexCount += 8;
  contaminatedImport.sourceWitness.geometry.triangleCount += 12;
  assert.throws(() => validateCastCleanupReport(contaminatedImport, spec), /source witness vertex count/i);
});

test('failure reports fail loud with a phase and last trustworthy evidence', () => {
  const spec = makeSpec();
  const failed = successReport(spec);
  failed.status = 'failed';
  failed.outputs = [];
  failed.failurePhase = 'voxel-remesh-balanced';
  failed.lastTrustworthyEvidence = 'Gentle export completed; balanced remesh raised RuntimeError';

  assert.deepEqual(validateCastCleanupReport(failed, spec), {
    accepted: false,
    status: 'failed',
    failurePhase: 'voxel-remesh-balanced',
  });

  const silent = structuredClone(failed);
  silent.lastTrustworthyEvidence = '';
  assert.throws(() => validateCastCleanupReport(silent, spec), /last trustworthy evidence/i);
});

test('pre-spec source-verification failure is admitted only as rejected unverified evidence', () => {
  const spec = makeSpec();
  const failed = {
    schema: CAST_CLEANUP_REPORT_SCHEMA,
    status: 'failed',
    requestedRoute: {
      id: 'kaminos_blender_cast_cleanup',
      sourcePath: spec.source.path,
      sourceSha256: 'unknown',
      specSha256: 'unknown',
    },
    effectiveRoute: {
      id: 'blender-cast-cleanup-v0',
      blenderVersion: '5.1.2',
      sourcePath: spec.source.path,
      sourceSha256: 'missing',
      scriptPath: spec.worker.path,
      scriptSha256: spec.worker.sha256,
      specSha256: 'unknown',
    },
    outputs: [],
    failurePhase: 'source-verification',
    lastTrustworthyEvidence: 'Worker started; no source identity was admitted',
  };

  assert.deepEqual(validateCastCleanupReport(failed, spec), {
    accepted: false,
    status: 'failed',
    failurePhase: 'source-verification',
    routeIdentity: 'unverified',
  });

  const falseLaterPhase = structuredClone(failed);
  falseLaterPhase.failurePhase = 'source-import';
  assert.throws(() => validateCastCleanupReport(falseLaterPhase, spec), /source-verification phase/i);

  const falseOutput = structuredClone(failed);
  falseOutput.outputs.push(output('gentle'));
  assert.throws(() => validateCastCleanupReport(falseOutput, spec), /cannot contain outputs/i);
});

test('preparation failure writes a durable phase report before primary output exists', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cast-cleanup-failure-'));
  const missingSource = join(directory, 'missing.glb');
  const outputDirectory = join(directory, 'output');
  const result = spawnSync(process.execPath, [
    new URL('../tools/prepare-cast-cleanup-assay.mjs', import.meta.url).pathname,
    '--source', missingSource,
    '--output-dir', outputDirectory,
  ], { encoding: 'utf8' });

  assert.notEqual(result.status, 0);
  const failure = JSON.parse(await readFile(join(outputDirectory, 'cleanup-preparation-failure.json'), 'utf8'));
  assert.equal(failure.status, 'failed');
  assert.equal(failure.failurePhase, 'preparation');
  assert.match(failure.error, /realpath|no such file/i);
  assert.match(failure.lastTrustworthyEvidence, /no cleanup output was admitted/i);
});
