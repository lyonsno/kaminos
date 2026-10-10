// The perf suite must stop, not keep measuring, when its checkout moves or is
// edited mid-run (observed: a commit landed in the suite's worktree mid-job).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { assertSource } from '../source-identity.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'supermat-source-'));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
fs.mkdirSync(path.join(root, 'models/supermat'), { recursive: true });
fs.writeFileSync(path.join(root, 'models/supermat/a.js'), '1');
git('add', '.'); git('commit', '-qm', 'one');
const first = git('rev-parse', 'HEAD');

assert.equal(assertSource(root, first, 'at start').commit, first);
fs.writeFileSync(path.join(root, 'models/supermat/a.js'), '2');
assert.throws(() => assertSource(root, first, 'after step x'), /source dirty after step x: M models\/supermat\/a.js/);
git('commit', '-qam', 'two');
assert.throws(() => assertSource(root, first, 'after step y'), /source moved after step y: HEAD [0-9a-f]{40}, expected/);
fs.writeFileSync(path.join(root, 'unrelated.txt'), 'x');
assert.equal(assertSource(root, git('rev-parse', 'HEAD'), 'out of scope').dirty, '');
fs.rmSync(root, { recursive: true, force: true });
console.log('source identity contracts: 4 passed');
