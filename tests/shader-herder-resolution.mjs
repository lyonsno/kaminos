// kaminos-test: node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('an explicit unavailable package override fails instead of selecting a machine checkout', () => {
  const selected = '/does-not-exist/shader-herder-package';
  const env = { ...process.env, SHADER_HERDER_ROOT: selected };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    `await import(${JSON.stringify(new URL('../tools/shader-herder.mjs', import.meta.url).href)});`],
  { env, encoding: 'utf8' });
  assert.ifError(result.error);
  assert.notEqual(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.ok(result.stderr.includes(selected), result.stderr);
});

test('the default bridge resolves the installed dependency without a developer override', async () => {
  const { shaderHerderSource } = await import('../tools/shader-herder.mjs');
  assert.equal(shaderHerderSource.requested, 'installed-package');
  assert.match(shaderHerderSource.entry, /\/node_modules\/@kaminos\/shader-herder\/src\/index\.mjs$/);
});
