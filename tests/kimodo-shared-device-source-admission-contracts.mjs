import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  KIT_REGISTRY_IDENTITY,
  collectIdentityMap,
  verifyIdentityMap,
  verifyRuntimeKitSource,
} from '../kimodo-shared-device-source-admission.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'kimodo-source-admission-'));
try {
  const bundleRoot = join(scratch, 'lib');
  const assetRoot = join(scratch, 'assets');
  const kitRoot = join(scratch, 'kit');
  mkdirSync(bundleRoot, { recursive: true });
  mkdirSync(assetRoot, { recursive: true });
  mkdirSync(join(kitRoot, 'src'), { recursive: true });

  writeFileSync(join(bundleRoot, 'producer.js'), 'export const producer = true;\n');
  writeFileSync(join(bundleRoot, 'telemetry.js'), 'export const telemetry = true;\n');
  writeFileSync(join(assetRoot, 'kimodo.json'), '{"shape":"test"}\n');
  writeFileSync(join(assetRoot, 'kimodo.bin'), Buffer.from([1, 2, 3, 4]));
  writeFileSync(join(kitRoot, 'package.json'), `${JSON.stringify({ version: KIT_REGISTRY_IDENTITY.version })}\n`);
  writeFileSync(join(kitRoot, 'src/index.js'), 'export const kit = true;\n');
  writeFileSync(join(kitRoot, 'src/runtime.js'), 'export const runtime = true;\n');

  const bundles = collectIdentityMap(bundleRoot);
  const assets = collectIdentityMap(assetRoot);
  const runtimeKit = {
    ...KIT_REGISTRY_IDENTITY,
    files: collectIdentityMap(join(kitRoot, 'src')),
  };

  assert.deepEqual(verifyIdentityMap({ root: bundleRoot, identities: bundles, label: 'bundle' }), bundles);
  assert.deepEqual(verifyIdentityMap({ root: assetRoot, identities: assets, label: 'asset' }), assets);
  assert.deepEqual(verifyRuntimeKitSource({ packageRoot: kitRoot, runtimeKit }), runtimeKit);

  writeFileSync(join(bundleRoot, 'producer.js'), 'export const producer = false;\n');
  assert.throws(
    () => verifyIdentityMap({ root: bundleRoot, identities: bundles, label: 'bundle' }),
    /bundle identity mismatch: producer\.js/,
    'mutated producer bytes cannot inherit admitted source identity',
  );
  writeFileSync(join(bundleRoot, 'producer.js'), 'export const producer = true;\n');

  writeFileSync(join(bundleRoot, 'telemetry.js'), 'export const telemetry = false;\n');
  assert.throws(
    () => verifyIdentityMap({ root: bundleRoot, identities: bundles, label: 'bundle' }),
    /bundle identity mismatch: telemetry\.js/,
    'mutated telemetry bytes cannot inherit admitted source identity',
  );
  writeFileSync(join(bundleRoot, 'telemetry.js'), 'export const telemetry = true;\n');

  writeFileSync(join(assetRoot, 'kimodo.json'), '{"shape":"different"}\n');
  assert.throws(
    () => verifyIdentityMap({ root: assetRoot, identities: assets, label: 'asset' }),
    /asset identity mismatch: kimodo\.json/,
    'mutated JSON metadata cannot inherit admitted model identity',
  );
  writeFileSync(join(assetRoot, 'kimodo.json'), '{"shape":"test"}\n');

  writeFileSync(join(assetRoot, 'kimodo.bin'), Buffer.from([4, 3, 2, 1]));
  assert.throws(
    () => verifyIdentityMap({ root: assetRoot, identities: assets, label: 'asset' }),
    /asset identity mismatch: kimodo\.bin/,
    'mutated model weights cannot inherit admitted model identity',
  );

  writeFileSync(join(kitRoot, 'src/runtime.js'), 'export const runtime = false;\n');
  assert.throws(
    () => verifyRuntimeKitSource({ packageRoot: kitRoot, runtimeKit }),
    /inference-kit source identity mismatch: runtime\.js/,
    'a changed kit implementation cannot pass on the unchanged package version alone',
  );

  assert.throws(
    () => verifyRuntimeKitSource({
      packageRoot: kitRoot,
      runtimeKit: { ...runtimeKit, integrity: 'sha512-wrong' },
    }),
    /registry identity mismatch/,
    'the installed kit must retain the reviewed public-registry tarball identity',
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log('kimodo shared-device source admission contracts passed');
