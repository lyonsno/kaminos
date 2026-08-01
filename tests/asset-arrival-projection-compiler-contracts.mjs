import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  ASSET_ARRIVAL_PROJECTION_REPORT_SCHEMA,
  ASSET_ARRIVAL_SOURCE_SCHEMA,
  buildAssetArrivalProjectionPlan,
  compileAssetArrivalProjections,
  validateAssetArrivalProjectionReport,
} from '../asset-arrival-projection-compiler-core.mjs';

const hash = digit => digit.repeat(64);
const identity = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

function sourceReceipt() {
  const roleIds = [
    'pelvic-parent-mass',
    'socket-cup',
    'head-ball',
    'axis',
    'collar-attachment-region',
    'proximal-support',
  ];
  return {
    schema: ASSET_ARRIVAL_SOURCE_SCHEMA,
    trackId: 'generator-relational-sensitivity',
    receiptId: 'operator-hip-arrival-001',
    asset: {
      id: 'relational-hip-fixture-v0',
      blendPath: '/authored/relational-hip-fixture-v0.blend',
      blendSha256: hash('a'),
    },
    parts: roleIds.map((roleId, index) => ({
      roleId,
      objectName: `KAMINOS_${roleId.toUpperCase().replaceAll('-', '_')}`,
      localFrame: identity,
      geometrySha256: hash(String((index + 1) % 10)),
    })),
    camera: {
      id: 'operator-hip-fixed-camera-v0',
      objectName: 'KAMINOS_FIXED_CAMERA',
      localFrame: identity,
      projection: 'orthographic',
      width: 384,
      height: 384,
      cameraSha256: hash('b'),
    },
    relation: {
      id: 'hip-head-offset-relation-v0',
      regionId: 'hip-cup-relation-region-v0',
      scalarId: 'hip_head_offset_along_socket_axis',
      axisPartRoleId: 'axis',
      participantRoleIds: ['socket-cup', 'head-ball', 'axis', 'collar-attachment-region'],
      parentValue: 0,
      delta: 0.125,
      lowerBound: -0.5,
      upperBound: 0.5,
      maxDelta: 0.125,
    },
    contract: {
      requiredPartRoleIds: roleIds,
    },
    variants: {
      parent: {
        relationValue: 0,
        sourceSceneId: 'scene-parent',
        sourceInputHash: hash('c'),
        sourceSpillover: 0,
        sourceChecks: { relationAddressable: true, cameraFrozen: true, unrelatedPartsFrozen: true },
      },
      positive: {
        relationValue: 0.125,
        sourceSceneId: 'scene-positive',
        sourceInputHash: hash('d'),
        sourceSpillover: 0,
        sourceChecks: { relationAddressable: true, cameraFrozen: true, unrelatedPartsFrozen: true },
      },
      negative: {
        relationValue: -0.125,
        sourceSceneId: 'scene-negative',
        sourceInputHash: hash('e'),
        sourceSpillover: 0,
        sourceChecks: { relationAddressable: true, cameraFrozen: true, unrelatedPartsFrozen: true },
      },
    },
    roleRegistry: roleIds.map((roleId, index) => ({
      roleId,
      maskValue: index + 1,
    })),
    route: {
      requestedRouteId: 'blender-eevee-cpu-projection-v0',
      supportsCpu: true,
      supportsRoleMask: true,
    },
  };
}

function renderer(overrides = {}) {
  return async request => ({
    effectiveRouteId: request.requestedRouteId,
    sourceInputHash: request.sourceInputHash,
    cameraHash: request.camera.cameraSha256,
    productConfigHash: request.productConfigHash,
    products: request.productKinds.map(kind => ({
      kind,
      mimeType: 'image/png',
      width: request.camera.width,
      height: request.camera.height,
      bytes: Buffer.from(`valid-${request.variant}-${kind}`),
    })),
    ...overrides,
  });
}

test('plan preserves the authored relation and constructs the exact six-cell matrix', () => {
  const plan = buildAssetArrivalProjectionPlan(sourceReceipt());
  assert.deepEqual(plan.cells.map(cell => cell.id), [
    'L_parent', 'L_positive', 'L_negative',
    'H_parent', 'H_positive', 'H_negative',
  ]);
  assert.equal(plan.relation.delta, 0.125);
  assert.equal(plan.trackId, 'generator-relational-sensitivity');
  assert.ok(plan.scope.genericSourceFields.includes('parts'));
  assert.ok(plan.scope.relationalTrackFields.includes('relation.participantRoleIds'));
  assert.deepEqual(plan.cells.find(cell => cell.id === 'L_parent').channelIds, [
    'clay', 'depth', 'normal',
  ]);
  assert.deepEqual(plan.cells.find(cell => cell.id === 'H_parent').channelIds, [
    'clay', 'depth', 'normal', 'semantic-role-mask',
  ]);
});

test('plan rejects missing named parts instead of inventing source geometry', () => {
  const receipt = sourceReceipt();
  receipt.parts = receipt.parts.filter(part => part.roleId !== 'socket-cup');
  assert.throws(
    () => buildAssetArrivalProjectionPlan(receipt),
    /missing contract-required semantic part socket-cup/,
  );
});

