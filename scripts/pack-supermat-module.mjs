import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { buildSuperMatModule } from './build-supermat-module.mjs';

const exec = promisify(execFile);

export async function packSuperMatModule({ out, version = '0.1.1' } = {}) {
  if (typeof out !== 'string' || !out.trim()) throw new Error('SuperMat package output directory is required');
  const destination = path.resolve(out);
  await fs.mkdir(destination, { recursive: true });
  const stage = await fs.mkdtemp(path.join(os.tmpdir(), 'supermat-pack-'));
  try {
    await buildSuperMatModule(stage);
    await fs.cp(new URL('../models/supermat/examples/', import.meta.url), path.join(stage, 'examples'), { recursive: true });
    await fs.copyFile(new URL('../models/supermat/GETTING_STARTED.md', import.meta.url), path.join(stage, 'README.md'));
    await fs.copyFile(new URL('../models/supermat/LICENSE', import.meta.url), path.join(stage, 'LICENSE'));
    await fs.copyFile(new URL('../webgpu-inference-kit/THIRD_PARTY_NOTICES.txt', import.meta.url), path.join(stage, 'THIRD_PARTY_NOTICES.txt'));
    const manifest = {
      name: '@kaminos/supermat', version, private: false, publishConfig: { access: 'public' }, type: 'module', license: 'MIT',
      description: "SuperMat turns an RGBA image into albedo, roughness, and metallic maps on your application's GPU.",
      main: './supermat-inference.js',
      exports: { '.': './supermat-inference.js', './worker': './supermat-cpu-worker.js', './package.json': './package.json' },
      files: ['supermat-inference.js', 'supermat-cpu-worker.js', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.txt', 'examples'],
      repository: { type: 'git', url: 'git+https://github.com/lyonsno/kaminos.git', directory: 'models/supermat' },
      keywords: ['webgpu', 'supermat', 'inverse-rendering', 'material-estimation', 'roughness', 'metallic'],
    };
    await fs.writeFile(path.join(stage, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    const { stdout } = await exec('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', destination], { cwd: stage });
    const [packed] = JSON.parse(stdout);
    return { name: packed.name, version: packed.version, tarball: path.join(destination, packed.filename),
      integrity: packed.integrity, shasum: packed.shasum, files: packed.files };
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { out: { type: 'string' }, version: { type: 'string' }, json: { type: 'boolean' } } });
  const packed = await packSuperMatModule(values);
  console.log(values.json ? JSON.stringify(packed) : `packed ${packed.tarball}`);
}
