// kaminos-test: node
// Contracts for tools/land.mjs, the landing check that fast-forwards main only
// from a clean, rebased branch whose exact commit has a green run of the tests
// workflow, dispatching and waiting for that run when none exists. The fixture
// is a bare origin, a clone with main and a feature branch, and a stub gh
// (tests/land-gh-stub.mjs) answering per --commit and --workflow from canned
// state. Nothing here reaches GitHub, and the clock the wait loop sleeps on is
// the fixture's own.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as L from '../tools/land.mjs';

const LAND_CLI = fileURLToPath(new URL('../tools/land.mjs', import.meta.url));
const GH_STUB = fileURLToPath(new URL('./land-gh-stub.mjs', import.meta.url));
const REPO = 'example/fixture';
const WORKFLOW_FILE = 'tests.yml';
const POLL_MS = 30000;
const GITCONFIG = '[user]\n\tname = Fixture\n\temail = fixture@example.invalid\n[commit]\n\tgpgsign = false\n';
const quote = s => `'${String(s).replace(/'/g, `'\\''`)}'`;

// Every GIT_* variable is dropped before the fixture adds its own, so a
// GIT_DIR or GIT_WORK_TREE in the environment can never steer git at a repo
// that is not the fixture's. The decoy below proves it.
function fixtureEnv(gitconfig) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) if (!key.startsWith('GIT_') && key !== 'NODE_TEST_CONTEXT') env[key] = value;
  return { ...env, GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
}

// A decoy repository that GIT_DIR and GIT_WORK_TREE point at for the whole
// file. If any git the contracts run inherited them, it would read or write
// here; the last contract checks nothing did.
const decoyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kaminos-land-decoy-'));
after(() => fs.rm(decoyDir, { recursive: true, force: true }));
const decoyRepo = path.join(decoyDir, 'repo');
{
  const gitconfig = path.join(decoyDir, 'gitconfig');
  await fs.writeFile(gitconfig, GITCONFIG);
  const env = fixtureEnv(gitconfig);
  execFileSync('git', ['init', '--quiet', '--initial-branch=main', decoyRepo], { env });
  await fs.writeFile(path.join(decoyRepo, 'decoy.txt'), 'decoy\n');
  execFileSync('git', ['add', 'decoy.txt'], { cwd: decoyRepo, env });
  execFileSync('git', ['commit', '--quiet', '-m', 'decoy'], { cwd: decoyRepo, env });
}
process.env.GIT_DIR = path.join(decoyRepo, '.git');
process.env.GIT_WORK_TREE = decoyRepo;
async function decoySnapshot() {
  const gitDir = path.join(decoyRepo, '.git');
  const digest = async file => crypto.createHash('sha256').update(await fs.readFile(path.join(gitDir, file))).digest('hex');
  const objects = (await fs.readdir(path.join(gitDir, 'objects'), { recursive: true })).map(p => p.split(path.sep).join('/')).filter(p => /^[0-9a-f]{2}\/[0-9a-f]{38}$/.test(p)).sort();
  return { head: await fs.readFile(path.join(gitDir, 'HEAD'), 'utf8'), main: await fs.readFile(path.join(gitDir, 'refs', 'heads', 'main'), 'utf8'), index: await digest('index'), objects };
}
const decoyBefore = await decoySnapshot();

// A bare origin holding main, a seed clone that advances origin's main the way
// another lane would, and the clone under test on a feature branch one commit
// ahead of main.
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kaminos-land-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const gitconfig = path.join(dir, 'gitconfig');
  await fs.writeFile(gitconfig, GITCONFIG);
  const env = fixtureEnv(gitconfig);
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

  const statePath = path.join(dir, 'gh-state.json');
  const ghPath = path.join(dir, 'gh');
  await fs.writeFile(ghPath, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(GH_STUB)} ${quote(statePath)} "$@"\n`);
  await fs.chmod(ghPath, 0o755);
  await fs.writeFile(statePath, JSON.stringify({ calls: [], dispatches: [], runsByCommit: {}, dispatch: null, dispatchFails: null, hook: null, fail: null, raw: null }));
  const gh = {
    state: async () => JSON.parse(await fs.readFile(statePath, 'utf8')),
    set: async patch => fs.writeFile(statePath, JSON.stringify({ ...(await gh.state()), ...patch })),
    runs: async (runs, commit = sha) => { const state = await gh.state(); state.runsByCommit[commit] = runs; await fs.writeFile(statePath, JSON.stringify(state)); },
    lists: async () => (await gh.state()).calls.filter(c => c.startsWith('run list')),
    dispatches: async () => (await gh.state()).dispatches,
  };
  const hook = async script => { const file = path.join(dir, 'hook.sh'); await fs.writeFile(file, `${script}\n`); await gh.set({ hook: file }); };

  const calls = [];
  const clock = { now: 1_000_000, slept: [] };
  const baseRunner = L.execFileRunner({ env });
  const run = (executable, args, options) => { calls.push([path.basename(executable), ...args]); return baseRunner(executable, args, options); };
  const receiptPath = path.join(dir, 'receipts', 'receipt.json');
  const makeRun = (over = {}) => ({ databaseId: 4242, status: 'completed', conclusion: 'success', workflowName: 'tests', _file: WORKFLOW_FILE, headSha: sha, event: 'push', headBranch: 'feature', url: 'https://example.invalid/actions/runs/4242', createdAt: '2026-10-13T12:00:00Z', ...over });
  return {
    dir, env, origin, seed, clone, base, sha, ghPath, receiptPath, calls, clock, gh, hook, git, runner: baseRunner,
    run: makeRun,
    originMain: () => git(origin, 'rev-parse', 'refs/heads/main'),
    originRef: ref => { try { return git(origin, 'rev-parse', '--verify', '--quiet', ref); } catch { return null; } },
    cloneHead: () => git(clone, 'rev-parse', 'HEAD'),
    // Another lane landing: a commit on top of whatever origin's main is now.
    advanceMain: async name => {
      git(seed, 'fetch', '--quiet', 'origin');
      git(seed, 'reset', '--quiet', '--hard', 'origin/main');
      const moved = await commit(seed, name);
      git(seed, 'push', '--quiet', 'origin', 'main');
      return moved;
    },
    pushes: ref => calls.filter(c => c[0] === 'git' && c[1] === 'push' && String(c.at(-1)).endsWith(`:${ref}`)).length,
    land: (options = {}) => L.land({
      root: clone, remote: 'origin', repo: REPO, git: 'git', gh: ghPath, receiptPath, run,
      sleep: async ms => { clock.slept.push(ms); clock.now += ms; }, now: () => clock.now, ...options,
    }),
    cli: args => new Promise(resolve => execFile(process.execPath, [LAND_CLI, ...args], { cwd: clone, env, encoding: 'utf8' },
      (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }))),
  };
}

