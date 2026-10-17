// kaminos-test: node
// Contracts for how the test runner treats a node_modules that is a link to
// another worktree's install. Running npm ci through such a link empties the
// shared install for every worktree that points at it, so the runner must
// never tell someone there to run it, and says plainly that the install is
// shared.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fixture, manifestOf, run, readReport, scopedEnv, PASS, CLI, cliEnv } from './test-runner-fixtures.mjs';

async function withInstall(t, f, { linked, installed }) {
  await fs.writeFile(path.join(f.root, 'package.json'), JSON.stringify({ name: 'fixture', dependencies: { 'fake-dep': '1.0.0' } }));
  let dir = path.join(f.root, 'node_modules');
  if (linked) {
    const owner = await fs.mkdtemp(path.join(os.tmpdir(), 'kaminos-owner-'));
    t.after(() => fs.rm(owner, { recursive: true, force: true }));
    dir = path.join(owner, 'node_modules');
    await fs.mkdir(dir, { recursive: true });
    await fs.symlink(dir, path.join(f.root, 'node_modules'));
  } else {
    await fs.mkdir(dir, { recursive: true });
  }
  if (installed) {
    await fs.mkdir(path.join(dir, 'fake-dep'), { recursive: true });
    await fs.writeFile(path.join(dir, 'fake-dep', 'package.json'), JSON.stringify({ name: 'fake-dep', version: '1.0.0' }));
  }
  return realpathSync.native(dir);
}

const files = { 'a.mjs': PASS };
const manifest = manifestOf({ 'tests/a.mjs': { kind: 'node' } });

test('a missing dependency behind a shared link never says to run npm ci there', async t => {
  const f = await fixture(t, { files, manifest });
  const target = await withInstall(t, f, { linked: true, installed: false });
  await run(f);
  const report = await readReport(f);
  assert.equal(report.failurePhase, 'dependencies');
  assert.doesNotMatch(report.error, /Run npm ci\./);
  assert.ok(report.error.includes(target), report.error);
  assert.match(report.error, /shared/);
  // Running npm ci or npm install anywhere that writes the shared directory
  // empties or changes it for every linked worktree; the only remedy is an
  // install of this worktree's own.
  assert.doesNotMatch(report.error, /npm (ci|install) in /);
  assert.match(report.error, /unlink node_modules/);
  assert.match(report.error, /then npm ci here/);
});

test('a dangling node_modules link is recorded as a link, and the remedy says to unlink it', async t => {
  const f = await fixture(t, { files, manifest });
  await fs.writeFile(path.join(f.root, 'package.json'), JSON.stringify({ name: 'fixture', dependencies: { 'fake-dep': '1.0.0' } }));
  const gone = path.join(f.root, 'gone', 'node_modules');
  await fs.symlink(gone, path.join(f.root, 'node_modules'));
  await run(f);
  const report = await readReport(f);
  assert.equal(report.effective.nodeModules.linkTarget, gone);
  assert.equal(report.effective.nodeModules.dangling, true);
  assert.doesNotMatch(report.error, /Run npm ci\./);
  assert.match(report.error, /unlink node_modules/);
});

test('a missing dependency in a worktree that owns its install still says to run npm ci', async t => {
  const f = await fixture(t, { files, manifest });
  await withInstall(t, f, { linked: false, installed: false });
  await run(f);
  const report = await readReport(f);
  assert.equal(report.failurePhase, 'dependencies');
  assert.match(report.error, /Run npm ci\./);
});

test('a shared install is recorded and named in the summary, without a warning', async t => {
  const f = await fixture(t, { files, manifest });
  const target = await withInstall(t, f, { linked: true, installed: true });
  await run(f);
  const report = await readReport(f);
  assert.equal(report.ok, true);
  assert.equal(report.effective.nodeModules.linkTarget, target);
  assert.deepEqual(report.warnings, []);
  const cli = spawnSync(process.execPath, [CLI, '--root', f.root, '--report', f.reportPath], { env: cliEnv(f), encoding: 'utf8' });
  assert.match(cli.stdout, new RegExp(`node_modules: shared install at ${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}; do not run npm ci or npm install here`));
});

test('an owned install is recorded with no link target', async t => {
  const f = await fixture(t, { files, manifest });
  await withInstall(t, f, { linked: false, installed: true });
  await run(f);
  const report = await readReport(f);
  assert.equal(report.effective.nodeModules.linkTarget, null);
});

// A worktree whose own node_modules other worktrees link to owns a shared
// install: npm ci there empties and rewrites it for all of them.
async function ownerWithDependent(t, f, { installed }) {
  const git = (...args) => spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { cwd: f.root, encoding: 'utf8' });
  git('init', '-q'); git('add', '-A'); git('commit', '-q', '-m', 'fixture');
  const sibling = await fs.mkdtemp(path.join(os.tmpdir(), 'kaminos-dependent-'));
  await fs.rm(sibling, { recursive: true, force: true });
  t.after(() => fs.rm(sibling, { recursive: true, force: true }));
  const added = git('worktree', 'add', '-q', '--detach', sibling);
  assert.equal(added.status, 0, added.stderr);
  await withInstall(t, f, { linked: false, installed });
  await fs.symlink(path.join(f.root, 'node_modules'), path.join(sibling, 'node_modules'));
  return realpathSync.native(sibling);
}

test('an install other worktrees link to is named as shared, and the remedy is not a bare npm ci', async t => {
  const f = await fixture(t, { files, manifest });
  const sibling = await ownerWithDependent(t, f, { installed: false });
  await run(f);
  const report = await readReport(f);
  assert.deepEqual(report.effective.nodeModules.linkedFrom, [sibling]);
  assert.doesNotMatch(report.error, /Run npm ci\./);
  assert.match(report.error, /1 other worktree/);
  assert.ok(report.error.includes(sibling), report.error);
});

test('the summary of an owner of a shared install says other worktrees use it', async t => {
  const f = await fixture(t, { files, manifest });
  await ownerWithDependent(t, f, { installed: true });
  const cli = spawnSync(process.execPath, [CLI, '--root', f.root, '--report', f.reportPath], { env: cliEnv(f), encoding: 'utf8' });
  assert.match(cli.stdout, /node_modules: used by 1 other worktree through a link; npm ci or npm install here changes it for them too/);
});

test('when git cannot say whether other worktrees link here, the remedy says it could not check instead of a bare npm ci', async t => {
  const f = await fixture(t, { files, manifest });
  await withInstall(t, f, { linked: false, installed: false });
  const empty = await fs.mkdtemp(path.join(os.tmpdir(), 'kaminos-no-git-'));
  t.after(() => fs.rm(empty, { recursive: true, force: true }));
  scopedEnv(t, 'PATH', empty);
  await run(f, { kinds: ['node'] });
  const report = await readReport(f);
  assert.equal(report.effective.nodeModules.linkedFrom, null);
  assert.doesNotMatch(report.error, /Run npm ci\./);
  assert.match(report.error, /could not check whether other worktrees link/);
});
