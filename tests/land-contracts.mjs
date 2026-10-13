// kaminos-test: node
// Contracts for tools/land.mjs, the landing check that fast-forwards main only
// from a clean, rebased branch whose exact commit has a green run of the tests
// workflow. The fixture is a bare origin, a clone with main and a feature
// branch, and a stub gh that prints canned JSON. Nothing here reaches GitHub.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CI_WORKFLOW, RECEIPT_SCHEMA, execFileRunner, land, parseArgs, repoFromRemoteUrl } from '../tools/land.mjs';

const LAND_CLI = fileURLToPath(new URL('../tools/land.mjs', import.meta.url));
const REPO = 'example/fixture';
const quote = s => `'${String(s).replace(/'/g, `'\\''`)}'`;

// A bare origin holding main, a seed clone that can advance origin's main the
// way another lane would, and the clone under test on a feature branch one
// commit ahead of main. Git reads only the fixture's own config, so the
// machine's hooks and identity never take part.
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kaminos-land-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const gitconfig = path.join(dir, 'gitconfig');
  await fs.writeFile(gitconfig, '[user]\n\tname = Fixture\n\temail = fixture@example.invalid\n[commit]\n\tgpgsign = false\n');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const origin = path.join(dir, 'origin.git');
  const seed = path.join(dir, 'seed');
  const clone = path.join(dir, 'clone');
  const commit = async (cwd, name) => {
    await fs.writeFile(path.join(cwd, name), `${name}\n`);
    git(cwd, 'add', name);
    git(cwd, 'commit', '--quiet', '-m', name);
    return git(cwd, 'rev-parse', 'HEAD');
  };
  git(dir, 'init', '--quiet', '--bare', '--initial-branch=main', origin);
  git(dir, 'init', '--quiet', '--initial-branch=main', seed);
  const base = await commit(seed, 'base.txt');
  git(seed, 'remote', 'add', 'origin', origin);
  git(seed, 'push', '--quiet', 'origin', 'main');
  git(dir, 'clone', '--quiet', origin, clone);
  git(clone, 'checkout', '--quiet', '-b', 'feature');
  const sha = await commit(clone, 'feature.txt');

  // The stub gh records its arguments, runs a hook when one is present, then
  // prints the canned runs; a marker file makes it fail instead.
  const ghPath = path.join(dir, 'gh');
  const runsPath = path.join(dir, 'gh-runs.json');
  const callsPath = path.join(dir, 'gh-calls.log');
  const hookPath = path.join(dir, 'gh-after-query.sh');
  const failPath = path.join(dir, 'gh-fail');
  await fs.writeFile(ghPath, [
    '#!/bin/sh',
    '# Stands in for gh while tests/land-contracts.mjs runs.',
    `printf '%s\\n' "$*" >> ${quote(callsPath)}`,
    `if [ -f ${quote(hookPath)} ]; then sh ${quote(hookPath)} || exit 99; fi`,
    `if [ -f ${quote(failPath)} ]; then echo "gh: stub failure" >&2; exit 1; fi`,
    `cat ${quote(runsPath)}`,
    '',
  ].join('\n'));
  await fs.chmod(ghPath, 0o755);

  const calls = [];
  const base_run = execFileRunner({ env });
  const run = (executable, args, options) => { calls.push([path.basename(executable), ...args]); return base_run(executable, args, options); };
  const receiptPath = path.join(dir, 'receipts', 'receipt.json');
  return {
    dir, env, origin, seed, clone, base, sha, ghPath, receiptPath, calls,
    run: (over = {}) => ({ databaseId: 4242, status: 'completed', conclusion: 'success', workflowName: CI_WORKFLOW, headSha: sha, ...over }),
    ghRuns: runs => fs.writeFile(runsPath, `${JSON.stringify(runs)}\n`),
    ghRaw: text => fs.writeFile(runsPath, text),
    ghHook: script => fs.writeFile(hookPath, `${script}\n`),
    ghFail: () => fs.writeFile(failPath, ''),
    ghCalls: async () => { try { return (await fs.readFile(callsPath, 'utf8')).trim().split('\n').filter(Boolean); } catch { return []; } },
    originMain: () => git(origin, 'rev-parse', 'refs/heads/main'),
    advanceMain: async name => { const moved = await commit(seed, name); git(seed, 'push', '--quiet', 'origin', 'main'); return moved; },
    land: (options = {}) => land({ root: clone, remote: 'origin', repo: REPO, git: 'git', gh: ghPath, receiptPath, run, ...options }),
    pushes: () => calls.filter(c => c[0] === 'git' && c[1] === 'push').length,
    cli: args => new Promise(resolve => execFile(process.execPath, [LAND_CLI, ...args], { cwd: clone, env, encoding: 'utf8' },
      (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }))),
  };
}

const check = (receipt, name) => receipt.checks.find(c => c.name === name);

test('a dirty working tree refuses before anything is fetched or queried', async t => {
  const f = await fixture(t);
  await f.ghRuns([f.run()]);
  await fs.writeFile(path.join(f.clone, 'feature.txt'), 'edited\n');
  const { ok, receipt } = await f.land();
  assert.equal(ok, false);
  assert.equal(receipt.outcome, 'refused');
  assert.equal(receipt.reason, 'dirty-tree');
  assert.equal(check(receipt, 'clean-tree').result, 'fail');
  assert.match(receipt.message, /not clean/);
  assert.equal(check(receipt, 'fetch').result, 'skipped');
  assert.deepEqual(await f.ghCalls(), []);
  assert.equal(f.pushes(), 0);
  assert.equal(f.originMain(), f.base);

  // An untracked file is not clean either.
  await fs.writeFile(path.join(f.clone, 'feature.txt'), 'feature.txt\n');
  await fs.writeFile(path.join(f.clone, 'scratch.txt'), 'scratch\n');
  assert.equal((await f.land()).receipt.reason, 'dirty-tree');
});

test('a branch that does not contain current main refuses and says to rebase', async t => {
  const f = await fixture(t);
  await f.ghRuns([f.run()]);
  const moved = await f.advanceMain('other-lane.txt');
  const { ok, receipt } = await f.land();
  assert.equal(ok, false);
  assert.equal(receipt.outcome, 'refused');
  assert.equal(receipt.reason, 'not-rebased');
  assert.match(receipt.message, /rebase/i);
  assert.equal(check(receipt, 'fetch').result, 'pass');
  assert.equal(check(receipt, 'rebased').result, 'fail');
  assert.equal(receipt.main.before, moved, 'the fetch saw the moved main');
  assert.deepEqual(await f.ghCalls(), []);
  assert.equal(f.pushes(), 0);
  assert.equal(f.originMain(), moved);
});

test('no run of the tests workflow for the exact commit refuses', async t => {
  const f = await fixture(t);
  await f.ghRuns([]);
  let { ok, receipt } = await f.land();
  assert.equal(ok, false);
  assert.equal(receipt.outcome, 'refused');
  assert.equal(receipt.reason, 'ci-no-run');
  assert.equal(check(receipt, 'ci').result, 'fail');
  assert.match(receipt.message, new RegExp(`no run of the ${CI_WORKFLOW} workflow for ${f.sha}`));
  const calls = await f.ghCalls();
  assert.equal(calls.length, 1);
  assert.ok(calls[0].startsWith('run list '), calls[0]);
  assert.ok(calls[0].includes(`-R ${REPO}`), calls[0]);
  assert.ok(calls[0].includes(`--commit ${f.sha}`), 'the query names the full commit');
  assert.ok(calls[0].includes('--json '), calls[0]);

  // A green run for another commit, or of another workflow, never counts.
  await f.ghRuns([f.run({ headSha: f.base, databaseId: 1 }), f.run({ workflowName: 'Deploy Kaminos Pages', databaseId: 2 })]);
  ({ receipt } = await f.land());
  assert.equal(receipt.reason, 'ci-no-run');
  assert.equal(receipt.ci.run, null);
  assert.deepEqual(receipt.ci.runs.map(r => [r.id, r.counted]), [[1, false], [2, false]]);
  assert.equal(f.pushes(), 0);
  assert.equal(f.originMain(), f.base);
});

test('a run still in progress refuses and names the run', async t => {
  const f = await fixture(t);
  await f.ghRuns([f.run({ databaseId: 777, status: 'in_progress', conclusion: '' })]);
  let { ok, receipt } = await f.land();
  assert.equal(ok, false);
  assert.equal(receipt.outcome, 'refused');
  assert.equal(receipt.reason, 'ci-in-progress');
  assert.match(receipt.message, /run 777 .*in_progress/);
  assert.equal(receipt.ci.run.id, 777);
  assert.equal(receipt.ci.run.status, 'in_progress');

  // A failed run beside one still running is still "wait": the running one may go green.
  await f.ghRuns([f.run({ databaseId: 778, conclusion: 'failure' }), f.run({ databaseId: 779, status: 'queued', conclusion: '' })]);
  ({ receipt } = await f.land());
  assert.equal(receipt.reason, 'ci-in-progress');
  assert.match(receipt.message, /run 779 /);
  assert.match(receipt.message, /778 .*failure/);
  assert.equal(f.pushes(), 0);
  assert.equal(f.originMain(), f.base);
});

test('a failed run refuses and names the run and its conclusion', async t => {
  const f = await fixture(t);
  await f.ghRuns([f.run({ databaseId: 778, conclusion: 'failure' })]);
  const { ok, receipt } = await f.land();
  assert.equal(ok, false);
  assert.equal(receipt.outcome, 'refused');
  assert.equal(receipt.reason, 'ci-failed');
  assert.match(receipt.message, /run 778 .*concluded failure/);
  assert.deepEqual([receipt.ci.run.id, receipt.ci.run.conclusion], [778, 'failure']);
  assert.equal(f.pushes(), 0);
  assert.equal(f.originMain(), f.base);
});

test('a failed gh query is its own refusal, never a missing run', async t => {
  const f = await fixture(t);
  await f.ghRuns([f.run()]);
  await f.ghFail();
  let { ok, receipt } = await f.land();
  assert.equal(ok, false);
  assert.equal(receipt.outcome, 'refused');
  assert.equal(receipt.reason, 'ci-query-failed');
  assert.match(receipt.message, /gh: stub failure/);
  assert.equal(f.originMain(), f.base);

  const g = await fixture(t);
  await g.ghRaw('not json\n');
  ({ receipt } = await g.land());
  assert.equal(receipt.reason, 'ci-query-failed');
  assert.match(receipt.message, /JSON/);
  assert.equal(g.pushes(), 0);
});

test('the GitHub repository comes from the remote URL; an unresolvable remote refuses before querying', async t => {
  assert.equal(repoFromRemoteUrl('https://github.com/lyonsno/kaminos.git'), 'lyonsno/kaminos');
  assert.equal(repoFromRemoteUrl('https://github.com/lyonsno/kaminos'), 'lyonsno/kaminos');
  assert.equal(repoFromRemoteUrl('git@github.com:lyonsno/kaminos.git'), 'lyonsno/kaminos');
  assert.equal(repoFromRemoteUrl('ssh://git@github.com/lyonsno/kaminos.git'), 'lyonsno/kaminos');
  assert.equal(repoFromRemoteUrl('https://gitlab.com/lyonsno/kaminos.git'), null);
  assert.equal(repoFromRemoteUrl('/var/tmp/origin.git'), null);
  const f = await fixture(t);
  await f.ghRuns([f.run()]);
  const { ok, receipt } = await f.land({ repo: null });
  assert.equal(ok, false);
  assert.equal(receipt.reason, 'repo-unresolved');
  assert.match(receipt.message, /--repo/);
  assert.equal(receipt.remote.repo, null);
  assert.deepEqual(await f.ghCalls(), []);
  assert.equal(f.originMain(), f.base);
});

test('a rebased branch with a green run lands and the receipt records it', async t => {
  const f = await fixture(t);
  await f.ghRuns([f.run({ databaseId: 4242 })]);
  const { ok, receipt, receiptPath } = await f.land();
  assert.equal(ok, true, receipt.message);
  assert.equal(receipt.outcome, 'landed');
  assert.equal(receipt.reason, null);
  assert.equal(f.originMain(), f.sha, "origin's main moved to the landed commit");
  assert.equal(f.pushes(), 1);
  assert.equal(receiptPath, f.receiptPath);
  const written = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
  assert.equal(written.schema, RECEIPT_SCHEMA);
  assert.equal(written.sha, f.sha);
  assert.equal(written.branch, 'feature');
  assert.equal(written.remote.name, 'origin');
  assert.equal(written.remote.repo, REPO);
  assert.deepEqual(written.main, { before: f.base, after: f.sha });
  assert.deepEqual([written.ci.run.id, written.ci.run.conclusion], [4242, 'success']);
  assert.equal(written.ci.workflow, CI_WORKFLOW);
  assert.deepEqual(written.checks.map(c => [c.name, c.result]),
    [['clean-tree', 'pass'], ['fetch', 'pass'], ['rebased', 'pass'], ['ci', 'pass'], ['push', 'pass']]);
  assert.equal(written.dryRun, false);
  assert.equal(written.push.ok, true);
  assert.ok(Date.parse(written.startedAt) <= Date.parse(written.finishedAt));
  assert.match(written.message, /landed/);
});

test('main moving between the check and the push is reported as non-fast-forward and not retried', async t => {
  const f = await fixture(t);
  await f.ghRuns([f.run()]);
  // Another lane lands while gh is answering: the stub pushes to origin's main
  // after the rebase check has already passed.
  await f.ghHook(`cd ${quote(f.seed)} && printf 'moved\\n' > moved.txt && git add moved.txt && git commit --quiet -m moved && git push --quiet origin main`);
  const { ok, receipt } = await f.land();
  assert.equal(ok, false);
  assert.equal(receipt.outcome, 'main-moved');
  assert.equal(receipt.reason, 'main-moved');
  const moved = f.originMain();
  assert.notEqual(moved, f.sha, 'the landing did not go through');
  assert.notEqual(moved, f.base, 'the other lane landed');
  assert.equal(receipt.main.before, f.base);
  assert.equal(receipt.main.after, moved, 'the receipt names where main actually is');
  assert.equal(check(receipt, 'ci').result, 'pass');
  assert.equal(check(receipt, 'push').result, 'fail');
  assert.equal(receipt.push.ok, false);
  assert.match(receipt.message, /non-fast-forward/);
  assert.equal(f.pushes(), 1, 'pushed once; no retry');
  assert.equal((await f.ghCalls()).length, 1, 'queried once; no re-check');
});

test('--dry-run performs every check and writes the receipt without pushing', async t => {
  const f = await fixture(t);
  await f.ghRuns([f.run({ databaseId: 4343 })]);
  const { ok, receipt, receiptPath } = await f.land({ dryRun: true });
  assert.equal(ok, true, receipt.message);
  assert.equal(receipt.outcome, 'dry-run');
  assert.equal(receipt.dryRun, true);
  assert.equal(f.originMain(), f.base, 'main did not move');
  assert.equal(f.pushes(), 0);
  assert.equal(receipt.push, null);
  assert.deepEqual(receipt.checks.map(c => [c.name, c.result]),
    [['clean-tree', 'pass'], ['fetch', 'pass'], ['rebased', 'pass'], ['ci', 'pass'], ['push', 'skipped']]);
  assert.equal(receipt.ci.run.id, 4343);
  const written = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
  assert.equal(written.outcome, 'dry-run');
  assert.deepEqual(written.main, { before: f.base, after: f.base });

  // A dry run still refuses what a real run would refuse.
  await f.ghRuns([f.run({ databaseId: 1, conclusion: 'cancelled' })]);
  const refused = await f.land({ dryRun: true });
  assert.equal(refused.ok, false);
  assert.equal(refused.receipt.reason, 'ci-failed');
  assert.equal(refused.receipt.dryRun, true);
});

test('the CLI exits 0 when the checks pass, 1 on a refusal, 2 on bad arguments, and prints one summary line', async t => {
  const f = await fixture(t);
  await f.ghRuns([f.run()]);
  const common = ['--receipt', f.receiptPath, '--gh', f.ghPath, '--repo', REPO, '--remote', 'origin'];
  let result = await f.cli(['--dry-run', ...common]);
  assert.equal(result.code, 0, result.stderr);
  const lines = result.stdout.trim().split('\n');
  assert.equal(lines.length, 1, result.stdout);
  assert.match(lines[0], /^dry-run\b/);
  assert.ok(lines[0].includes(f.receiptPath), 'the summary names the receipt');
  assert.equal(f.originMain(), f.base);
  assert.equal(JSON.parse(await fs.readFile(f.receiptPath, 'utf8')).outcome, 'dry-run');

  await f.ghRuns([f.run({ databaseId: 9, conclusion: 'failure' })]);
  result = await f.cli(common);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /^refused\b.*run 9 /);
  assert.equal(f.originMain(), f.base);

  result = await f.cli(['--bogus']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /--bogus/);

  assert.deepEqual(parseArgs(['--dry-run', '--remote', 'upstream', '--receipt', 'r.json']),
    { dryRun: true, remote: 'upstream', receiptPath: path.resolve('r.json') });
  assert.throws(() => parseArgs(['--receipt']), /requires a value/);
});