const check = (receipt, name) => receipt.checks.find(c => c.name === name);
const dispatchCommand = branch => `gh workflow run ${WORKFLOW_FILE} -R ${REPO} --ref ${branch}`;

test('a dirty working tree refuses before anything is fetched or queried', async t => {
  const f = await fixture(t);
  await f.gh.runs([f.run()]);
  await fs.writeFile(path.join(f.clone, 'feature.txt'), 'edited\n');
  const { ok, receipt } = await f.land();
  assert.equal(ok, false);
  assert.equal(receipt.outcome, 'refused');
  assert.equal(receipt.reason, 'dirty-tree');
  assert.equal(check(receipt, 'clean-tree').result, 'fail');
  assert.match(receipt.message, /not clean/);
  assert.equal(check(receipt, 'fetch').result, 'skipped');
  assert.deepEqual(await f.gh.lists(), []);
  assert.equal(f.pushes('refs/heads/main'), 0);
  assert.equal(f.originMain(), f.base);

  // An untracked file is not clean either.
  await fs.writeFile(path.join(f.clone, 'feature.txt'), 'feature.txt\n');
  await fs.writeFile(path.join(f.clone, 'scratch.txt'), 'scratch\n');
  assert.equal((await f.land()).receipt.reason, 'dirty-tree');
});

test('a branch that diverged from main refuses and says to rebase; one behind main says so; one at main has nothing to land', async t => {
  const f = await fixture(t);
  await f.gh.runs([f.run()]);
  const moved = await f.advanceMain('other-lane.txt');
  let { ok, receipt } = await f.land();
  assert.equal(ok, false);
  assert.equal(receipt.outcome, 'refused');
  assert.equal(receipt.reason, 'not-rebased');
  assert.match(receipt.message, /rebase/i);
  assert.equal(check(receipt, 'fetch').result, 'pass');
  assert.equal(check(receipt, 'rebased').result, 'fail');
  assert.equal(receipt.main.before, moved, 'the fetch saw the moved main');
  assert.deepEqual(await f.gh.lists(), []);
  assert.equal(f.originMain(), moved);

  f.git(f.clone, 'reset', '--quiet', '--hard', f.base);
  ({ receipt } = await f.land());
  assert.equal(receipt.reason, 'behind-main');
  assert.match(receipt.message, /behind/);
  assert.doesNotMatch(receipt.message, /does not contain/);

  f.git(f.clone, 'reset', '--quiet', '--hard', moved);
  ({ receipt } = await f.land());
  assert.equal(receipt.reason, 'nothing-to-land');
  assert.equal(f.pushes('refs/heads/main'), 0);
  assert.equal(f.originMain(), moved);
});

