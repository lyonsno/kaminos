// Pack FLUX.2 [klein] as an installable package, @kaminos/flux2-klein, for applications outside this
// checkout. Stages the engine files (not the demo page, scene or tooling), rewrites their imports of
// ../../webgpu-inference-kit/src/*.js to the kit's published entry, @kaminos/webgpu-inference-kit/core,
// adds index.js with the public API, writes package.json and runs npm pack. Fails when a staged file
// still imports anything outside the package other than that entry.
// Usage: node pack-klein.mjs --out <staging dir> [--version 0.1.2] [--json]
// MIT-licensed; publish the staged directory with npm publish (publishConfig makes the scoped package public).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const out = path.resolve(opt('--out') ?? fail('--out <staging dir> is required'));
const KIT_ENTRY = '@kaminos/webgpu-inference-kit/core';
const FILES = ['klein-app.js', 'klein-pipeline.js', 'klein-transformer.js', 'klein-text-encoder.js', 'klein-vae.js', 'klein-kernels.js',
  'klein-duties.js', 'klein-schedule.js', 'klein-latent-preview.js', 'klein-weights.js', 'qwen-tokenizer.js'];

function fail(message) { console.error(`pack-klein: ${message}`); process.exit(1); }

const kitManifest = JSON.parse(fs.readFileSync(path.join(here, '../../webgpu-inference-kit/package.json'), 'utf8'));
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const file of FILES) {
  const source = fs.readFileSync(path.join(here, file), 'utf8')
    .replace(/(['"])\.\.\/\.\.\/webgpu-inference-kit\/src\/[\w-]+\.js\1/g, `'${KIT_ENTRY}'`);
  for (const [, spec] of source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
    const local = spec.startsWith('./') && fs.existsSync(path.join(here, spec)) && FILES.includes(path.basename(spec));
    if (!local && spec !== KIT_ENTRY) fail(`${file} imports ${spec}, which the package does not contain`);
  }
  fs.writeFileSync(path.join(out, file), source);
}
fs.writeFileSync(path.join(out, 'index.js'), `// FLUX.2 [klein] 4B text-to-image on WebGPU. See README.md.
export { createKleinApp, KLEIN_ROUTE_ID } from './klein-app.js';
export { KleinPipeline, kleinWeightStatus, gaussianNoise, transferBytes, WEIGHT_CACHE } from './klein-pipeline.js';
export { KLEIN_HOSTED_WEIGHTS, KLEIN_LEVELS, kleinWeightUrls } from './klein-weights.js';
`);
fs.copyFileSync(path.join(here, 'package-README.md'), path.join(out, 'README.md'));
fs.copyFileSync(path.join(here, 'LICENSE'), path.join(out, 'LICENSE'));
fs.copyFileSync(path.join(here, 'THIRD_PARTY_NOTICES.txt'), path.join(out, 'THIRD_PARTY_NOTICES.txt'));
const manifest = {
  name: '@kaminos/flux2-klein',
  version: opt('--version', '0.1.2'),
  description: 'FLUX.2 [klein] 4B text-to-image in the browser on WebGPU: text encoder, transformer and decoder as compute shaders.',
  license: 'MIT',
  repository: { type: 'git', url: 'git+https://github.com/lyonsno/kaminos.git', directory: 'models/flux2-klein' },
  homepage: 'https://lyonsno.github.io/kaminos/inference-kit/klein/',
  publishConfig: { access: 'public' },
  type: 'module',
  exports: { '.': './index.js' },
  files: ['index.js', ...FILES, 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.txt'],
  dependencies: { '@kaminos/webgpu-inference-kit': `^${kitManifest.version}` },
};
fs.writeFileSync(path.join(out, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
const name = execFileSync('npm', ['pack', '--silent', '--pack-destination', out], { cwd: out, encoding: 'utf8' }).trim().split('\n').pop();
const result = { staged: out, tarball: path.join(out, name), name: manifest.name, version: manifest.version, kit: manifest.dependencies };
console.log(args.includes('--json') ? JSON.stringify(result) : `packed ${result.tarball}`);
