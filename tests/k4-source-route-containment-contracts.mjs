import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  buildK4SourceRouteContainment,
  classifyRouteContainmentRow,
} from '../k4-source-route-containment-core.mjs';

const REPO_ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const TOOL = path.join(REPO_ROOT, 'tools/run-k4-source-route-containment-assay.mjs');

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sourceRoute(constructionId, positions) {
  return {
    constructionId,
    fields: {
      centerline: {
        state: 'candidate',
        candidates: [{
          authority: 'candidate',
          kind: 'source-curve-centerline',
          value: {
            sourcePathSha256: `${constructionId}-path`,
            resampledSamples: positions.map((position, index) => ({
              arcFraction: index / (positions.length - 1), position, radius: 1,
            })),
          },
        }],
      },
    },
  };
}

function cage(constructionId, restPositions, currentPositions, fixedSections = []) {
  const nodes = [];
  for (let index = 0; index < restPositions.length; index += 1) {
    const prefix = `${constructionId}:section:${String(index).padStart(4, '0')}`;
    nodes.push({
      id: `${prefix}:axis`,
      restPosition: restPositions[index],
      currentPosition: currentPositions[index],
    });
    nodes.push({
      id: `${prefix}:vertex:00`,
      restPosition: restPositions[index],
      currentPosition: currentPositions[index],
    });
  }
  return {
    constructionId,
    manifest: {
      sourceGeometry: {
        orderedSamples: restPositions.map((position, index) => ({ index, position, radius: 1 })),
      },
      nodes,
      constraints: {
        boundaryMasks: fixedSections.flatMap(index => {
          const prefix = `${constructionId}:section:${String(index).padStart(4, '0')}`;
          return [
            { nodeId: `${prefix}:axis`, fixed: true },
            { nodeId: `${prefix}:vertex:00`, fixed: true },
          ];
        }),
      },
    },
  };
}

function validShapeAssay({
  carrierSha256,
  frameReceiptSha256,
  frameReceiptFileSha256 = 'frame-file',
  envelopeFileSha256 = 'envelope-file',
  carrierFileSha256 = 'carrier-file',
  constructionSectionCounts,
}) {
  return {
    schema: 'kaminos.k4-envelope-clamped-shape-assay-result.v0',
    status: 'completed-provisional',
    shapeAuthority: 'envelope-fit-derived-provisional',
    inputs: {
      frameReceipt: { sha256: frameReceiptFileSha256 },
      envelope: { sha256: envelopeFileSha256 },
      carrier: { sha256: carrierFileSha256 },
    },
    shaping: {
      schema: 'kaminos.k4-envelope-clamped-section-shaping.v0',
      status: 'completed-provisional',
      sourceCarrierSha256: carrierSha256,
      frameReceiptSha256,
      sectionReceipts: Object.entries(constructionSectionCounts).flatMap(
        ([constructionId, count]) => Array.from({ length: count }, (_, index) => ({
          constructionId,
          sectionId: `${constructionId}:section:${String(index).padStart(4, '0')}`,
          status: 'shaped',
          nodeReceipts: [],
        })),
      ),
    },
  };
}

test('a packed-current escape from a contained source/rest route is packing-induced', () => {
  const result = classifyRouteContainmentRow({
    sourceSignedDistance: -0.4,
    restSignedDistance: -0.4,
    currentSignedDistance: 0.2,
    sourceToRestDrift: 0,
    tolerance: 1e-9,
  });
  assert.equal(result.classification, 'packing-induced-route-escape');
  assert.deepEqual(result.mechanisms, ['packing-displacement']);
});

test('fixture rest drift cannot hide behind matching route identity', () => {
  const result = classifyRouteContainmentRow({
    sourceSignedDistance: -0.3,
    restSignedDistance: 0.1,
    currentSignedDistance: 0.2,
    sourceToRestDrift: 0.25,
    tolerance: 1e-6,
  });
  assert.equal(result.classification, 'fixture-export-drift');
  assert.ok(result.mechanisms.includes('fixture-export-drift'));
});

