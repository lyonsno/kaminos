import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as packageNamespace from '../src/index.js';

const packageRoot = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, packageRoot), 'utf8');

const [packageSource, readme, minimalModelPort, integrationReference] = await Promise.all([
  read('package.json'),
  read('README.md'),
  read('docs/minimal-model-port.md'),
  read('docs/integration-reference.md'),
]);
const packageJson = JSON.parse(packageSource);

function extractPackageImports(markdown) {
  const imports = [];
  const executableCode = [...markdown.matchAll(
    /```(?:js|mjs|javascript|ts|typescript)\s*\n([\s\S]*?)```/g,
  )]
    .map(match => match[1])
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const pattern = /^import\s*\{([\s\S]*?)\}\s*from\s*["']@kaminos\/webgpu-inference-kit["'];?/gm;
  for (const match of executableCode.matchAll(pattern)) {
    for (const specifier of match[1].split(',')) {
      const imported = specifier.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0];
      if (imported) imports.push(imported);
    }
  }
  return imports;
}

function assertPackageImportsResolve(markdown, label, namespace = packageNamespace) {
  const imports = extractPackageImports(markdown);
  assert.notEqual(imports.length, 0, `${label} must contain at least one package import`);
  for (const imported of imports) {
    assert.equal(
      Object.hasOwn(namespace, imported),
      true,
      `${label} imports nonexistent package export ${imported}`,
    );
    if (/^(create|define|run|validate)[A-Z]/.test(imported)) {
      assert.equal(typeof namespace[imported], 'function', `${label} export ${imported} must be callable`);
    }
  }
}

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

assertPackageImportsResolve(readme, 'README');
assertPackageImportsResolve(minimalModelPort, 'minimal Model Port guide');
assertPackageImportsResolve(integrationReference, 'integration reference');

assert.deepEqual(
  extractPackageImports(`\`\`\`js
/* import { defineWebGpuModelPort } from "@kaminos/webgpu-inference-kit"; */
// import { defineWebGpuModelPort } from "@kaminos/webgpu-inference-kit";
\`\`\``),
  [],
  'a commented import must not count as a live package example',
);
assert.throws(
  () => assertPackageImportsResolve(
    '```js\nimport { missingWebGpuExport } from "@kaminos/webgpu-inference-kit";\n```',
    'nonexistent-import fixture',
  ),
  /nonexistent package export missingWebGpuExport/,
);
assert.throws(
  () => assertPackageImportsResolve(
    '```js\nimport { defineWebGpuModelPort } from "@kaminos/webgpu-inference-kit";\n```',
    'substring-only fixture',
    { defineWebGpuModelPortComment: () => {} },
  ),
  /nonexistent package export defineWebGpuModelPort/,
);
assert.throws(
  () => assertPackageImportsResolve(
    '```js\nimport { defineWebGpuModelPort } from "@kaminos/webgpu-inference-kit";\n```',
    'non-callable fixture',
    { defineWebGpuModelPort: 'design target' },
  ),
  /must be callable/,
);

if (typeof packageNamespace.defineWebGpuModelPort !== 'function') {
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

const missingLifecycleContracts = [
  ['device-independent requirements', /deviceRequirements/],
  ['pre-device multi-port union', /modelPorts:\s*\[myModelPort, auxiliaryPort\]/],
  ['fixed-device load validation', /never replaces or silently reacquires the session device/],
  ['borrowed-device preservation', /borrowed `GPUDevice` remains caller-owned/],
  ['public loaded-model close', /await model\.close\(\)/],
  ['strict session close', /session\.close\(\).*refuses.*active/si],
  ['partial-load rollback', /construction cleanup stack/],
  ['explicit output transfer', /successful output transfers from `ModelRun` to the caller/],
  ['public ModelRun return', /start\(\).*returns a `ModelRun`/s],
  ['run convenience projection', /run\(\).*start\(\).*\.result/s],
  ['progress replay', /replays the current trustworthy snapshot/],
  ['coded cancellation', /MODEL_RUN_CANCELLED/],
  ['coded device loss', /WEBGPU_DEVICE_LOST/],
  ['terminal GPU settlement', /result.*submitted GPU work.*cleanup.*settled/si],
].filter(([, pattern]) => !pattern.test(modelPortContract)).map(([name]) => name);

assert.deepEqual(
  missingLifecycleContracts,
  [],
  `Model Port lifecycle contract is incomplete: ${missingLifecycleContracts.join(', ')}`,
);

console.log('public documentation contracts passed');
