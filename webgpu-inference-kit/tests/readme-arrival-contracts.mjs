import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import * as kit from '../src/index.js';

const packageRoot = new URL('../', import.meta.url);
const readPackageFile = relativePath => readFile(new URL(relativePath, packageRoot), 'utf8');

const [readme, packageJson] = await Promise.all([
  readPackageFile('README.md'),
  readPackageFile('package.json').then(JSON.parse),
]);

assert.equal(typeof kit.createWebGpuInferenceSession, 'function');
assert.match(readme, /createWebGpuInferenceSession/);
assert.match(readme, /registerRoute/);
assert.match(readme, /route\.enqueue/);
assert.match(readme, /job\.completion/);
assert.match(readme, /completion\.status === ['"]succeeded['"]/);
assert.match(readme, /Ports can adopt a common application-facing shape/);
const modelRows = readme.split('\n').filter(line => line.startsWith('| ['));
for (const repo of ['moge-webgpu', 'sf3d-webgpu', 'sharp-webgpu', 'kimodo-webgpu']) {
  const rows = modelRows.filter(line => line.includes(`https://github.com/lyonsno/${repo})`));
  assert.equal(rows.length, 1, `${repo} must have one model-family row`);
  const columns = rows[0].split('|').slice(1, -1).map(value => value.trim());
  assert.equal(columns.length, 3, `${repo} must name the port, output, and integration`);
  assert.ok(columns.every(Boolean), `${repo} must populate every column`);
}
assert.match(modelRows.find(line => line.includes('/kimodo-webgpu)')), /text embeddings.*external server/i);
const samRows = modelRows.filter(line => line.includes('[SAM 3.1]'));
assert.equal(samRows.length, 1, 'SAM 3.1 must have one model-family row');
assert.match(samRows[0], /image and text prompt/i);
assert.match(samRows[0], /cached image features/i);
assert.match(readme, /complete browser WebGPU route/i);
assert.match(readme, /same-device foreground submissions/i);
assert.match(readme, /not a frame-pacing claim/i);
assert.doesNotMatch(readme, /In development: SAM/i);
assert.doesNotMatch(readme, /foreground rendering is the next integration target/i);
assert.doesNotMatch(readme, /These ports share a common application-facing shape/);
assert.doesNotMatch(readme, /That firing exercises the architecture.*persistent model resources/);

assert.doesNotMatch(readme, /\b(?:loadModelPort|LoadedModel|ModelRun)\b/);
assert.doesNotMatch(readme, /^## Receipt And Evidence Layer$/m);

assert.equal(packageJson.version, '0.1.52');
assert.ok(packageJson.files.includes('docs'), 'published package must include linked documentation');
assert.ok(packageJson.files.includes('examples'), 'published package must include the runnable example');

const integrationReference = await readPackageFile('docs/integration-reference.md');
assert.match(integrationReference, /^# @kaminos\/webgpu-inference-kit$/m);
assert.match(integrationReference, /^## Start Here When Porting A Long Model$/m);
assert.ok(readme.length < integrationReference.length, 'README must compress rather than duplicate the advanced manual');

const localLinks = [...readme.matchAll(/\]\(([^)]+)\)/g)]
  .map(match => match[1])
  .filter(target => !/^(?:[a-z]+:|#)/i.test(target));
assert.ok(localLinks.includes('./docs/integration-reference.md'));
assert.ok(localLinks.includes('./docs/getting-started.md'));
for (const target of localLinks) {
  await access(fileURLToPath(new URL(target, new URL('README.md', packageRoot))));
}

console.log('README arrival contracts passed');
