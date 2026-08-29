import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const packageRoot = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, packageRoot), 'utf8');

const [packageSource, readme, indexSource] = await Promise.all([
  read('package.json'),
  read('README.md'),
  read('src/index.js'),
]);
const packageJson = JSON.parse(packageSource);

assert.equal(
  packageJson.files.includes('docs'),
  true,
  'the npm package must ship the documentation linked from its public README',
);

for (const path of [
  'docs/model-port.md',
  'docs/minimal-model-port.md',
  'docs/integration-reference.md',
]) {
  await read(path);
  assert.match(readme, new RegExp(`\\(${path.replaceAll('.', '\\.') }\\)`));
}

assert.doesNotMatch(readme, /SHARP-class/i);
assert.match(readme, /SHARP generated `1,179,648` Gaussian splats/);

if (!indexSource.includes('defineWebGpuModelPort')) {
  assert.doesNotMatch(
    readme,
    /defineWebGpuModelPort\s*\(/,
    'the README must not present the target Model Port API as shipped before it is exported',
  );
}

const modelPortContract = await read('docs/model-port.md');
assert.match(modelPortContract, /Status:\*\* Design target/);
assert.match(modelPortContract, /WebGpuInferenceSession/);
assert.match(modelPortContract, /LoadedModel/);
assert.match(modelPortContract, /ModelRun/);
assert.doesNotMatch(modelPortContract, /createWebGpuRuntime|ModelSession/);

console.log('public documentation contracts passed');
