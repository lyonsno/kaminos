// kaminos-test: node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', 'webgpu-inference-kit');
const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
assert.equal(manifest.license, 'MIT', 'the operator-selected MIT license must reach package consumers');
const out = await fs.mkdtemp(path.join(os.tmpdir(), 'kit-license-'));
try {
  const [packed] = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', out], { cwd: root, encoding: 'utf8' }));
  const archive = path.join(out, packed.filename);
  for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.txt']) {
    assert.ok(packed.files.some(entry => entry.path === file), `${file} must ship in the actual Kit tarball`);
    const bytes = execFileSync('tar', ['-xOzf', archive, `package/${file}`]);
    assert.deepEqual(bytes, await fs.readFile(path.join(root, file)), `${file} must retain its complete source notice`);
  }
  const license = await fs.readFile(path.join(root, 'LICENSE'), 'utf8');
  assert.match(license, /^MIT License/);
  assert.match(license, /Copyright \(c\) 2026 Noah Lyons/);
  const notice = await fs.readFile(path.join(root, 'THIRD_PARTY_NOTICES.txt'), 'utf8');
  assert.match(notice, /Copyright 2019 WebGPU Samples Contributors/);
  assert.match(notice, /BSD-3-Clause/);
  console.log('Kit MIT metadata and complete distributed license notices: PASS');
} finally { await fs.rm(out, { recursive: true, force: true }); }