test('plan rejects the musculature track as an implicit L/H source', () => {
  const receipt = sourceReceipt();
  receipt.trackId = 'shape-bearing-musculature';
  assert.throws(
    () => buildAssetArrivalProjectionPlan(receipt),
    /serves only generator-relational-sensitivity/,
  );
});

test('plan rejects unsigned or asymmetric source variants', () => {
  const receipt = sourceReceipt();
  receipt.variants.positive.relationValue = 0.2;
  assert.throws(
    () => buildAssetArrivalProjectionPlan(receipt),
    /positive relation value/,
  );
});

test('compiler publishes base-identical L/H products and one H-only role mask', async () => {
  const root = await mkdtemp(join(tmpdir(), 'asset-arrival-'));
  const outDir = join(root, 'compiled');
  const report = await compileAssetArrivalProjections({
    source: sourceReceipt(),
    outDir,
    renderVariant: renderer(),
  });
  assert.equal(report.schema, ASSET_ARRIVAL_PROJECTION_REPORT_SCHEMA);
  assert.equal(report.status, 'published');
  assert.equal(report.projectionInvocations, 3);
  assert.equal(report.cells.length, 6);
  for (const variant of ['parent', 'positive', 'negative']) {
    const low = report.cells.find(cell => cell.id === `L_${variant}`);
    const high = report.cells.find(cell => cell.id === `H_${variant}`);
    assert.deepEqual(low.products.map(product => product.kind), ['clay', 'depth', 'normal']);
    assert.deepEqual(high.products.map(product => product.kind), [
      'clay', 'depth', 'normal', 'semantic-role-mask',
    ]);
    for (const kind of ['clay', 'depth', 'normal']) {
      assert.equal(
        low.products.find(product => product.kind === kind).sha256,
        high.products.find(product => product.kind === kind).sha256,
      );
    }
  }
  assert.equal(validateAssetArrivalProjectionReport(report).ok, true);
  assert.equal(JSON.parse(await readFile(join(outDir, 'projection-report.json'), 'utf8')).status, 'published');
});

test('compiler fails loud when effective route falls back', async () => {
  const root = await mkdtemp(join(tmpdir(), 'asset-arrival-route-'));
  const outDir = join(root, 'compiled');
  await assert.rejects(
    compileAssetArrivalProjections({
      source: sourceReceipt(),
      outDir,
      renderVariant: renderer({ effectiveRouteId: 'fallback-route' }),
    }),
    /effective route mismatch/,
  );
  const failure = JSON.parse(await readFile(`${outDir}.failure.json`, 'utf8'));
  assert.equal(failure.status, 'failed');
  assert.equal(failure.failure.phase, 'render-dispatch');
  await assert.rejects(stat(outDir));
});

test('compiler rejects stale source echoes and hidden output caps', async () => {
  for (const [name, override, message] of [
    ['stale', { sourceInputHash: hash('f') }, /source input hash mismatch/],
    ['capped', {
      products: ['clay', 'depth', 'normal', 'semantic-role-mask'].map(kind => ({
        kind,
        mimeType: 'image/png',
        width: 128,
        height: 128,
        bytes: Buffer.from(`capped-${kind}`),
      })),
    }, /dimensions do not match requested camera/],
  ]) {
    const root = await mkdtemp(join(tmpdir(), `asset-arrival-${name}-`));
    const outDir = join(root, 'compiled');
    await assert.rejects(
      compileAssetArrivalProjections({
        source: sourceReceipt(),
        outDir,
        renderVariant: renderer(override),
      }),
      message,
    );
    const failure = JSON.parse(await readFile(`${outDir}.failure.json`, 'utf8'));
    assert.equal(failure.failure.phase, 'product-validation');
  }
});

test('compiler rejects missing and blank products without publishing a partial result', async () => {
  for (const [name, products, message] of [
    ['missing', [
      { kind: 'clay', mimeType: 'image/png', width: 384, height: 384, bytes: Buffer.from('clay') },
    ], /product set is incomplete/],
    ['blank', ['clay', 'depth', 'normal', 'semantic-role-mask'].map(kind => ({
      kind,
      mimeType: 'image/png',
      width: 384,
      height: 384,
      bytes: kind === 'depth' ? Buffer.alloc(0) : Buffer.from(kind),
    })), /depth product is blank/],
  ]) {
    const root = await mkdtemp(join(tmpdir(), `asset-arrival-${name}-`));
    const outDir = join(root, 'compiled');
    await assert.rejects(
      compileAssetArrivalProjections({
        source: sourceReceipt(),
        outDir,
        renderVariant: renderer({ products }),
      }),
      message,
    );
    await assert.rejects(stat(outDir));
  }
});

test('successful rerun atomically replaces stale output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'asset-arrival-rerun-'));
  const outDir = join(root, 'compiled');
  await compileAssetArrivalProjections({ source: sourceReceipt(), outDir, renderVariant: renderer() });
  await writeFile(join(outDir, 'stale.txt'), 'must disappear');
  await compileAssetArrivalProjections({ source: sourceReceipt(), outDir, renderVariant: renderer() });
  await assert.rejects(readFile(join(outDir, 'stale.txt')));
  assert.equal(validateAssetArrivalProjectionReport(
    JSON.parse(await readFile(join(outDir, 'projection-report.json'), 'utf8')),
  ).ok, true);
});
