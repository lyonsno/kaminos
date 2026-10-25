// kaminos-test: node
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {packU2NetModule} from '../scripts/pack-u2net-module.mjs';

const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'u2net-package-'));
try {
  const packed = await packU2NetModule({out: scratch, version: '0.2.3'});
  const manifest = JSON.parse(execFileSync('tar', ['-xOzf', packed.tarball, 'package/package.json'], {encoding: 'utf8'}));
  assert.equal(manifest.private, false, 'the U2Net release archive must be publishable');
  assert.deepEqual(manifest.publishConfig, {access: 'public'});
  assert.equal(manifest.version, '0.2.3');
  assert.equal(manifest.dependencies, undefined, 'U2Net includes its runtime');
  const app = path.join(scratch, 'app');
  await fs.mkdir(app);
  await fs.writeFile(path.join(app, 'package.json'), JSON.stringify({private: true, type: 'module'}));
  execFileSync('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', packed.tarball], {cwd: app, stdio: 'pipe'});
  const require = createRequire(path.join(app, 'package.json'));
  const entry = require.resolve('@kaminos/u2net');
  const api = await import(pathToFileURL(entry).href);
  for (const name of ['createU2NetApp', 'loadU2NetPackage', 'createU2NetRunner', 'removeForegroundU2Net']) {
    assert.equal(typeof api[name], 'function', `installed package exposes ${name}`);
  }
  for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.txt']) {
    assert.deepEqual(await fs.readFile(path.join(path.dirname(entry), file)),
      await fs.readFile(new URL(`../webgpu-inference-kit/${file}`, import.meta.url)));
  }
  console.log('U2Net publishable archive and outside-install exports: PASS');
} finally {
  await fs.rm(scratch, {recursive: true, force: true});
}
