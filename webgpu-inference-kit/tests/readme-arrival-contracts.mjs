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
assert.match(readme, /Current kit adoption/);
assert.match(readme, /Ports can adopt a common application-facing shape/);
assert.match(readme, /tensor, kernel, runtime, and route primitives/i);
assert.match(readme, /runtime and route primitives around browser diffusion, with external text embedding/i);
assert.match(readme, /cooperative orchestration and model-owned bounded work/i);
assert.match(readme, /cooperative orchestration, scheduling, shared-device foreground opportunities, and route composition/i);
assert.doesNotMatch(readme, /These ports share a common application-facing shape/);
assert.doesNotMatch(readme, /That firing exercises the architecture.*persistent model resources/);

assert.doesNotMatch(readme, /\b(?:loadModelPort|LoadedModel|ModelRun)\b/);
assert.doesNotMatch(readme, /^## Receipt And Evidence Layer$/m);

assert.equal(packageJson.version, '0.1.45');
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