test('requested constructions preserve caller order and never fall back to K4 defaults', () => {
  const parentAtlas = {
    schema: 'kaminos.authored-muscle-coordinate-parent-atlas.v0',
    id: 'atlas-test',
    source: { requestedBlendPath: '/read-only.blend', effectiveBlendPath: '/read-only.blend', blendSha256: 'blend' },
    sourceGraphIdentity: { graphSha256: 'graph' },
    routeInventory: [
      sourceRoute('muscle-a', [[0, 0, 0], [0, 0, 1]]),
      sourceRoute('muscle-b', [[0, 0, 0], [0, 0, 2]]),
      sourceRoute('muscle-c', [[0, 0, 0], [0, 0, 3]]),
    ],
  };
  const solverCarrier = {
    schema: 'kaminos.muscle-compartment-ring-cage-solver-carrier.v0',
    identity: { sha256: 'carrier-test' },
    cages: [
      cage('muscle-a', [[0, 0, 0], [0, 0, 1]], [[0, 0, 0], [0, 0, 1]]),
      cage('muscle-b', [[0, 0, 0], [0, 0, 2]], [[0, 0, 0], [0, 0, 2]]),
      cage('muscle-c', [[0, 0, 0], [0, 0, 3]], [[0, 0, 0], [0, 0, 3]]),
    ],
  };
  const result = buildK4SourceRouteContainment({
    parentAtlas,
    frameReceipt: {
      schema: 'kaminos.k4-envelope-frame-binding-receipt.v0',
      receiptSha256: 'frame-test',
      sourceToEnvelope: {
        authority: 'fit-derived-provisional',
        transform: {
          scale: 1,
          rotation: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
          translation: [0, 0, 0],
        },
      },
    },
    envelopeMesh: {},
    solverCarrier,
    shapeAssay: validShapeAssay({
      carrierSha256: 'carrier-test',
      frameReceiptSha256: 'frame-test',
      constructionSectionCounts: { 'muscle-c': 2, 'muscle-a': 2 },
    }),
    inputFileSha256s: {
      frameReceipt: 'frame-file',
      envelope: 'envelope-file',
      solverCarrier: 'carrier-file',
    },
    requestedConstructionIds: ['muscle-c', 'muscle-a'],
    tolerance: 1e-9,
    signedDistance: () => ({
      signedDistance: -0.5,
      inside: true,
      winding: 1,
    }),
  });
  assert.deepEqual(result.requestedConstructionIds, ['muscle-c', 'muscle-a']);
  assert.deepEqual(result.effectiveConstructionIds, ['muscle-c', 'muscle-a']);
  assert.deepEqual([...new Set(result.rows.map(row => row.constructionId))], ['muscle-c', 'muscle-a']);
});

test('shape receipts from a different carrier cannot classify the current fixture', () => {
  const parentAtlas = {
    schema: 'kaminos.authored-muscle-coordinate-parent-atlas.v0',
    id: 'atlas-test',
    source: {},
    sourceGraphIdentity: {},
    routeInventory: [sourceRoute('muscle-a', [[0, 0, 0], [0, 0, 1]])],
  };
  const solverCarrier = {
    schema: 'kaminos.muscle-compartment-ring-cage-solver-carrier.v0',
    identity: { sha256: 'carrier-a' },
    cages: [cage('muscle-a', [[0, 0, 0], [0, 0, 1]], [[0, 0, 0], [0, 0, 1]])],
  };
  assert.throws(() => buildK4SourceRouteContainment({
    parentAtlas,
    frameReceipt: {
      schema: 'kaminos.k4-envelope-frame-binding-receipt.v0',
      receiptSha256: 'frame-test',
      effectiveConstructionIds: ['muscle-a'],
      sourceToEnvelope: {
        authority: 'fit-derived-provisional',
        transform: {
          scale: 1,
          rotation: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
          translation: [0, 0, 0],
        },
      },
    },
    envelopeMesh: {},
    solverCarrier,
    shapeAssay: validShapeAssay({
      carrierSha256: 'carrier-b',
      frameReceiptSha256: 'frame-test',
      constructionSectionCounts: { 'muscle-a': 2 },
    }),
    inputFileSha256s: {
      frameReceipt: 'frame-file',
      envelope: 'envelope-file',
      solverCarrier: 'carrier-file',
    },
    requestedConstructionIds: ['muscle-a'],
    tolerance: 1e-9,
    signedDistance: () => ({ signedDistance: -1, inside: true, winding: 1 }),
  }), /shape assay carrier identity mismatch/);
});

