import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../scene-authoring-witness.mjs', import.meta.url), 'utf8');
const verified = source.indexOf('await verifyAuthoringServer(');
assert.ok(verified >= 0 && verified < source.indexOf("report.phase = 'lease'"),
  'serving identity must be checked before acquiring GPU resources or writing a fixture');
const { verifyAuthoringServer } = await import('../scene-authoring-witness-identity.mjs');
const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
let wrongRoot = false, wrongSource = false;
const fetch = async url => {
  const route = new URL(url).pathname;
  const payload = route === '/api/runtime-config' ? { source: { repoRoot: wrongRoot ? '/wrong' : root } }
    : route === '/api/roots' ? { scenes: { path: '/authored/scenes', exists: true } }
    : route === '/api/volume-settings-presets' ? { storePath: '/authored/basins' }
    : null;
  return { ok: true, json: async () => payload,
    arrayBuffer: async () => wrongSource ? Buffer.from('different checkout') : readFileSync(new URL(`..${route}`, import.meta.url)) };
};
const options = { origin: 'http://localhost:8106', repoRoot: root, fetch };
assert.equal((await verifyAuthoringServer(options)).sceneStore, '/authored/scenes');
wrongRoot = true;
await assert.rejects(verifyAuthoringServer(options), /checkout/);
wrongRoot = false; wrongSource = true;
await assert.rejects(verifyAuthoringServer(options), /source/);
console.log('scene authoring witness contracts passed');
