import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const fixturePath = fileURLToPath(new URL('fixtures/minimal-webgpu-test-device.mjs', import.meta.url));
const temporaryRoot = await mkdtemp(join(tmpdir(), 'kaminos-getting-started-consumer-'));

function run(command, args, cwd, env = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

try {
  const packOutput = JSON.parse(run(
    'npm',
    ['pack', packageRoot, '--pack-destination', temporaryRoot, '--json'],
    temporaryRoot,
  ));
  assert.equal(packOutput[0].version, '0.1.45');
  assert.ok(packOutput[0].files.some(row => row.path === 'docs/getting-started.md'));
  assert.ok(packOutput[0].files.some(row => row.path === 'examples/minimal-model-port.mjs'));
  assert.ok(packOutput[0].files.some(row => row.path === 'examples/minimal-model-port-runner.mjs'));

  const tarball = join(temporaryRoot, packOutput[0].filename);
  await writeFile(join(temporaryRoot, 'package.json'), '{"type":"module","private":true}\n');
  run('npm', ['install', '--ignore-scripts', '--no-package-lock', tarball], temporaryRoot);
  await copyFile(fixturePath, join(temporaryRoot, 'fake-device.mjs'));
  await writeFile(join(temporaryRoot, 'consumer.mjs'), `
import { runMinimalModelPort } from '@kaminos/webgpu-inference-kit/examples/minimal-model-port';
import { createMinimalWebGpuTestSurface } from './fake-device.mjs';

const surface = createMinimalWebGpuTestSurface();
const report = await runMinimalModelPort({
  gpu: surface.gpu,
  sessionId: 'getting-started-packed-consumer',
  jobIds: ['packed-a', 'packed-b'],
});
console.log(JSON.stringify({ report, calls: surface.calls }));
`);

  const nodePath = [join(temporaryRoot, 'node_modules'), process.env.NODE_PATH]
    .filter(Boolean)
    .join(delimiter);
  const output = run('node', ['consumer.mjs'], temporaryRoot, { NODE_PATH: nodePath });
  const result = JSON.parse(output.trim());
  assert.equal(result.report.status, 'succeeded');
  assert.deepEqual(result.report.outputs, [[1, 3, 5, 7], [9, 11, 13, 15]]);
  assert.equal(result.calls.computePipelineCreations, 1);

  const installedGuide = await readFile(
    join(temporaryRoot, 'node_modules/@kaminos/webgpu-inference-kit/docs/getting-started.md'),
    'utf8',
  );
  assert.match(installedGuide, /exact-source: examples\/minimal-model-port-runner\.mjs/);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log('getting started packed consumer contracts passed');
