// kaminos-test: node
// Klein can be installed and imported outside this checkout: models/flux2-klein/pack-klein.mjs packs
// the engine as @kaminos/flux2-klein, depending on @kaminos/webgpu-inference-kit instead of reaching
// into ../../webgpu-inference-kit, and an application in an unrelated directory installs both
// tarballs and imports Klein's public API.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'klein-package-'));
try {
  const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const packed = JSON.parse(run(process.execPath, [path.join(repoRoot, 'models/flux2-klein/pack-klein.mjs'), '--out', path.join(work, 'klein'), '--json'], repoRoot));
  assert.ok(fs.existsSync(packed.tarball), `pack-klein must report the tarball it wrote (${packed.tarball})`);

  // The staged package: Klein's engine files plus index.js, no demo page or tooling, and no import that
  // leaves the package except the kit's published entry.
  const staged = path.join(work, 'klein');
  const manifest = JSON.parse(fs.readFileSync(path.join(staged, 'package.json'), 'utf8'));
  assert.equal(manifest.name, '@kaminos/flux2-klein');
  assert.equal(manifest.type, 'module');
  assert.equal(manifest.private, true, 'publication is an operator decision; the package must not be publishable by accident');
  assert.ok(manifest.dependencies['@kaminos/webgpu-inference-kit'], 'Klein must depend on the kit package');
  const files = fs.readdirSync(staged).filter(f => f.endsWith('.js')).sort();
  for (const required of ['index.js', 'klein-pipeline.js', 'klein-weights.js', 'qwen-tokenizer.js']) assert.ok(files.includes(required), `${required} must ship`);
  for (const absent of ['klein-demo.js', 'run-generate.mjs', 'cdp-harness.mjs']) assert.ok(!files.includes(absent), `${absent} must not ship`);
  for (const file of files) {
    for (const [, spec] of fs.readFileSync(path.join(staged, file), 'utf8').matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      assert.ok(spec.startsWith('./') || spec === '@kaminos/webgpu-inference-kit/core', `${file} imports ${spec}, which an installed package cannot resolve`);
    }
  }

  // An unrelated application installs the kit and Klein from their tarballs and imports Klein.
  const kitTarball = path.join(work, run('npm', ['pack', '--silent', '--pack-destination', work], path.join(repoRoot, 'webgpu-inference-kit')).trim().split('\n').pop());
  const app = path.join(work, 'app');
  fs.mkdirSync(app);
  fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'klein-consumer', private: true, type: 'module' }));
  run('npm', ['install', '--offline', '--no-audit', '--no-fund', kitTarball, packed.tarball], app);
  const probe = `import * as klein from '@kaminos/flux2-klein';
const names = ['KleinPipeline', 'kleinWeightUrls', 'kleinWeightStatus', 'KLEIN_HOSTED_WEIGHTS', 'KLEIN_LEVELS', 'WEIGHT_CACHE'];
const pipeline = new klein.KleinPipeline({ queue: {}, limits: {} });
console.log(JSON.stringify({ missing: names.filter(n => !(n in klein)), urls: pipeline.urls, destroy: typeof pipeline.destroy }));`;
  const result = JSON.parse(run(process.execPath, ['--input-type=module', '-e', probe], app));
  assert.deepEqual(result.missing, []);
  assert.equal(result.urls.transformerUrl, 'https://huggingface.co/BasinShapers/flux2-klein-4b-webgpu/resolve/main/dit');
  assert.equal(result.destroy, 'function');
  console.log('klein package contracts passed');
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
