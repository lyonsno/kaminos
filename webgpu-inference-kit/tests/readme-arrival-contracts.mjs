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

assert.doesNotMatch(readme, /\b(?:loadModelPort|LoadedModel|ModelRun)\b/);
assert.doesNotMatch(readme, /^## Receipt And Evidence Layer$/m);

assert.equal(packageJson.version, '0.1.44');
assert.ok(packageJson.files.includes('docs'), 'published package must include linked documentation');

const integrationReference = await readPackageFile('docs/integration-reference.md');
assert.match(integrationReference, /^# @kaminos\/webgpu-inference-kit$/m);
assert.match(integrationReference, /^## Start Here When Porting A Long Model$/m);
assert.ok(readme.length < integrationReference.length, 'README must compress rather than duplicate the advanced manual');

const localLinks = [...readme.matchAll(/\]\(([^)]+)\)/g)]
  .map(match => match[1])
  .filter(target => !/^(?:[a-z]+:|#)/i.test(target));
assert.ok(localLinks.includes('./docs/integration-reference.md'));
for (const target of localLinks) {
  await access(fileURLToPath(new URL(target, new URL('README.md', packageRoot))));
}

console.log('README arrival contracts passed');