test('with --no-dispatch, no run of the tests workflow for the exact commit refuses and prints the dispatch command', async t => {
  const f = await fixture(t);
  await f.gh.runs([f.run({ headSha: f.base })], f.base); // a green run for main's commit, none for ours
  let { ok, receipt } = await f.land({ noDispatch: true });
  assert.equal(ok, false);
  assert.equal(receipt.outcome, 'refused');
  assert.equal(receipt.reason, 'ci-no-run');
  assert.equal(check(receipt, 'ci').result, 'fail');
  assert.match(receipt.message, new RegExp(`no run of the tests workflow for ${f.sha}`));
  assert.ok(receipt.message.includes(dispatchCommand('feature')), receipt.message);
  const lists = await f.gh.lists();
  assert.equal(lists.length, 1);
  assert.ok(lists[0].includes(`-R ${REPO}`), lists[0]);
  assert.ok(lists[0].includes(`--workflow ${WORKFLOW_FILE}`), 'the query pins the workflow by file');
  assert.ok(lists[0].includes(`--commit ${f.sha}`), 'the query names the full commit');
  for (const field of ['databaseId', 'status', 'conclusion', 'headSha', 'event', 'headBranch', 'url']) assert.ok(lists[0].includes(field), `--json carries ${field}`);
  assert.deepEqual(await f.gh.dispatches(), []);
  assert.deepEqual(receipt.ci.runs, []);

  // Even when gh answers with runs for other commits, only a run whose headSha
  // is this commit counts.
  await f.gh.set({ ignoreCommit: true });
  ({ receipt } = await f.land({ noDispatch: true }));
  assert.equal(receipt.reason, 'ci-no-run');
  assert.deepEqual(receipt.ci.runs.map(r => [r.headSha, r.counted]), [[f.base, false]]);
  assert.equal(f.pushes('refs/heads/main'), 0);
  assert.equal(f.originMain(), f.base);
});

test('a green run of another workflow beside a failed tests run refuses', async t => {
  const f = await fixture(t);
  await f.gh.runs([
    f.run({ databaseId: 1, conclusion: 'failure', createdAt: '2026-10-13T12:00:00Z' }),
    f.run({ databaseId: 2, workflowName: 'Deploy Kaminos Pages', _file: 'pages.yml', createdAt: '2026-10-13T12:05:00Z' }),
  ]);
  const { ok, receipt } = await f.land({ noDispatch: true });
  assert.equal(ok, false);
  assert.equal(receipt.reason, 'ci-failed');
  assert.equal(receipt.ci.run.id, 1);
  assert.deepEqual(receipt.ci.runs.map(r => r.id), [1], 'the pages run never reached the decision');
  assert.equal(f.originMain(), f.base);
});

test('with --no-dispatch, a run still in progress refuses and names the run', async t => {
  const f = await fixture(t);
  await f.gh.runs([f.run({ databaseId: 777, status: 'in_progress', conclusion: '' })]);
  let { ok, receipt } = await f.land({ noDispatch: true });
  assert.equal(ok, false);
  assert.equal(receipt.outcome, 'refused');
  assert.equal(receipt.reason, 'ci-in-progress');
  assert.match(receipt.message, /run 777 .*in_progress/);
  assert.equal(receipt.ci.run.id, 777);
  assert.match(receipt.message, /gh run watch 777/);

  // An older green run beside one still running is still "wait": the newer run will decide.
  await f.gh.runs([f.run({ databaseId: 778, createdAt: '2026-10-13T11:00:00Z' }), f.run({ databaseId: 779, status: 'queued', conclusion: '', createdAt: '2026-10-13T12:00:00Z' })]);
  ({ receipt } = await f.land({ noDispatch: true }));
  assert.equal(receipt.reason, 'ci-in-progress');
  assert.match(receipt.message, /run 779 /);
  assert.deepEqual(f.clock.slept, [], 'no waiting without dispatch mode');
  assert.equal(f.pushes('refs/heads/main'), 0);
  assert.equal(f.originMain(), f.base);
});

