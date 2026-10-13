// kaminos-test: node
// Contracts for tools/land.mjs, the landing check that fast-forwards main only
// from a clean, rebased branch whose exact commit has a green run of the tests
// workflow, dispatching that run from a tool-owned land/<sha> ref and awaiting
// it when none exists. The fixture is a bare origin, a clone with main and a
// feature branch, and a stub gh (tests/land-gh-stub.mjs) answering per
// --commit, --workflow and run id from canned state. Nothing here reaches
// GitHub, and the clock the wait loop sleeps on is the fixture's own.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFile, execFileSync, spawn } from 'node:child_process';
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
// another lane would, and the clone under test one commit ahead of main, on a
// feature branch unless onMain asks for the commit to sit on main itself.
async function fixture(t, { onMain = false } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kaminos-land-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const gitconfig = path.join(dir, 'gitconfig');
  await fs.writeFile(gitconfig, GITCONFIG);
  const env = fixtureEnv(gitconfig);
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const origin = path.join(dir, 'origin.git');
  const seed = path.join(dir, 'seed');
  const clone = path.join(dir, 'clone');
  const commit = async (cwd, name, text = `${name}\n`) => {
    await fs.mkdir(path.dirname(path.join(cwd, name)), { recursive: true });
    await fs.writeFile(path.join(cwd, name), text);
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
  if (!onMain) git(clone, 'checkout', '--quiet', '-b', 'feature');
  const sha = await commit(clone, 'feature.txt');

  const statePath = path.join(dir, 'gh-state.json');
  const ghPath = path.join(dir, 'gh');
  await fs.writeFile(ghPath, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(GH_STUB)} ${quote(statePath)} "$@"\n`);
  await fs.chmod(ghPath, 0o755);
  await fs.writeFile(statePath, JSON.stringify({ calls: [], dispatches: [], runsByCommit: {}, dispatch: null, dispatchSilent: false, dispatchFails: null, hook: null, fail: null, raw: null }));
  const gh = {
    state: async () => JSON.parse(await fs.readFile(statePath, 'utf8')),
    set: async patch => fs.writeFile(statePath, JSON.stringify({ ...(await gh.state()), ...patch })),
    runs: async (runs, commit = sha) => { const state = await gh.state(); state.runsByCommit[commit] = runs; await fs.writeFile(statePath, JSON.stringify(state)); },
    calls: async () => (await gh.state()).calls,
    lists: async () => (await gh.state()).calls.filter(c => c.startsWith('run list')),
    views: async () => (await gh.state()).calls.filter(c => c.startsWith('run view')),
    dispatches: async () => (await gh.state()).dispatches,
  };
  const hook = async script => { const file = path.join(dir, 'hook.sh'); await fs.writeFile(file, `${script}\n`); await gh.set({ hook: file }); };

  const calls = [];
  const lines = [];
  const clock = { now: 1_000_000, slept: [] };
  const baseRunner = L.execFileRunner({ env });
  const run = (executable, args, options) => { calls.push([path.basename(executable), ...args]); return baseRunner(executable, args, options); };
  const receiptPath = path.join(dir, 'receipts', 'receipt.json');
  const makeRun = (over = {}) => ({ databaseId: 4242, status: 'completed', conclusion: 'success', workflowName: 'tests', _file: WORKFLOW_FILE, headSha: sha, event: 'push', headBranch: 'feature', url: `https://github.com/${REPO}/actions/runs/${over.databaseId ?? 4242}`, createdAt: '2026-10-13T12:00:00Z', attempt: 1, ...over });
  const lastArg = c => String(c.at(-1));
  const f = {
    dir, env, origin, seed, clone, base, sha, ghPath, receiptPath, calls, lines, clock, gh, hook, git, commit, runner: baseRunner,
    landRef: s => `land/${s}`,
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
    pushes: ref => calls.filter(c => c[0] === 'git' && c[1] === 'push' && lastArg(c).endsWith(`:${ref}`) && !lastArg(c).startsWith(':')).length,
    deletions: ref => calls.filter(c => c[0] === 'git' && c[1] === 'push' && lastArg(c) === `:${ref}`).length,
    land: (options = {}) => L.land({
      root: clone, remote: 'origin', repo: REPO, git: 'git', gh: ghPath, receiptPath, run, log: line => lines.push(line),
      sleep: async ms => { clock.slept.push(ms); clock.now += ms; }, now: () => clock.now, ...options,
    }),
    cli: args => new Promise(resolve => execFile(process.execPath, [LAND_CLI, ...args], { cwd: clone, env, encoding: 'utf8' },
      (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }))),
    // The CLI as a live child: onStderr sees each line as it arrives, so a
    // contract can act on a state change, such as sending a signal.
    cliSpawn: (args, onStderr) => {
      const child = spawn(process.execPath, [LAND_CLI, ...args], { cwd: clone, env });
      let stdout = '', stderr = '';
      child.stdout.on('data', d => { stdout += d; });
      child.stderr.on('data', d => { stderr += d; for (const line of String(d).split('\n').filter(Boolean)) onStderr?.(line, child); });
      const done = new Promise(resolve => child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr })));
      return { child, done };
    },
  };
  return f;
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