test('missing or partial shape section receipts cannot become a completed comparison', () => {
  const parentAtlas = {
    schema: 'kaminos.authored-muscle-coordinate-parent-atlas.v0',
    id: 'atlas-test', source: {}, sourceGraphIdentity: {},
    routeInventory: [sourceRoute('muscle-a', [[0, 0, 0], [0, 0, 1]])],
  };
  const solverCarrier = {
    schema: 'kaminos.muscle-compartment-ring-cage-solver-carrier.v0',
    identity: { sha256: 'carrier-test' },
    cages: [cage('muscle-a', [[0, 0, 0], [0, 0, 1]], [[0, 0, 0], [0, 0, 1]])],
  };
  const shapeAssay = validShapeAssay({
    carrierSha256: 'carrier-test',
    frameReceiptSha256: 'frame-test',
    constructionSectionCounts: { 'muscle-a': 2 },
  });
  shapeAssay.shaping.sectionReceipts.pop();
  assert.throws(() => buildK4SourceRouteContainment({
    parentAtlas,
    frameReceipt: {
      schema: 'kaminos.k4-envelope-frame-binding-receipt.v0',
      receiptSha256: 'frame-test',
      effectiveConstructionIds: ['muscle-a'],
      sourceToEnvelope: {
        authority: 'fit-derived-provisional',
        transform: {
          scale: 1,
          rotation: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
          translation: [0, 0, 0],
        },
      },
    },
    envelopeMesh: {}, solverCarrier, shapeAssay,
    inputFileSha256s: {
      frameReceipt: 'frame-file', envelope: 'envelope-file',
      solverCarrier: 'carrier-file',
    },
    requestedConstructionIds: ['muscle-a'], tolerance: 1e-9,
    signedDistance: () => ({ signedDistance: -1, inside: true, winding: 1 }),
  }), /shape assay section receipts/);
});

test('shape frame and recorded input hashes must match the effective comparison', () => {
  const parentAtlas = {
    schema: 'kaminos.authored-muscle-coordinate-parent-atlas.v0',
    id: 'atlas-test', source: {}, sourceGraphIdentity: {},
    routeInventory: [sourceRoute('muscle-a', [[0, 0, 0], [0, 0, 1]])],
  };
  const solverCarrier = {
    schema: 'kaminos.muscle-compartment-ring-cage-solver-carrier.v0',
    identity: { sha256: 'carrier-test' },
    cages: [cage('muscle-a', [[0, 0, 0], [0, 0, 1]], [[0, 0, 0], [0, 0, 1]])],
  };
  const base = {
    parentAtlas,
    frameReceipt: {
      schema: 'kaminos.k4-envelope-frame-binding-receipt.v0',
      receiptSha256: 'frame-test',
      effectiveConstructionIds: ['muscle-a'],
      sourceToEnvelope: {
        authority: 'fit-derived-provisional',
        transform: {
          scale: 1,
          rotation: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
          translation: [0, 0, 0],
        },
      },
    },
    envelopeMesh: {}, solverCarrier,
    inputFileSha256s: {
      frameReceipt: 'frame-file', envelope: 'envelope-file',
      solverCarrier: 'carrier-file',
    },
    requestedConstructionIds: ['muscle-a'], tolerance: 1e-9,
    signedDistance: () => ({ signedDistance: -1, inside: true, winding: 1 }),
  };
  const wrongFrame = validShapeAssay({
    carrierSha256: 'carrier-test', frameReceiptSha256: 'other-frame',
    constructionSectionCounts: { 'muscle-a': 2 },
  });
  assert.throws(() => buildK4SourceRouteContainment({
    ...base, shapeAssay: wrongFrame,
  }), /shape assay frame receipt identity mismatch/);
  const wrongEnvelope = validShapeAssay({
    carrierSha256: 'carrier-test', frameReceiptSha256: 'frame-test',
    envelopeFileSha256: 'other-envelope',
    constructionSectionCounts: { 'muscle-a': 2 },
  });
  assert.throws(() => buildK4SourceRouteContainment({
    ...base, shapeAssay: wrongEnvelope,
  }), /shape assay envelope file identity mismatch/);
});