test('a failed run refuses, names the run and its conclusion, and says when main itself is red', async t => {
  const f = await fixture(t);
  await f.gh.runs([f.run({ databaseId: 778, conclusion: 'failure' })]);
  await f.gh.runs([f.run({ databaseId: 700, conclusion: 'failure', headSha: f.base, headBranch: 'main', createdAt: '2026-10-13T11:00:00Z' })], f.base);
  let { ok, receipt } = await f.land();
  assert.equal(ok, false);
  assert.equal(receipt.outcome, 'refused');
  assert.equal(receipt.reason, 'ci-failed');
  assert.match(receipt.message, /run 778 .*concluded failure/);
  assert.deepEqual([receipt.ci.run.id, receipt.ci.run.conclusion], [778, 'failure']);
  assert.match(receipt.message, /main itself is red at run 700; this branch inherits it/);
  assert.deepEqual([receipt.ci.main.sha, receipt.ci.main.run.id, receipt.ci.main.red], [f.base, 700, true]);
  const lists = await f.gh.lists();
  assert.equal(lists.length, 2);
  assert.ok(lists[1].includes(`--commit ${f.base}`), 'the second query asks about main\'s commit');
  assert.deepEqual(await f.gh.dispatches(), [], 'a failure is never re-dispatched');

  // When main's own latest run is green, the failure is this branch's.
  const g = await fixture(t);
  await g.gh.runs([g.run({ databaseId: 778, conclusion: 'failure' })]);
  await g.gh.runs([g.run({ databaseId: 701, headSha: g.base, headBranch: 'main' })], g.base);
  ({ receipt } = await g.land());
  assert.equal(receipt.reason, 'ci-failed');
  assert.doesNotMatch(receipt.message, /inherits/);
  assert.equal(receipt.ci.main.red, false);
  assert.equal(g.originMain(), g.base);
});

test('when several runs exist for the commit, the latest completed run decides', async t => {
  const f = await fixture(t);
  await f.gh.runs([
    f.run({ databaseId: 100, conclusion: 'success', createdAt: '2026-10-13T11:00:00Z' }),
    f.run({ databaseId: 101, conclusion: 'failure', createdAt: '2026-10-13T12:00:00Z' }),
  ]);
  let { receipt } = await f.land({ dryRun: true });
  assert.equal(receipt.reason, 'ci-failed');
  assert.equal(receipt.ci.run.id, 101);
  assert.equal(f.originMain(), f.base);

  await f.gh.runs([
    f.run({ databaseId: 100, conclusion: 'failure', createdAt: '2026-10-13T11:00:00Z' }),
    f.run({ databaseId: 101, conclusion: 'success', createdAt: '2026-10-13T12:00:00Z' }),
  ]);
  ({ receipt } = await f.land({ dryRun: true }));
  assert.equal(receipt.outcome, 'dry-run', receipt.message);
  assert.equal(receipt.ci.run.id, 101);
});

test('a gh query that fails, or answers with something other than JSON, is an error in the ci phase, never a missing run', async t => {
  const f = await fixture(t);
  await f.gh.runs([f.run()]);
  await f.gh.set({ fail: { command: 'run list', code: 4, stderr: 'gh: HTTP 401: Bad credentials\n' } });
  let { ok, receipt } = await f.land();
  assert.equal(ok, false);
  assert.equal(receipt.outcome, 'error');
  assert.equal(receipt.reason, 'ci-query-failed');
  assert.equal(receipt.failurePhase, 'ci');
  assert.match(receipt.message, /Bad credentials/);
  assert.equal(f.originMain(), f.base);

  await f.gh.set({ fail: null, raw: 'not json\n' });
  ({ receipt } = await f.land());
  assert.equal(receipt.outcome, 'error');
  assert.equal(receipt.reason, 'ci-query-failed');
  assert.match(receipt.message, /JSON/);
  assert.equal(f.pushes('refs/heads/main'), 0);
});

test('a fetch that fails is an error in the fetch phase', async t => {
  const f = await fixture(t);
  await f.gh.runs([f.run()]);
  f.git(f.clone, 'remote', 'set-url', 'origin', path.join(f.dir, 'gone.git'));
  const { ok, receipt } = await f.land();
  assert.equal(ok, false);
  assert.equal(receipt.outcome, 'error');
  assert.equal(receipt.failurePhase, 'fetch');
  assert.equal(receipt.reason, 'fetch-failed');
  assert.equal(check(receipt, 'fetch').result, 'fail');
  assert.equal(check(receipt, 'rebased').result, 'skipped');
  assert.deepEqual(await f.gh.lists(), []);
});