test('with --no-dispatch, no run of the tests workflow for the exact commit refuses and says how to get one', async t => {
  const f = await fixture(t);
  await f.gh.runs([f.run({ headSha: f.base })], f.base); // a green run for main's commit, none for ours
  let { ok, receipt } = await f.land({ noDispatch: true });
  assert.equal(ok, false);
  assert.equal(receipt.outcome, 'refused');
  assert.equal(receipt.reason, 'ci-no-run');
  assert.equal(check(receipt, 'ci').result, 'fail');
  assert.match(receipt.message, new RegExp(`no run of the tests workflow for ${f.sha}`));
  assert.ok(receipt.message.includes('--ci-only'), receipt.message);
  assert.ok(receipt.message.includes(dispatchCommand('feature')), receipt.message);
  const lists = await f.gh.lists();
  assert.equal(lists.length, 1);
  assert.ok(lists[0].includes(`-R ${REPO}`), lists[0]);
  assert.ok(lists[0].includes(`--workflow ${WORKFLOW_FILE}`), 'the query pins the workflow by file');
  assert.ok(lists[0].includes(`--commit ${f.sha}`), 'the query names the full commit');
  for (const field of ['databaseId', 'status', 'conclusion', 'headSha', 'event', 'headBranch', 'url', 'attempt']) assert.ok(lists[0].includes(field), `--json carries ${field}`);
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

test('a failed run refuses, names the run and its conclusion, and reports main\'s own latest run without attributing', async t => {
  const f = await fixture(t);
  await f.gh.runs([f.run({ databaseId: 778, conclusion: 'failure' })]);
  await f.gh.runs([f.run({ databaseId: 700, conclusion: 'failure', headSha: f.base, headBranch: 'main', createdAt: '2026-10-13T11:00:00Z' })], f.base);
  let { ok, receipt } = await f.land();
  assert.equal(ok, false);
  assert.equal(receipt.outcome, 'refused');
  assert.equal(receipt.reason, 'ci-failed');
  assert.match(receipt.message, /run 778 .*concluded failure/);
  assert.deepEqual([receipt.ci.run.id, receipt.ci.run.conclusion], [778, 'failure']);
  assert.match(receipt.message, /main is also red at run 700; compare the failures before attributing/);
  assert.doesNotMatch(receipt.message, /inherit/);
  assert.ok(receipt.message.includes(`https://github.com/${REPO}/actions/runs/778`), 'the branch run URL is in the message');
  assert.ok(receipt.message.includes(`https://github.com/${REPO}/actions/runs/700`), 'main\'s run URL is in the message');
  assert.deepEqual([receipt.ci.main.sha, receipt.ci.main.run.id, receipt.ci.main.red], [f.base, 700, true]);
  const lists = await f.gh.lists();
  assert.equal(lists.length, 2);
  assert.ok(lists[1].includes(`--commit ${f.base}`), 'the second query asks about main\'s commit');
  assert.deepEqual(await f.gh.dispatches(), [], 'a failure is never re-dispatched');

  // When main's own latest run is green, say so.
  const g = await fixture(t);
  await g.gh.runs([g.run({ databaseId: 778, conclusion: 'failure' })]);
  await g.gh.runs([g.run({ databaseId: 701, headSha: g.base, headBranch: 'main' })], g.base);
  ({ receipt } = await g.land());
  assert.equal(receipt.reason, 'ci-failed');
  assert.doesNotMatch(receipt.message, /also red/);
  assert.match(receipt.message, /main's own latest run 701 is green/);
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
  ({ receipt } = await f.land({ repo: null, dryRun: true }));
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
  assert.deepEqual([written.ci.run.id, written.ci.run.conclusion, written.ci.run.event, written.ci.run.headBranch, written.ci.run.url, written.ci.run.attempt],
    [4242, 'success', 'push', 'feature', `https://github.com/${REPO}/actions/runs/4242`, 1]);
  assert.equal(written.ci.workflowFile, WORKFLOW_FILE);
  assert.equal(written.ci.dispatch, null);
  assert.deepEqual(written.checks.map(c => [c.name, c.result]),
    [['clean-tree', 'pass'], ['fetch', 'pass'], ['rebased', 'pass'], ['ci', 'pass'], ['push', 'pass']]);
  assert.deepEqual([written.dryRun, written.ciOnly], [false, false]);
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

test('--dry-run performs every check, changes nothing on the remote, writes the receipt, and refuses when main moved under it', async t => {
  const f = await fixture(t);
  await f.gh.runs([f.run({ databaseId: 4343 })]);
  let { ok, receipt, receiptPath } = await f.land({ dryRun: true });
  assert.equal(ok, true, receipt.message);
  assert.equal(receipt.outcome, 'dry-run');
  assert.deepEqual([receipt.dryRun, receipt.noDispatch], [true, true], 'a dry run implies no dispatch');
  assert.equal(f.originMain(), f.base, 'main did not move');
  assert.equal(f.pushes('refs/heads/main'), 0);
  assert.equal(receipt.push, null);
  assert.deepEqual(receipt.checks.map(c => [c.name, c.result]),
    [['clean-tree', 'pass'], ['fetch', 'pass'], ['rebased', 'pass'], ['ci', 'pass'], ['push', 'skipped']]);
  assert.equal(receipt.ci.run.id, 4343);
  const written = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
  assert.equal(written.outcome, 'dry-run');
  assert.deepEqual([written.main.before, written.main.after], [f.base, f.base]);

  // With no run and a dispatch available, a dry run still dispatches nothing
  // and pushes no ref; it reports the checks and how to get a run.
  await f.gh.runs([]);
  await f.gh.set({ dispatch: { headSha: f.sha, run: f.run({ databaseId: 1, _timeline: ['queued', 'completed:success'] }) } });
  ({ ok, receipt } = await f.land({ dryRun: true }));
  assert.equal(ok, false);
  assert.equal(receipt.reason, 'ci-no-run');
  assert.deepEqual(await f.gh.dispatches(), []);
  assert.equal(f.originRef(`refs/heads/${f.landRef(f.sha)}`), null, 'no land ref was pushed');
  assert.equal(f.calls.filter(c => c[0] === 'git' && c[1] === 'push').length, 0, 'no push of any kind');
  assert.equal(receipt.ci.dispatch, null);
  assert.deepEqual(receipt.checks.map(c => c.result), ['pass', 'pass', 'pass', 'fail', 'skipped']);

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

test('with no run for the commit, a land/<sha> ref is pushed, the workflow dispatched once from it, the run awaited, and the ref deleted', async t => {
  const f = await fixture(t);
  const ref = f.landRef(f.sha);
  await f.gh.set({ dispatch: { headSha: f.sha, run: f.run({ databaseId: 9001, event: 'workflow_dispatch', headBranch: ref, _timeline: ['queued', 'in_progress', 'in_progress', 'completed:success'] }) } });
  const { ok, receipt } = await f.land();
  assert.equal(ok, true, receipt.message);
  assert.equal(receipt.outcome, 'landed');
  assert.equal(f.originMain(), f.sha);
  assert.equal(f.originRef('refs/heads/feature'), null, "the lane's branch was never pushed");
  assert.equal(f.pushes(`refs/heads/${ref}`), 1, 'the land ref was pushed once');
  assert.equal(f.originRef(`refs/heads/${ref}`), null, 'the land ref is gone afterwards');
  assert.equal(f.deletions(`refs/heads/${ref}`), 1);
  assert.deepEqual(await f.gh.dispatches(), [`workflow run ${WORKFLOW_FILE} -R ${REPO} --ref ${ref}`]);
  assert.deepEqual([receipt.ci.dispatch.ref, receipt.ci.dispatch.refExisted, receipt.ci.dispatch.refPushed, receipt.ci.dispatch.performed, receipt.ci.dispatch.refDeleted, receipt.ci.dispatch.refDeleteError],
    [ref, false, true, true, true, null]);
  assert.equal(receipt.ci.run.id, 9001);
  // gh printed the run URL, so the run was followed by id.
  assert.deepEqual([receipt.ci.dispatch.runId, receipt.ci.dispatch.runUrl], [9001, `https://github.com/${REPO}/actions/runs/9001`]);
  assert.equal(receipt.ci.wait.followedRunId, 9001);
  assert.ok((await f.gh.views()).length >= 3, 'the run was polled through gh run view');
  assert.ok(receipt.ci.wait.polls >= 4, `polled ${receipt.ci.wait.polls} times`);
  assert.ok(f.clock.slept.length >= 3);
  assert.ok(f.clock.slept.every(ms => ms === POLL_MS), `sleeps of ${POLL_MS} ms: ${f.clock.slept}`);
  assert.equal(receipt.ci.wait.pollMs, POLL_MS);
  assert.equal(receipt.ci.wait.bounds.timeoutMinutes, 360, 'no workflow file in the fixture: GitHub\'s default job timeout');
  // One line per state change.
  const states = f.lines.map(l => l.replace(/^landing: /, ''));
  for (const pattern of [/dispatched/, /queued/, /in progress/, /concluded success/]) assert.ok(states.some(s => pattern.test(s)), `${pattern} in ${JSON.stringify(states)}`);
  assert.deepEqual(receipt.ci.wait.states.map(s => s.state), ['queued', 'running', 'concluded']);
  assert.equal(check(receipt, 'ci').result, 'pass');
});

test('from a checkout on main one commit ahead, a dispatch that fails never moves main, in a dry run or a landing', async t => {
  const f = await fixture(t, { onMain: true });
  assert.equal(f.git(f.clone, 'symbolic-ref', '--short', 'HEAD'), 'main');
  await f.gh.set({ dispatchFails: { code: 1, stderr: 'could not create workflow dispatch event: HTTP 422\n' } });
  let { ok, receipt } = await f.land({ dryRun: true });
  assert.equal(ok, false);
  assert.equal(receipt.reason, 'ci-no-run');
  assert.equal(f.originMain(), f.base, 'dry run: main untouched');
  assert.equal(f.calls.filter(c => c[0] === 'git' && c[1] === 'push').length, 0);

  ({ ok, receipt } = await f.land());
  assert.equal(ok, false);
  assert.equal(receipt.outcome, 'error');
  assert.equal(receipt.reason, 'dispatch-failed');
  assert.match(receipt.message, /HTTP 422/);
  assert.equal(f.originMain(), f.base, 'landing attempt: main untouched');
  assert.equal(f.pushes('refs/heads/main'), 0);
  assert.equal(f.pushes(`refs/heads/${f.landRef(f.sha)}`), 1, 'only the land ref was pushed');
  assert.equal(f.originRef(`refs/heads/${f.landRef(f.sha)}`), null, 'and deleted after the error');
  assert.equal(receipt.ci.dispatch.refDeleted, true);
});

test('a lane that pushed its branch and then rebased dispatches from land/<sha>; its remote branch is untouched and the ref is deleted', async t => {
  const f = await fixture(t);
  f.git(f.clone, 'push', '--quiet', 'origin', 'feature');
  const pushed = f.originRef('refs/heads/feature');
  assert.equal(pushed, f.sha);
  const moved = await f.advanceMain('other-lane.txt');
  f.git(f.clone, 'fetch', '--quiet', 'origin');
  f.git(f.clone, 'rebase', '--quiet', 'origin/main');
  const rebased = f.cloneHead();
  assert.notEqual(rebased, f.sha);
  const ref = f.landRef(rebased);
  await f.gh.set({ dispatch: { headSha: rebased, run: f.run({ databaseId: 9010, headSha: rebased, headBranch: ref, _timeline: ['queued', 'completed:success'] }) } });
  const { ok, receipt } = await f.land();
  assert.equal(ok, true, receipt.message);
  assert.equal(receipt.outcome, 'landed');
  assert.equal(receipt.main.before, moved);
  assert.equal(f.originMain(), rebased);
  assert.equal(f.originRef('refs/heads/feature'), pushed, "the lane's remote branch still holds the pre-rebase commit");
  assert.equal(f.pushes('refs/heads/feature'), 0);
  assert.deepEqual(await f.gh.dispatches(), [`workflow run ${WORKFLOW_FILE} -R ${REPO} --ref ${ref}`]);
  assert.equal(f.originRef(`refs/heads/${ref}`), null, 'the land ref is deleted afterwards');
  assert.equal(receipt.ci.dispatch.refDeleted, true);
});

test('a land/<sha> ref already at the commit is reused: no second push, and it is deleted afterwards', async t => {
  const f = await fixture(t);
  const ref = f.landRef(f.sha);
  f.git(f.clone, 'push', '--quiet', 'origin', `${f.sha}:refs/heads/${ref}`);
  await f.gh.set({ dispatch: { headSha: f.sha, run: f.run({ databaseId: 9002, _timeline: ['queued', 'completed:success'] }) } });
  const { ok, receipt } = await f.land({ ciOnly: true });
  assert.equal(ok, true, receipt.message);
  assert.equal(f.pushes(`refs/heads/${ref}`), 0);
  assert.deepEqual([receipt.ci.dispatch.refExisted, receipt.ci.dispatch.refPushed, receipt.ci.dispatch.performed], [true, false, true]);
  assert.equal((await f.gh.dispatches()).length, 1);
  assert.equal(f.originRef(`refs/heads/${ref}`), null);
  assert.equal(receipt.ci.dispatch.refDeleted, true);
});

test('--ci-only dispatches, waits, reports, and never pushes main', async t => {
  const f = await fixture(t);
  const ref = f.landRef(f.sha);
  await f.gh.set({ dispatch: { headSha: f.sha, run: f.run({ databaseId: 9020, _timeline: ['queued', 'in_progress', 'completed:success'] }) } });
  const { ok, receipt } = await f.land({ ciOnly: true });
  assert.equal(ok, true, receipt.message);
  assert.equal(receipt.outcome, 'ci-only');
  assert.deepEqual([receipt.ciOnly, receipt.dryRun], [true, false]);
  assert.equal(f.originMain(), f.base, 'main not pushed');
  assert.equal(f.pushes('refs/heads/main'), 0);
  assert.equal(receipt.push, null);
  assert.equal(check(receipt, 'push').result, 'skipped');
  assert.equal((await f.gh.dispatches()).length, 1);
  assert.equal(receipt.ci.run.id, 9020);
  assert.equal(f.originRef(`refs/heads/${ref}`), null);
  assert.match(receipt.message, /green/);

  // A green commit then lands without dispatching again.
  await f.gh.set({ dispatch: null });
  const landed = await f.land();
  assert.equal(landed.receipt.outcome, 'landed', landed.receipt.message);
  assert.equal((await f.gh.dispatches()).length, 1);
  assert.equal(f.originMain(), f.sha);
});

test('a detached HEAD dispatches from land/<sha> like any other commit', async t => {
  const f = await fixture(t);
  f.git(f.clone, 'checkout', '--quiet', '--detach');
  await f.gh.set({ dispatch: { headSha: f.sha, run: f.run({ databaseId: 9030, _timeline: ['queued', 'completed:success'] }) } });
  const { ok, receipt } = await f.land({ ciOnly: true });
  assert.equal(ok, true, receipt.message);
  assert.equal(receipt.branch, null);
  assert.deepEqual(await f.gh.dispatches(), [`workflow run ${WORKFLOW_FILE} -R ${REPO} --ref ${f.landRef(f.sha)}`]);
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
  assert.equal(f.calls.filter(c => c[0] === 'git' && c[1] === 'push' && c.at(-1).includes('land/')).length, 0, 'no land ref for a run that already exists');
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
  const ref = g.landRef(g.sha);
  await g.gh.set({ dispatch: { headSha: g.sha, run: g.run({ databaseId: 9005, _timeline: ['queued', 'in_progress', 'completed:failure'] }) } });
  ({ ok, receipt } = await g.land());
  assert.equal(ok, false);
  assert.equal(receipt.reason, 'ci-failed');
  assert.equal(receipt.ci.run.id, 9005);
  assert.equal((await g.gh.dispatches()).length, 1, 'dispatched once, never again after the failure');
  assert.equal(g.originMain(), g.base);
  assert.equal(g.originRef(`refs/heads/${ref}`), null, 'the land ref is deleted after a refusal too');
});

test('when gh prints no run URL, the run is found by listing; one that never appears ends the wait after its own bound', async t => {
  const f = await fixture(t);
  await f.gh.set({ dispatchSilent: true, dispatch: { headSha: f.sha, run: f.run({ databaseId: 9040, _hiddenFor: 2, _timeline: ['queued', 'completed:success'] }) } });
  let { ok, receipt } = await f.land({ ciOnly: true });
  assert.equal(ok, true, receipt.message);
  assert.deepEqual([receipt.ci.dispatch.runId, receipt.ci.dispatch.runUrl, receipt.ci.wait.followedRunId], [null, null, null]);
  assert.deepEqual(await f.gh.views(), [], 'nothing to view by id');
  assert.ok((await f.gh.lists()).length >= 4, 'listed until the run appeared and concluded');
  assert.deepEqual(receipt.ci.wait.states.map(s => s.state), ['dispatched', 'queued', 'concluded']);

  const g = await fixture(t);
  await g.gh.set({ dispatchSilent: true, dispatch: { headSha: g.sha, run: g.run({ databaseId: 9041, _hiddenFor: 100000 }) } });
  ({ ok, receipt } = await g.land({ ciOnly: true }));
  assert.equal(ok, false);
  assert.equal(receipt.outcome, 'error');
  assert.equal(receipt.reason, 'ci-wait-exceeded');
  assert.match(receipt.message, /not listed within 10 minutes/);
  assert.equal(g.clock.slept.length * POLL_MS, 10 * 60 * 1000 + POLL_MS, 'polled through the 10-minute bound and one more');
  assert.equal((await g.gh.dispatches()).length, 1);
  assert.equal(g.originRef(`refs/heads/${g.landRef(g.sha)}`), null, 'the land ref is deleted after the error');
});

test('a dispatched run followed by id whose head SHA is not the commit is refused at once', async t => {
  const f = await fixture(t);
  await f.gh.set({ dispatch: { headSha: f.base, run: f.run({ databaseId: 9050, headSha: f.base, status: 'queued', conclusion: '' }) } });
  const { ok, receipt } = await f.land({ ciOnly: true });
  assert.equal(ok, false);
  assert.equal(receipt.outcome, 'refused');
  assert.equal(receipt.reason, 'ci-wrong-commit');
  assert.match(receipt.message, new RegExp(`run 9050 .*${f.base}.*not ${f.sha}`));
  assert.deepEqual(f.clock.slept, [], 'refused before any wait');
  assert.equal(f.originRef(`refs/heads/${f.landRef(f.sha)}`), null);
});

test('the wait is bounded per state by the workflow\'s own lifecycle and ends as an error, without another dispatch', async t => {
  const f = await fixture(t);
  // A step-level timeout of 5 written before the job-level 60: the job's is the bound.
  const workflow = 'name: tests\non:\n  workflow_dispatch:\njobs:\n  suite:\n    runs-on: macos-latest\n    steps:\n      - run: echo one\n        timeout-minutes: 5\n      - run: echo two\n    timeout-minutes: 60\n';
  const sha = await f.commit(f.clone, `.github/workflows/${WORKFLOW_FILE}`, workflow);
  await f.gh.set({ dispatch: { headSha: sha, run: f.run({ databaseId: 9006, headSha: sha, _timeline: ['in_progress'] }) } });
  let { ok, receipt } = await f.land({ ciOnly: true, sleep: async ms => { f.clock.slept.push(ms); f.clock.now += 3600_000; } });
  assert.equal(ok, false);
  assert.equal(receipt.outcome, 'error');
  assert.equal(receipt.reason, 'ci-wait-exceeded');
  assert.equal(receipt.failurePhase, 'ci');
  assert.deepEqual([receipt.ci.wait.bounds.timeoutMinutes, receipt.ci.wait.bounds.timeoutSource], [60, `.github/workflows/${WORKFLOW_FILE}`]);
  assert.match(receipt.message, /running .*70 minutes.*timeout-minutes 60 from \.github\/workflows\/tests\.yml/);
  assert.ok(f.clock.slept.length >= 2 && f.clock.slept.length <= 4, `${f.clock.slept.length} polls for a 60-minute job timeout`);
  assert.equal((await f.gh.dispatches()).length, 1);
  assert.equal(receipt.ci.run.id, 9006);
  assert.equal(f.originMain(), f.base);

  // Queued forever: the bound is GitHub's queue limit, and the message says so.
  const g = await fixture(t);
  await g.gh.set({ dispatch: { headSha: g.sha, run: g.run({ databaseId: 9007, _timeline: ['queued'] }) } });
  ({ receipt } = await g.land({ ciOnly: true, sleep: async ms => { g.clock.slept.push(ms); g.clock.now += 3600_000; } }));
  assert.equal(receipt.reason, 'ci-wait-exceeded');
  assert.match(receipt.message, /queued .*24-hour queue limit/);
  assert.doesNotMatch(receipt.message, /github-default/);
  assert.ok(g.clock.slept.length >= 24 && g.clock.slept.length <= 26, `${g.clock.slept.length} polls for the 24-hour queue limit`);

  assert.equal(L.jobTimeoutMinutes(workflow), 60);
  assert.equal(L.jobTimeoutMinutes('jobs:\n  a:\n    steps:\n      - run: x\n        timeout-minutes: 5\n'), null);
  assert.equal(L.jobTimeoutMinutes('name: x\n'), null);
  assert.equal(L.jobTimeoutMinutes('jobs:\n  a:\n    timeout-minutes: 15\n  b:\n    timeout-minutes: 45\n'), 45);
});

test('an interrupted wait writes a partial receipt naming the awaited run and deletes the land ref', async t => {
  const f = await fixture(t);
  const ref = f.landRef(f.sha);
  await f.gh.set({ dispatch: { headSha: f.sha, run: f.run({ databaseId: 9060, _timeline: ['queued', 'in_progress'] }) } });
  const controller = new AbortController();
  const { ok, receipt, receiptPath } = await f.land({
    ciOnly: true, signal: controller.signal,
    sleep: async ms => { f.clock.slept.push(ms); f.clock.now += ms; if (f.clock.slept.length === 2) controller.abort(); },
  });
  assert.equal(ok, false);
  assert.equal(receipt.outcome, 'interrupted');
  assert.equal(receipt.reason, 'interrupted');
  assert.match(receipt.message, /run 9060 .*in_progress/);
  assert.equal(receipt.ci.run.id, 9060);
  assert.equal(JSON.parse(await fs.readFile(receiptPath, 'utf8')).outcome, 'interrupted');
  assert.equal(f.originRef(`refs/heads/${ref}`), null);
  assert.equal(receipt.ci.dispatch.refDeleted, true);
  assert.equal((await f.gh.dispatches()).length, 1);

  // Through the CLI: SIGINT during the wait does the same and exits 130.
  const g = await fixture(t);
  await g.gh.set({ dispatch: { headSha: g.sha, run: g.run({ databaseId: 9061, _timeline: ['queued', 'in_progress'] }) } });
  const { done } = g.cliSpawn(['--ci-only', '--receipt', g.receiptPath, '--gh', g.ghPath, '--repo', REPO], (line, child) => { if (/in progress/.test(line)) child.kill('SIGINT'); });
  const result = await done;
  assert.equal(result.code, 130, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /^interrupted\b.*run 9061/);
  assert.match(result.stderr, /dispatched/);
  assert.equal(JSON.parse(await fs.readFile(g.receiptPath, 'utf8')).ci.run.id, 9061);
  assert.equal(g.originRef(`refs/heads/${g.landRef(g.sha)}`), null);
  assert.equal(g.originMain(), g.base);
});

test('a listing that fills the --limit is signalled', async t => {
  const f = await fixture(t);
  await f.gh.runs(Array.from({ length: 150 }, (_, i) => f.run({ databaseId: 5000 + i, createdAt: `2026-10-13T12:${String(i % 60).padStart(2, '0')}:00Z` })));
  const { ok, receipt } = await f.land({ dryRun: true });
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
  const common = ['--receipt', f.receiptPath, '--gh', f.ghPath, '--repo', REPO, '--remote', 'origin'];
  let result = await f.cli(['--dry-run', ...common]);
  assert.equal(result.code, 0, result.stderr);
  const lines = result.stdout.trim().split('\n');
  assert.equal(lines.length, 1, result.stdout);
  assert.match(lines[0], /^dry-run\b/);
  assert.ok(lines[0].includes(f.receiptPath), 'the summary names the receipt');
  assert.equal(f.originMain(), f.base);
  assert.equal(JSON.parse(await fs.readFile(f.receiptPath, 'utf8')).outcome, 'dry-run');

  await f.gh.runs([f.run({ databaseId: 9, conclusion: 'failure' })]);
  result = await f.cli(['--no-dispatch', ...common]);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /^refused\b.*run 9 /);
  assert.equal(f.originMain(), f.base);

  result = await f.cli(['--bogus']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /--bogus/);
  result = await f.cli(['--workflow', 'other.yml']);
  assert.equal(result.code, 2, 'the workflow is pinned, not an argument');
  result = await f.cli(['--dry-run', '--ci-only']);
  assert.equal(result.code, 2, 'a dry run and ci-only exclude each other');

  // A two-line gh error still leaves the summary on one line.
  await f.gh.set({ fail: { command: 'run list', code: 1, stderr: 'gh: rate limit exceeded\ntry again in 12 minutes\n' } });
  result = await f.cli(['--no-dispatch', ...common]);
  assert.equal(result.code, 3);
  assert.equal(result.stdout.trim().split('\n').length, 1, result.stdout);
  assert.match(result.stdout, /^error\b.*rate limit.*12 minutes/);

  // A receipt that cannot be written still prints the summary, with the error on stderr.
  await f.gh.set({ fail: null });
  await f.gh.runs([f.run()]);
  await fs.writeFile(path.join(f.dir, 'not-a-dir'), '');
  result = await f.cli(['--dry-run', ...common.slice(2), '--receipt', path.join(f.dir, 'not-a-dir', 'receipt.json')]);
  assert.equal(result.code, 3);
  assert.match(result.stdout, /^dry-run\b/);
  assert.match(result.stderr, /receipt/);

  assert.deepEqual(L.parseArgs(['--dry-run', '--remote', 'upstream', '--receipt', 'r.json']),
    { dryRun: true, remote: 'upstream', receiptPath: path.resolve('r.json') });
  assert.deepEqual(L.parseArgs(['--ci-only', '--no-dispatch']), { ciOnly: true, noDispatch: true });
  assert.throws(() => L.parseArgs(['--receipt']), /requires a value/);
  assert.throws(() => L.parseArgs(['--dry-run', '--ci-only']), /exclude/);
});

test('the decoy repository that GIT_DIR and GIT_WORK_TREE point at was never touched', async () => {
  assert.equal(process.env.GIT_DIR, path.join(decoyRepo, '.git'), 'the decoy was in force for the whole file');
  const env = fixtureEnv('/dev/null');
  assert.ok(!Object.keys(env).some(k => k.startsWith('GIT_') && !['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_TERMINAL_PROMPT'].includes(k)), 'no inherited GIT_* variable survives');
  assert.deepEqual(await decoySnapshot(), decoyBefore);
});
