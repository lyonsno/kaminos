import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { verifyAuthoringServer } from '../scene-authoring-witness-identity.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requiredSources = [
  'index.html', 'serve.py', 'volume-settings-preset-contract.mjs', 'volume-core.js', 'sf3d-host-device.mjs',
  'sf3d-live-flame-inject.mjs', 'lib/sf3d/sf3d-producer.js',
  'sf3d-shared-device-smoke.mjs', 'sf3d-kiln-save-reopen-witness.mjs',
];

function response(body, status = 200) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  return { ok: status >= 200 && status < 300, status, json: async () => JSON.parse(bytes), arrayBuffer: async () => bytes };
}

function sourceServer({ mismatch = null } = {}) {
  return async url => {
    const route = new URL(url).pathname;
    if (route === '/api/runtime-config') return response({ source: { repoRoot: root } });
    if (route === '/api/roots') return response({ scenes: { exists: true, path: path.join(root, 'scenes') } });
    if (route === '/api/volume-settings-presets') return response({ storePath: path.join(root, '.settings-presets') });
    const name = route.slice(1);
    const bytes = await readFile(path.join(root, name));
    return response(name === mismatch ? Buffer.concat([bytes, Buffer.from('\nserved-drift')]) : bytes);
  };
}

test('authoring server identity hashes the served kiln, volume, and SF3D implementation sources', async () => {
  const identity = await verifyAuthoringServer({ origin: 'http://kaminos.test', repoRoot: root, fetch: sourceServer() });
  for (const name of requiredSources) assert.match(identity.hashes[name], /^[0-9a-f]{64}$/);
});

test('authoring witness refuses a mismatched served SF3D producer instead of blessing route identity alone', async () => {
  await assert.rejects(
    verifyAuthoringServer({ origin: 'http://kaminos.test', repoRoot: root, fetch: sourceServer({ mismatch: 'lib/sf3d/sf3d-producer.js' }) }),
    /Served source differs from reviewed checkout: lib\/sf3d\/sf3d-producer\.js/,
  );
});