test('the GitHub repository comes from the push URL; an unresolvable one is an error before any query', async t => {
  assert.equal(L.repoFromRemoteUrl('https://github.com/lyonsno/kaminos.git'), 'lyonsno/kaminos');
  assert.equal(L.repoFromRemoteUrl('https://github.com/lyonsno/kaminos'), 'lyonsno/kaminos');
  assert.equal(L.repoFromRemoteUrl('git@github.com:lyonsno/kaminos.git'), 'lyonsno/kaminos');
  assert.equal(L.repoFromRemoteUrl('ssh://git@github.com/lyonsno/kaminos.git'), 'lyonsno/kaminos');
  assert.equal(L.repoFromRemoteUrl('https://gitlab.com/lyonsno/kaminos.git'), null);
  assert.equal(L.repoFromRemoteUrl('/var/tmp/origin.git'), null);
  const f = await fixture(t);
  await f.gh.runs([f.run()]);
  let { ok, receipt } = await f.land({ repo: null });
  assert.equal(ok, false);
  assert.equal(receipt.outcome, 'error');
  assert.equal(receipt.reason, 'repo-unresolved');
  assert.match(receipt.message, /--repo/);
  assert.equal(receipt.remote.repo, null);
  assert.deepEqual(await f.gh.lists(), []);

  // The push URL names the repository even when the fetch URL does not.
  f.git(f.clone, 'remote', 'set-url', '--push', 'origin', 'https://github.com/example/pushed.git');
  ({ receipt } = await f.land({ repo: null, dryRun: true, noDispatch: true }));
  assert.equal(receipt.outcome, 'dry-run', receipt.message);
  assert.deepEqual([receipt.remote.repo, receipt.remote.repoSource], ['example/pushed', 'push-url']);
  assert.ok((await f.gh.lists())[0].includes('-R example/pushed'));
  assert.equal(f.originMain(), f.base);
});

test('a rebased branch with a green run lands and the receipt records it', async t => {
  const f = await fixture(t);
  await f.gh.runs([f.run({ databaseId: 4242 })]);
  const { ok, receipt, receiptPath, receiptError } = await f.land();
  assert.equal(ok, true, receipt.message);
  assert.equal(receiptError, null);
  assert.equal(receipt.outcome, 'landed');
  assert.equal(receipt.reason, null);
  assert.equal(f.originMain(), f.sha, "origin's main moved to the landed commit");
  assert.equal(f.pushes('refs/heads/main'), 1);
  assert.ok(f.calls.some(c => c[0] === 'git' && c[1] === 'push' && c.at(-1) === `${f.sha}:refs/heads/main`), 'the push names the recorded commit, not HEAD');
  assert.equal(receiptPath, f.receiptPath);
  const written = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
  assert.equal(written.schema, L.RECEIPT_SCHEMA);
  assert.equal(written.sha, f.sha);
  assert.equal(written.branch, 'feature');
  assert.equal(written.remote.name, 'origin');
  assert.equal(written.remote.repo, REPO);
  assert.deepEqual([written.main.before, written.main.after, written.main.afterContainsSha], [f.base, f.sha, true]);
  assert.deepEqual([written.ci.run.id, written.ci.run.conclusion, written.ci.run.event, written.ci.run.headBranch, written.ci.run.url],
    [4242, 'success', 'push', 'feature', 'https://example.invalid/actions/runs/4242']);
  assert.equal(written.ci.workflowFile, WORKFLOW_FILE);
  assert.equal(written.ci.dispatch, null);
  assert.deepEqual(written.checks.map(c => [c.name, c.result]),
    [['clean-tree', 'pass'], ['fetch', 'pass'], ['rebased', 'pass'], ['ci', 'pass'], ['push', 'pass']]);
  assert.equal(written.dryRun, false);
  assert.equal(written.push.ok, true);
  assert.ok(Date.parse(written.startedAt) <= Date.parse(written.finishedAt));
  assert.match(written.message, /landed/);
});

test('a commit made in the clone while gh answers never lands: the recorded commit is what is checked and pushed', async t => {
  const f = await fixture(t);
  await f.gh.runs([f.run()]);
  await f.hook(`cd ${quote(f.clone)} && printf 'late\\n' > late.txt && git add late.txt && git commit --quiet -m late`);
  const { ok, receipt } = await f.land();
  const late = f.cloneHead();
  assert.notEqual(late, f.sha, 'the hook moved HEAD');
  assert.equal(ok, true, receipt.message);
  assert.equal(receipt.outcome, 'landed');
  assert.equal(receipt.sha, f.sha);
  assert.equal(f.originMain(), f.sha, 'origin main is the tested commit');
  assert.notEqual(f.originMain(), late, 'origin main is never the late commit');
  assert.ok(f.calls.some(c => c[0] === 'git' && c[1] === 'merge-base' && c.includes(f.sha)), 'merge-base ran against the recorded commit');
});

test('main moving between the check and the push is reported as non-fast-forward and not retried', async t => {
  const f = await fixture(t);
  await f.gh.runs([f.run()]);
  // Another lane lands while gh is answering.
  await f.hook(`cd ${quote(f.seed)} && printf 'moved\\n' > moved.txt && git add moved.txt && git commit --quiet -m moved && git push --quiet origin main`);
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
  assert.equal(f.pushes('refs/heads/main'), 1, 'pushed once; no retry');
  assert.equal((await f.gh.lists()).length, 1, 'queried once; no re-check');
});