test('parent-atlas hash refusal writes a durable pre-output failure report', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'kaminos-route-containment-'));
  const parent = path.join(directory, 'parent-atlas.json');
  const placeholder = path.join(directory, 'placeholder.json');
  const output = path.join(directory, 'result.json');
  const runReport = path.join(directory, 'run-report.json');
  const failure = path.join(directory, 'failure.json');
  await writeFile(parent, '{"schema":"kaminos.authored-muscle-coordinate-parent-atlas.v0"}\n');
  await writeFile(placeholder, '{}\n');
  const result = spawnSync(process.execPath, [
    TOOL,
    '--repo-root', REPO_ROOT,
    '--parent-atlas', parent,
    '--expected-parent-atlas-file-sha256', '0'.repeat(64),
    '--parent-atlas-locator', 'fixture://parent-atlas.json',
    '--frame-receipt', placeholder,
    '--expected-frame-receipt-file-sha256', '0'.repeat(64),
    '--frame-receipt-locator', 'fixture://frame-receipt.json',
    '--envelope', placeholder,
    '--expected-envelope-file-sha256', '0'.repeat(64),
    '--envelope-locator', 'fixture://envelope.glb',
    '--solver-carrier', placeholder,
    '--expected-solver-carrier-file-sha256', '0'.repeat(64),
    '--solver-carrier-locator', 'fixture://solver-carrier.json',
    '--shape-assay', placeholder,
    '--expected-shape-assay-file-sha256', '0'.repeat(64),
    '--shape-assay-locator', 'fixture://shape-assay.json',
    '--requested-constructions', 'muscle-34',
    '--tolerance', '1e-9',
    '--out', output,
    '--out-locator', 'fixture://result.json',
    '--report', runReport,
    '--report-locator', 'fixture://run-report.json',
    '--failure', failure,
  ], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.notEqual(result.status, 0, 'hash mismatch unexpectedly succeeded');
  const report = JSON.parse(await readFile(failure, 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.failurePhase, 'parent-atlas-hash');
  assert.deepEqual(report.requestedConstructionIds, ['muscle-34']);
  assert.equal(report.lastTrustworthyEvidence.parentAtlasRead, true);
});

test('a public-safe locator cannot impersonate different effective bytes', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'kaminos-route-locator-'));
  const parent = path.join(directory, 'parent-atlas.json');
  const placeholder = path.join(directory, 'placeholder.json');
  const output = path.join(directory, 'result.json');
  const runReport = path.join(directory, 'run-report.json');
  const failure = path.join(directory, 'failure.json');
  const parentBytes = Buffer.from('{"schema":"kaminos.authored-muscle-coordinate-parent-atlas.v0"}\n');
  await writeFile(parent, parentBytes);
  await writeFile(placeholder, '{}\n');
  const result = spawnSync(process.execPath, [
    TOOL,
    '--repo-root', REPO_ROOT,
    '--parent-atlas', parent,
    '--expected-parent-atlas-file-sha256', sha256(parentBytes),
    '--parent-atlas-locator', 'repo://definitely-not-the-parent-atlas.json',
    '--frame-receipt', placeholder,
    '--expected-frame-receipt-file-sha256', '0'.repeat(64),
    '--frame-receipt-locator', 'fixture://frame-receipt.json',
    '--envelope', placeholder,
    '--expected-envelope-file-sha256', '0'.repeat(64),
    '--envelope-locator', 'fixture://envelope.glb',
    '--solver-carrier', placeholder,
    '--expected-solver-carrier-file-sha256', '0'.repeat(64),
    '--solver-carrier-locator', 'fixture://solver-carrier.json',
    '--shape-assay', placeholder,
    '--expected-shape-assay-file-sha256', '0'.repeat(64),
    '--shape-assay-locator', 'fixture://shape-assay.json',
    '--requested-constructions', 'muscle-34',
    '--tolerance', '1e-9',
    '--out', output,
    '--out-locator', 'fixture://result.json',
    '--report', runReport,
    '--report-locator', 'fixture://run-report.json',
    '--failure', failure,
  ], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.notEqual(result.status, 0, 'false locator unexpectedly succeeded');
  const report = JSON.parse(await readFile(failure, 'utf8'));
  assert.equal(report.failurePhase, 'parent-atlas-locator');
  assert.match(report.error, /locator/);
});