test('a push that exited 0 is landed even when another lane lands on top before main is read back, or main cannot be read back', async t => {
  const f = await fixture(t);
  await f.gh.runs([f.run()]);
  let onTop = null;
  const run = async (executable, args, options) => {
    const result = await f.runner(executable, args, options);
    if (args[0] === 'push' && args.at(-1).endsWith(':refs/heads/main') && result.code === 0) onTop = await f.advanceMain('on-top.txt');
    return result;
  };
  let { ok, receipt } = await f.land({ run });
  assert.equal(ok, true, receipt.message);
  assert.equal(receipt.outcome, 'landed');
  assert.equal(f.originMain(), onTop);
  assert.deepEqual([receipt.main.after, receipt.main.afterContainsSha], [onTop, true]);
  assert.match(receipt.message, /landed/);

  const g = await fixture(t);
  await g.gh.runs([g.run()]);
  const flaky = async (executable, args, options) => {
    if (args[0] === 'ls-remote') return { code: 128, stdout: '', stderr: 'fatal: unable to access origin\n', error: null };
    return g.runner(executable, args, options);
  };
  ({ ok, receipt } = await g.land({ run: flaky }));
  assert.equal(ok, true, receipt.message);
  assert.equal(receipt.outcome, 'landed');
  assert.equal(g.originMain(), g.sha);
  assert.equal(receipt.main.after, null);
  assert.match(receipt.main.afterError, /unable to access/);
});

test('--dry-run performs every check and writes the receipt without pushing, and refuses when main moved under it', async t => {
  const f = await fixture(t);
  await f.gh.runs([f.run({ databaseId: 4343 })]);
  let { ok, receipt, receiptPath } = await f.land({ dryRun: true });
  assert.equal(ok, true, receipt.message);
  assert.equal(receipt.outcome, 'dry-run');
  assert.equal(receipt.dryRun, true);
  assert.equal(f.originMain(), f.base, 'main did not move');
  assert.equal(f.pushes('refs/heads/main'), 0);
  assert.equal(receipt.push, null);
  assert.deepEqual(receipt.checks.map(c => [c.name, c.result]),
    [['clean-tree', 'pass'], ['fetch', 'pass'], ['rebased', 'pass'], ['ci', 'pass'], ['push', 'skipped']]);
  assert.equal(receipt.ci.run.id, 4343);
  const written = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
  assert.equal(written.outcome, 'dry-run');
  assert.deepEqual([written.main.before, written.main.after], [f.base, f.base]);

  // A dry run still refuses what a real run would refuse.
  await f.gh.runs([f.run({ databaseId: 1, conclusion: 'cancelled' })]);
  ({ ok, receipt } = await f.land({ dryRun: true }));
  assert.equal(ok, false);
  assert.equal(receipt.reason, 'ci-failed');
  assert.equal(receipt.dryRun, true);

  // Main moving during a dry run is caught by comparing the fetched main with the remote's.
  await f.gh.runs([f.run()]);
  await f.hook(`cd ${quote(f.seed)} && printf 'moved\\n' > moved.txt && git add moved.txt && git commit --quiet -m moved && git push --quiet origin main`);
  ({ ok, receipt } = await f.land({ dryRun: true }));
  assert.equal(ok, false);
  assert.equal(receipt.outcome, 'main-moved');
  assert.equal(receipt.main.before, f.base);
  assert.equal(receipt.main.after, f.originMain());
  assert.notEqual(receipt.main.after, f.base);
  assert.equal(f.pushes('refs/heads/main'), 0);
});

test('with no run for the commit, the branch is pushed, the workflow dispatched once, and the run awaited until it decides', async t => {
  const f = await fixture(t);
  await f.gh.set({ dispatch: { headSha: f.sha, run: f.run({ databaseId: 9001, event: 'workflow_dispatch', _hiddenFor: 1, _timeline: ['queued', 'in_progress', 'in_progress', 'completed:success'] }) } });
  assert.equal(f.originRef('refs/heads/feature'), null);
  const { ok, receipt } = await f.land();
  assert.equal(ok, true, receipt.message);
  assert.equal(receipt.outcome, 'landed');
  assert.equal(f.originRef('refs/heads/feature'), f.sha, 'the branch was pushed before the dispatch');
  assert.equal(f.pushes('refs/heads/feature'), 1);
  assert.equal(f.originMain(), f.sha);
  assert.deepEqual(await f.gh.dispatches(), [`workflow run ${WORKFLOW_FILE} -R ${REPO} --ref feature`]);
  assert.deepEqual([receipt.ci.dispatch.performed, receipt.ci.dispatch.branchPushed], [true, true]);
  assert.equal(receipt.ci.run.id, 9001);
  // Listings: the first found nothing; then hidden, queued, in_progress, in_progress, completed.
  assert.ok(receipt.ci.wait.polls >= 5, `polled ${receipt.ci.wait.polls} times`);
  assert.ok(f.clock.slept.length >= 4);
  assert.ok(f.clock.slept.every(ms => ms === POLL_MS), `sleeps of ${POLL_MS} ms: ${f.clock.slept}`);
  assert.equal(receipt.ci.wait.pollMs, POLL_MS);
  assert.deepEqual(receipt.ci.wait.bounds.timeoutMinutes, 360, 'no workflow file in the fixture: GitHub\'s default job timeout');
  assert.equal(check(receipt, 'ci').result, 'pass');
});

test('a branch already at the commit on the remote is not pushed again before the dispatch', async t => {
  const f = await fixture(t);
  f.git(f.clone, 'push', '--quiet', 'origin', 'feature');
  await f.gh.set({ dispatch: { headSha: f.sha, run: f.run({ databaseId: 9002, _timeline: ['queued', 'completed:success'] }) } });
  const { ok, receipt } = await f.land({ dryRun: true });
  assert.equal(ok, true, receipt.message);
  assert.equal(f.pushes('refs/heads/feature'), 0);
  assert.deepEqual([receipt.ci.dispatch.performed, receipt.ci.dispatch.branchPushed, receipt.ci.dispatch.branchTip], [true, false, f.sha]);
  assert.equal((await f.gh.dispatches()).length, 1);
  assert.equal(f.originMain(), f.base, 'a dry run dispatches and waits but does not push main');
});

test('a run already pending for the commit is awaited, not dispatched again', async t => {
  const f = await fixture(t);
  await f.gh.runs([f.run({ databaseId: 9003, status: 'queued', conclusion: '', _timeline: ['queued', 'in_progress', 'completed:success'] })]);
  const { ok, receipt } = await f.land();
  assert.equal(ok, true, receipt.message);
  assert.equal(receipt.outcome, 'landed');
  assert.deepEqual(await f.gh.dispatches(), []);
  assert.equal(receipt.ci.dispatch, null);
  assert.equal(receipt.ci.run.id, 9003);
  assert.ok(f.clock.slept.length >= 2);
  assert.equal(f.originMain(), f.sha);
});

test('a failed run is refused and never re-dispatched, whether it was found or awaited', async t => {
  const f = await fixture(t);
  await f.gh.runs([f.run({ databaseId: 9004, conclusion: 'failure' })]);
  let { ok, receipt } = await f.land();
  assert.equal(ok, false);
  assert.equal(receipt.reason, 'ci-failed');
  assert.deepEqual(await f.gh.dispatches(), []);
  assert.deepEqual(f.clock.slept, []);
  assert.equal(f.originMain(), f.base);

  const g = await fixture(t);
  await g.gh.set({ dispatch: { headSha: g.sha, run: g.run({ databaseId: 9005, _timeline: ['queued', 'in_progress', 'completed:failure'] }) } });
  ({ ok, receipt } = await g.land());
  assert.equal(ok, false);
  assert.equal(receipt.reason, 'ci-failed');
  assert.equal(receipt.ci.run.id, 9005);
  assert.equal((await g.gh.dispatches()).length, 1, 'dispatched once, never again after the failure');
  assert.equal(g.originMain(), g.base);
});

test('the wait is bounded by the workflow\'s own lifecycle and ends as an error, without another dispatch', async t => {
  const f = await fixture(t);
  await f.gh.set({ dispatch: { headSha: f.sha, run: f.run({ databaseId: 9006, _timeline: ['in_progress'] }) } });
  const { ok, receipt } = await f.land({ sleep: async ms => { f.clock.slept.push(ms); f.clock.now += 3600_000; } });
  assert.equal(ok, false);
  assert.equal(receipt.outcome, 'error');
  assert.equal(receipt.reason, 'ci-wait-exceeded');
  assert.equal(receipt.failurePhase, 'ci');
  assert.equal((await f.gh.dispatches()).length, 1);
  assert.ok(f.clock.slept.length >= 5 && f.clock.slept.length <= 10, `${f.clock.slept.length} polls for a 360-minute job timeout`);
  assert.equal(receipt.ci.run.id, 9006);
  assert.equal(f.originMain(), f.base);

  const g = await fixture(t);
  await g.gh.set({ dispatchFails: { code: 1, stderr: 'could not create workflow dispatch event: HTTP 422\n' } });
  const second = await g.land();
  assert.equal(second.receipt.outcome, 'error');
  assert.equal(second.receipt.reason, 'dispatch-failed');
  assert.match(second.receipt.message, /HTTP 422/);
});

test('a detached HEAD cannot be dispatched for and is refused with the reason', async t => {
  const f = await fixture(t);
  f.git(f.clone, 'checkout', '--quiet', '--detach');
  const { ok, receipt } = await f.land();
  assert.equal(ok, false);
  assert.equal(receipt.reason, 'ci-no-run');
  assert.match(receipt.message, /detached/);
  assert.equal(receipt.branch, null);
  assert.deepEqual(await f.gh.dispatches(), []);
});

test('a listing that fills the --limit is signalled', async t => {
  const f = await fixture(t);
  await f.gh.runs(Array.from({ length: 150 }, (_, i) => f.run({ databaseId: 5000 + i, createdAt: `2026-10-13T12:${String(i % 60).padStart(2, '0')}:00Z` })));
  const { ok, receipt } = await f.land({ dryRun: true, noDispatch: true });
  assert.equal(ok, true, receipt.message);
  assert.equal(receipt.ci.limitReached, true);
  assert.equal(receipt.ci.runs.length, receipt.ci.limit);
  assert.match(receipt.message, /limit/);
});

test('the receipt defaults to the repository\'s test-results directory, named by commit and time', async t => {
  const f = await fixture(t);
  await f.gh.runs([f.run()]);
  const { receiptPath } = await f.land({ dryRun: true, receiptPath: undefined });
  const expected = path.join(f.clone, 'test-results', `landing-${f.sha.slice(0, 9)}-`);
  assert.ok(receiptPath.startsWith(expected), `${receiptPath} under ${expected}`);
  assert.equal(JSON.parse(await fs.readFile(receiptPath, 'utf8')).outcome, 'dry-run');
});

test('the CLI exits 0 when the checks pass, 1 on a refusal, 2 on bad arguments, 3 on an error, and prints one summary line', async t => {
  const f = await fixture(t);
  await f.gh.runs([f.run()]);
  const common = ['--receipt', f.receiptPath, '--gh', f.ghPath, '--repo', REPO, '--remote', 'origin', '--no-dispatch'];
  let result = await f.cli(['--dry-run', ...common]);
  assert.equal(result.code, 0, result.stderr);
  const lines = result.stdout.trim().split('\n');
  assert.equal(lines.length, 1, result.stdout);
  assert.match(lines[0], /^dry-run\b/);
  assert.ok(lines[0].includes(f.receiptPath), 'the summary names the receipt');
  assert.equal(f.originMain(), f.base);
  assert.equal(JSON.parse(await fs.readFile(f.receiptPath, 'utf8')).outcome, 'dry-run');

  await f.gh.runs([f.run({ databaseId: 9, conclusion: 'failure' })]);
  result = await f.cli(common);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /^refused\b.*run 9 /);
  assert.equal(f.originMain(), f.base);

  result = await f.cli(['--bogus']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /--bogus/);
  result = await f.cli(['--workflow', 'other.yml']);
  assert.equal(result.code, 2, 'the workflow is pinned, not an argument');

  await f.gh.set({ fail: { command: 'run list', code: 1, stderr: 'gh: rate limit exceeded\n' } });
  result = await f.cli(common);
  assert.equal(result.code, 3);
  assert.match(result.stdout, /^error\b.*rate limit/);

  // A receipt that cannot be written still prints the summary, with the error on stderr.
  await f.gh.set({ fail: null });
  await f.gh.runs([f.run()]);
  await fs.writeFile(path.join(f.dir, 'not-a-dir'), '');
  result = await f.cli(['--dry-run', ...common.slice(2), '--receipt', path.join(f.dir, 'not-a-dir', 'receipt.json')]);
  assert.equal(result.code, 3);
  assert.match(result.stdout, /^dry-run\b/);
  assert.match(result.stderr, /receipt/);

  assert.deepEqual(L.parseArgs(['--dry-run', '--no-dispatch', '--remote', 'upstream', '--receipt', 'r.json']),
    { dryRun: true, noDispatch: true, remote: 'upstream', receiptPath: path.resolve('r.json') });
  assert.throws(() => L.parseArgs(['--receipt']), /requires a value/);
});

test('the decoy repository that GIT_DIR and GIT_WORK_TREE point at was never touched', async () => {
  assert.equal(process.env.GIT_DIR, path.join(decoyRepo, '.git'), 'the decoy was in force for the whole file');
  const env = fixtureEnv('/dev/null');
  assert.ok(!Object.keys(env).some(k => k.startsWith('GIT_') && !['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_TERMINAL_PROMPT'].includes(k)), 'no inherited GIT_* variable survives');
  assert.deepEqual(await decoySnapshot(), decoyBefore);
});
