#!/usr/bin/env node
// Kaminos landing check.
//
// Lanes land by fast-forwarding main to their branch tip; there are no pull
// requests. Main went red when a lane pushed a commit that had never had a
// green run of the tests workflow. This tool makes that push conditional.
// HEAD's commit is recorded once, at the start, and that recorded commit is
// what every later step checks and pushes, so a HEAD that moves meanwhile
// cannot land anything untested:
//
//   clean-tree  the working tree has nothing modified or untracked;
//   fetch       <remote>'s main is fetched into refs/remotes/<remote>/main;
//   rebased     merge-base of <remote>/main and the commit is <remote>/main,
//               so the branch contains main and the push is a fast-forward;
//   ci          gh reports a push-event run of .github/workflows/tests.yml for
//               the exact commit; the latest completed one must have concluded
//               success. Only push runs count: main's required status check
//               is satisfied by them alone, so a workflow_dispatch run (or a
//               run for any other commit) is listed in the receipt and never
//               counted or awaited. When no push run exists, the commit is
//               pushed to a tool-owned ref, land/<sha> (never the lane's
//               branch, never main), and that push is the trigger: the
//               workflow runs on pushes to land/**. A land/<sha> ref already
//               at the commit is deleted and pushed again, since an unchanged
//               ref fires no push. The push run for the commit is awaited and
//               the ref is deleted once the attempt concludes. A push run
//               already pending is awaited instead; a failed run is refused
//               and the ref is never pushed again for it. The tool never
//               calls gh workflow run.
//   push        git push <remote> <commit>:refs/heads/main. git itself rejects
//               the push when main moved between the check and the push; that
//               is reported as its own outcome and not retried.
//
// Modes: --dry-run runs the checks against existing runs and changes nothing
// on the remote (it implies --no-dispatch); --ci-only gets the commit's run
// green through the land/ ref, reports, and never pushes main; --no-dispatch
// (alias --no-trigger) refuses instead of pushing the land/ ref. A receipt with every check and its result
// is written whenever it can be. git and gh are injectable, as a command
// runner passed to land() or as --git and --gh paths on the command line, and
// so are the wait loop's clock, sleep, abort signal and progress sink, so the
// contracts run against a fixture in seconds.

import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RECEIPT_SCHEMA = 'kaminos.landing-receipt.v2';
export const WORKFLOW_FILE = 'tests.yml';
export const CHECKS = Object.freeze(['clean-tree', 'fetch', 'rebased', 'ci', 'push']);
export const RUN_FIELDS = 'databaseId,status,conclusion,workflowName,headSha,event,headBranch,url,createdAt,attempt';
export const RUN_LIST_LIMIT = 100;
export const POLL_MS = 30000;
export const LAND_REF_PREFIX = 'land/';
// The wait is bounded per state. A push run that gh has not listed yet gets
// the tool's own bound. GitHub fails a job queued longer than 24 hours.
// A running job ends at the workflow's job-level timeout-minutes (GitHub's
// default when the file sets none), plus a margin for the run to be marked
// completed.
export const PUSHED_LIMIT_MINUTES = 10;
// The only event whose runs satisfy main's required status check.
export const COUNTED_EVENT = 'push';
const QUEUE_LIMIT_MS = 24 * 60 * 60 * 1000;
const GITHUB_DEFAULT_TIMEOUT_MINUTES = 360;
const RUNNING_MARGIN_MS = 10 * 60 * 1000;
const NON_FAST_FORWARD = /\[rejected\]|non-fast-forward|fetch first/;

// The default command runner. It resolves with the exit code and both
// streams; a nonzero exit is a result, not an exception. A command that could
// not start at all resolves with code null and the error message.
export function execFileRunner({ env = process.env } = {}) {
  return (executable, args, { cwd } = {}) => new Promise(resolve => {
    execFile(executable, args, { cwd, env, encoding: 'utf8', maxBuffer: Infinity }, (error, stdout, stderr) => {
      if (!error) return resolve({ code: 0, stdout, stderr, error: null });
      if (typeof error.code === 'number') return resolve({ code: error.code, stdout, stderr, error: null });
      resolve({ code: null, stdout: stdout || '', stderr: stderr || '', error: error.message });
    });
  });
}

// owner/name from the GitHub remote URL forms git produces; null for anything else.
export function repoFromRemoteUrl(url) {
  const match = String(url || '').trim().match(/^(?:https?:\/\/(?:[^@/\s]+@)?github\.com\/|git@github\.com:|ssh:\/\/(?:git@)?github\.com(?::\d+)?\/)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/);
  return match ? `${match[1]}/${match[2]}` : null;
}

// The largest job-level timeout-minutes under jobs: in a workflow file, read
// by indentation so a step's timeout-minutes is never taken for the job's.
// null when no job sets one.
export function jobTimeoutMinutes(text) {
  const lines = String(text).split('\n');
  let i = lines.findIndex(line => /^jobs:\s*(#.*)?$/.test(line));
  if (i < 0) return null;
  let jobIndent = null;
  let fieldIndent = null;
  let best = null;
  for (i += 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const indent = line.match(/^\s*/)[0].length;
    if (indent === 0) break;
    if (jobIndent === null) jobIndent = indent;
    if (indent < jobIndent) break;
    if (indent === jobIndent) { fieldIndent = null; continue; }
    if (fieldIndent === null) fieldIndent = indent;
    if (indent !== fieldIndent) continue;
    const match = line.match(/^\s*timeout-minutes:\s*(\d+)/);
    if (match) best = Math.max(best ?? 0, Number(match[1]));
  }
  return best;
}

// A refusal is the landing not qualifying; an error is this run failing to
// find out; an interruption is a signal ending the wait. The receipt records
// all three; the exit code tells them apart.
class Refusal extends Error {
  constructor(outcome, reason, message) { super(message); this.outcome = outcome; this.reason = reason; }
}
class Failure extends Error {
  constructor(reason, message) { super(message); this.reason = reason; }
}
class Interrupted extends Error {}

const short = sha => (sha ? sha.slice(0, 9) : '(none)');
const oneLine = text => String(text).replace(/\s*[\r\n]+\s*/g, ' ').trim();
const defaultSleep = (ms, signal) => new Promise(resolve => {
  if (signal?.aborted) return resolve();
  const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
  function onAbort() { clearTimeout(timer); resolve(); }
  signal?.addEventListener('abort', onAbort, { once: true });
});
const defaultLog = line => { process.stderr.write(`${line}\n`); };
const byNewest = (a, b) => (Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0)) || ((b.id || 0) - (a.id || 0));
const isPending = run => run.status !== 'completed';
const NOT_PUSH = 'not a push run; the required check ignores it';
const normalizeRun = (r, commit) => {
  const reason = r.headSha !== commit ? 'another commit' : r.event !== COUNTED_EVENT ? NOT_PUSH : null;
  return {
    id: r.databaseId, status: r.status, conclusion: r.conclusion, workflow: r.workflowName, headSha: r.headSha,
    event: r.event, headBranch: r.headBranch, url: r.url, createdAt: r.createdAt, attempt: r.attempt, counted: reason === null, reason,
  };
};

export async function land({
  root = process.cwd(),
  remote = 'origin',
  repo = null,
  dryRun = false,
  ciOnly = false,
  noDispatch = false,
  receiptPath = null,
  git = 'git',
  gh = 'gh',
  run = execFileRunner(),
  sleep = defaultSleep,
  now = Date.now,
  pollMs = POLL_MS,
  signal = null,
  log = defaultLog,
} = {}) {
  root = path.resolve(root);
  if (receiptPath) receiptPath = path.resolve(receiptPath);
  // A dry run changes nothing on the remote, so it never pushes the land ref.
  if (dryRun) { noDispatch = true; ciOnly = false; }
  const receipt = {
    schema: RECEIPT_SCHEMA, outcome: null, ok: false, reason: null, message: null, failurePhase: null, error: null,
    dryRun: Boolean(dryRun), ciOnly: Boolean(ciOnly), noDispatch: Boolean(noDispatch), startedAt: new Date().toISOString(), finishedAt: null,
    root, branch: null, sha: null,
    remote: { name: remote, url: null, repo: repo || null, repoSource: repo ? 'argument' : null },
    main: { before: null, after: null, afterContainsSha: null, afterError: null },
    ci: { workflowFile: WORKFLOW_FILE, query: null, listings: 0, limit: RUN_LIST_LIMIT, limitReached: false, runs: [], run: null, main: null, trigger: null, wait: null },
    checks: CHECKS.map(name => ({ name, result: 'skipped', detail: null })),
    push: null,
    effective: { git, gh, pollMs, node: process.version, platform: `${process.platform}-${process.arch}` },
  };
  const checkOf = name => receipt.checks.find(c => c.name === name);
  const pass = (name, detail) => { Object.assign(checkOf(name), { result: 'pass', detail }); };
  const refuse = (name, reason, message, outcome = 'refused') => {
    Object.assign(checkOf(name), { result: 'fail', detail: message });
    throw new Refusal(outcome, reason, message);
  };
  const fail = (name, reason, message) => {
    if (name) Object.assign(checkOf(name), { result: 'fail', detail: message });
    throw new Failure(reason, message);
  };
  const g = (...args) => run(git, args, { cwd: root });
  const describe = result => (result.stderr || result.error || result.stdout || '').trim();
  const exitOf = result => (result.code === null ? 'without starting' : `exit ${result.code}`);
  // Plumbing that must work for a check to mean anything; its failure is an
  // error of this run, not a refusal of the landing.
  const must = async (promise, what) => {
    const result = await promise;
    if (result.code !== 0) throw new Failure('git-failed', `${what} failed (${exitOf(result)}): ${describe(result)}`);
    return result.stdout.trim();
  };
  const lsRemote = async ref => {
    const result = await g('ls-remote', remote, ref);
    if (result.code !== 0) return { sha: null, error: `git ls-remote ${remote} ${ref} failed (${exitOf(result)}): ${describe(result)}` };
    const sha = result.stdout.trim().split(/\s+/)[0];
    return { sha: /^[0-9a-f]{40}$/.test(sha || '') ? sha : null, error: null };
  };
  const limitNote = () => (receipt.ci.limitReached ? ` (the listing filled its --limit of ${RUN_LIST_LIMIT}; older runs for this commit may be missing)` : '');
  const label = () => receipt.branch || `detached HEAD ${short(receipt.sha)}`;
  const checkSignal = () => { if (signal?.aborted) throw new Interrupted('interrupted'); };

  // One `gh run list` for one commit, pinned to the workflow file. The local
  // headSha check stays: a run for any other commit never counts.
  const queryRuns = async commit => {
    const query = ['run', 'list', '-R', receipt.remote.repo, '--workflow', WORKFLOW_FILE, '--commit', commit, '--limit', String(RUN_LIST_LIMIT), '--json', RUN_FIELDS];
    receipt.ci.query ||= [gh, ...query];
    receipt.ci.listings += 1;
    const result = await run(gh, query, { cwd: root });
    if (result.code !== 0) return { runs: null, error: `gh run list ${exitOf(result)}: ${describe(result)}` };
    let parsed;
    try { parsed = JSON.parse(result.stdout); } catch (error) { return { runs: null, error: `gh run list output is not JSON (${error.message}): ${result.stdout.trim().slice(0, 200)}` }; }
    if (!Array.isArray(parsed)) return { runs: null, error: `gh run list output is not a JSON array: ${result.stdout.trim().slice(0, 200)}` };
    if (parsed.length >= RUN_LIST_LIMIT) receipt.ci.limitReached = true;
    return { runs: parsed.map(r => normalizeRun(r, commit)), error: null };
  };
  const listRuns = async commit => {
    const { runs, error } = await queryRuns(commit);
    if (error) fail('ci', 'ci-query-failed', error);
    return runs;
  };
  const latestCompleted = runs => runs.filter(r => r.counted && !isPending(r)).sort(byNewest)[0] || null;
  const pendingOf = runs => runs.filter(r => r.counted && isPending(r)).sort(byNewest);

  const waitBounds = async () => {
    let timeoutMinutes = GITHUB_DEFAULT_TIMEOUT_MINUTES;
    let timeoutSource = 'github-default';
    try {
      const minutes = jobTimeoutMinutes(await fs.readFile(path.join(root, '.github', 'workflows', WORKFLOW_FILE), 'utf8'));
      if (minutes !== null) { timeoutMinutes = minutes; timeoutSource = `.github/workflows/${WORKFLOW_FILE}`; }
    } catch { /* no workflow file at this root: GitHub's default applies */ }
    return {
      pushedMs: PUSHED_LIMIT_MINUTES * 60 * 1000, queuedMs: QUEUE_LIMIT_MS, runningMs: timeoutMinutes * 60 * 1000 + RUNNING_MARGIN_MS,
      timeoutMinutes, timeoutSource,
    };
  };
  const boundText = (state, bounds) => {
    if (state === 'pushed') return `not listed within ${PUSHED_LIMIT_MINUTES} minutes of the land ref push (the tool's own bound for a push run to appear)`;
    if (state === 'queued') return `queued for longer than GitHub's 24-hour queue limit`;
    const source = bounds.timeoutSource === 'github-default' ? `GitHub's default job timeout of ${bounds.timeoutMinutes} minutes` : `timeout-minutes ${bounds.timeoutMinutes} from ${bounds.timeoutSource}`;
    return `running for longer than the job can (${Math.round(bounds.runningMs / 60000)} minutes: ${source} plus ${RUNNING_MARGIN_MS / 60000} for completion)`;
  };

  // Poll until no counted run is pending and one has completed; the latest
  // completed run is the decision. One line is logged per state change, and
  // the bound is the workflow's own lifecycle, measured per state.
  const awaitDecision = async ({ initialRuns }) => {
    const bounds = await waitBounds();
    const wait = { pollMs, polls: 0, startedAt: new Date().toISOString(), endedAt: null, elapsedMs: 0, bounds, states: [] };
    receipt.ci.wait = wait;
    const started = now();
    let state = null;
    let stateStart = started;
    let runs = initialRuns;
    const transition = (next, detail) => {
      if (next === state) return;
      state = next;
      stateStart = now();
      wait.states.push({ state: next, at: new Date().toISOString(), detail });
      log(`landing: ${detail}`);
    };
    for (;;) {
      checkSignal();
      wait.polls += 1;
      wait.elapsedMs = now() - started;
      receipt.ci.runs = runs;
      const pending = pendingOf(runs);
      const decider = latestCompleted(runs);
      if (!pending.length && decider) {
        receipt.ci.run = decider;
        transition('concluded', `run ${decider.id} concluded ${decider.conclusion} for ${short(receipt.sha)}${decider.url ? ` (${decider.url})` : ''}`);
        wait.endedAt = new Date().toISOString();
        return decider;
      }
      receipt.ci.run = pending[0] || null;
      if (!pending.length) transition('pushed', `waiting for the push run of ${short(receipt.sha)} on ${LAND_REF_PREFIX}${receipt.sha} to be listed`);
      else if (pending.some(r => r.status === 'in_progress')) transition('running', `run ${pending[0].id} in progress for ${short(receipt.sha)}${pending[0].url ? ` (${pending[0].url})` : ''}`);
      else transition('queued', `run ${pending[0].id} queued (${pending[0].status}) for ${short(receipt.sha)}${pending[0].url ? ` (${pending[0].url})` : ''}`);
      const bound = state === 'running' ? bounds.runningMs : state === 'queued' ? bounds.queuedMs : bounds.pushedMs;
      if (now() - stateStart > bound) {
        fail('ci', 'ci-wait-exceeded', `run ${receipt.ci.run ? receipt.ci.run.id : '(not yet listed)'} of the tests workflow for ${receipt.sha} ${boundText(state, bounds)}; not pushing the land ref again. Inspect with gh run list -R ${receipt.remote.repo} --workflow ${WORKFLOW_FILE} --commit ${receipt.sha}`);
      }
      await sleep(pollMs, signal);
      checkSignal();
      runs = await listRuns(receipt.sha);
    }
  };

  // The trigger: push the commit to the tool-owned ref. The tests workflow runs
  // on pushes to land/**, and a push run is the only kind main's required
  // check accepts. A ref already at the commit fires nothing when pushed
  // again, so it is deleted first; a ref at any other commit is replaced by
  // the forced push. The ref is deleted by cleanup once the attempt concludes.
  const trigger = async () => {
    const ref = `${LAND_REF_PREFIX}${receipt.sha}`;
    const info = { ref, refExisted: false, previousSha: null, refRepushed: false, refPushed: false, pushedAt: null, refDeleted: null, refDeleteError: null };
    receipt.ci.trigger = info;
    const tip = await lsRemote(`refs/heads/${ref}`);
    if (tip.error) fail('ci', 'trigger-failed', tip.error);
    if (tip.sha === receipt.sha) {
      info.refExisted = true;
      const removed = await g('push', '--quiet', remote, `:refs/heads/${ref}`);
      if (removed.code !== 0) fail('ci', 'trigger-failed', `deleting ${ref} before pushing it again failed: git push ${remote} :refs/heads/${ref} (${exitOf(removed)}): ${describe(removed)}`);
      info.refRepushed = true;
    } else if (tip.sha) {
      info.previousSha = tip.sha;
    }
    const push = await g('push', '--quiet', remote, `+${receipt.sha}:refs/heads/${ref}`);
    if (push.code !== 0) fail('ci', 'trigger-failed', `git push ${remote} +${receipt.sha}:refs/heads/${ref} failed (${exitOf(push)}): ${describe(push)}`);
    info.refPushed = true;
    info.pushedAt = new Date().toISOString();
    log(`landing: pushed ${ref} for ${short(receipt.sha)}${info.refRepushed ? ' (deleted and pushed again: it was already at the commit)' : ''}; the tests workflow runs on that push`);
  };
  const cleanupRef = async () => {
    const info = receipt.ci.trigger;
    // Only a ref this run pushed is its to delete.
    if (!info || !info.ref || info.refDeleted !== null || !info.refPushed) return;
    const result = await g('push', '--quiet', remote, `:refs/heads/${info.ref}`);
    info.refDeleted = result.code === 0;
    info.refDeleteError = result.code === 0 ? null : `git push ${remote} :refs/heads/${info.ref} failed (${exitOf(result)}): ${describe(result)}`;
  };

  // On a failed run, report main's own latest run too, so a lane can compare
  // the failures; it does not decide whose failure it is.
  const mainStatusNote = async () => {
    const { runs, error } = await queryRuns(receipt.main.before);
    if (error) { receipt.ci.main = { sha: receipt.main.before, run: null, red: null, error }; return `; main's own status could not be read (${error})`; }
    const latest = latestCompleted(runs);
    receipt.ci.main = { sha: receipt.main.before, run: latest, red: latest ? latest.conclusion !== 'success' : null, error: null };
    if (!latest) return `; main (${short(receipt.main.before)}) has no completed run to compare with`;
    if (latest.conclusion !== 'success') return `; main is also red at run ${latest.id}; compare the failures before attributing${latest.url ? ` (main's run: ${latest.url})` : ''}`;
    return `; main's own latest run ${latest.id} is green${latest.url ? ` (${latest.url})` : ''}`;
  };

  const write = async () => {
    receipt.finishedAt = new Date().toISOString();
    receipt.message = oneLine(receipt.message || '');
    if (!receiptPath) {
      const stamp = receipt.finishedAt.replace(/[:.]/g, '-');
      receiptPath = path.join(root, 'test-results', `landing-${short(receipt.sha || 'unknown')}-${stamp}.json`);
    }
    let receiptError = null;
    try {
      await fs.mkdir(path.dirname(receiptPath), { recursive: true });
      await fs.writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    } catch (error) { receiptError = String(error?.message || error); }
    return { ok: receipt.ok, receipt, receiptPath, receiptError };
  };

  let decider = null;
  try {
    receipt.failurePhase = 'identify';
    receipt.sha = await must(g('rev-parse', '--verify', 'HEAD'), 'git rev-parse HEAD');
    const symbolic = await g('symbolic-ref', '--quiet', '--short', 'HEAD');
    receipt.branch = symbolic.code === 0 ? symbolic.stdout.trim() : null;
    receipt.remote.url = await must(g('remote', 'get-url', '--push', remote), `git remote get-url --push ${remote}`);
    if (!receipt.remote.repo) {
      receipt.remote.repo = repoFromRemoteUrl(receipt.remote.url);
      receipt.remote.repoSource = receipt.remote.repo ? 'push-url' : null;
    }
    if (!receipt.remote.repo) fail(null, 'repo-unresolved', `cannot tell the GitHub repository from the ${remote} push URL ${JSON.stringify(receipt.remote.url)}; pass --repo owner/name`);

    receipt.failurePhase = 'clean-tree';
    const status = await must(g('status', '--porcelain'), 'git status');
    if (status) {
      const paths = status.split('\n').filter(Boolean);
      refuse('clean-tree', 'dirty-tree', `working tree is not clean: ${paths.length} path(s) modified or untracked (${paths.slice(0, 5).map(l => l.slice(3)).join(', ')}${paths.length > 5 ? ', ...' : ''}); commit or remove them first`);
    }
    pass('clean-tree', 'nothing modified or untracked');

    receipt.failurePhase = 'fetch';
    const refspec = `+refs/heads/main:refs/remotes/${remote}/main`;
    const fetch = await g('fetch', '--quiet', remote, refspec);
    if (fetch.code !== 0) fail('fetch', 'fetch-failed', `git fetch ${remote} ${refspec} failed (${exitOf(fetch)}): ${describe(fetch)}`);
    receipt.main.before = await must(g('rev-parse', '--verify', `refs/remotes/${remote}/main`), `git rev-parse ${remote}/main`);
    pass('fetch', `${remote}/main is ${receipt.main.before}`);

    receipt.failurePhase = 'rebased';
    if (receipt.sha === receipt.main.before) refuse('rebased', 'nothing-to-land', `${label()} is already ${remote}/main (${short(receipt.sha)}); nothing to land`);
    const mergeBase = await must(g('merge-base', `refs/remotes/${remote}/main`, receipt.sha), `git merge-base ${remote}/main ${short(receipt.sha)}`);
    if (mergeBase === receipt.sha) refuse('rebased', 'behind-main', `${label()} (${short(receipt.sha)}) is behind ${remote}/main (${short(receipt.main.before)}): main already has this commit and has moved on, so there is nothing to land`);
    if (mergeBase !== receipt.main.before) {
      refuse('rebased', 'not-rebased', `${label()} does not contain ${remote}/main (${short(receipt.main.before)}); their merge-base is ${short(mergeBase)}. Rebase first, then land the rebased commit once its own CI run is green`);
    }
    pass('rebased', `merge-base of ${remote}/main and ${short(receipt.sha)} is ${remote}/main`);

    receipt.failurePhase = 'ci';
    checkSignal();
    let runs = await listRuns(receipt.sha);
    receipt.ci.runs = runs;
    decider = latestCompleted(runs);
    const pending = pendingOf(runs);
    if (pending.length) {
      receipt.ci.run = pending[0];
      if (noDispatch) {
        refuse('ci', 'ci-in-progress', `run ${pending[0].id} of the tests workflow for ${receipt.sha} is still ${pending[0].status}${pending[0].url ? ` (${pending[0].url})` : ''}; wait for it (gh run watch ${pending[0].id}) and land again${decider ? `; its latest completed run ${decider.id} concluded ${decider.conclusion}` : ''}`);
      }
      log(`landing: awaiting the pending push run ${pending[0].id} (${pending[0].status}) for ${short(receipt.sha)}; not pushing the land ref`);
      decider = await awaitDecision({ initialRuns: runs });
    } else if (!decider) {
      const ignored = runs.filter(r => r.reason === NOT_PUSH);
      const ignoredNote = ignored.length ? ` (${ignored.length} other run(s) for it, such as ${ignored[0].id} (${ignored[0].event}), do not count: ${NOT_PUSH})` : '';
      const none = `no push run of the tests workflow for ${receipt.sha}${ignoredNote}${limitNote()}`;
      if (noDispatch) {
        const how = `the tool pushes a ${LAND_REF_PREFIX}<sha> ref, the tests workflow runs on that push, and the tool waits for it`;
        const hint = ciOnly ? `drop --no-dispatch: ${how}` : dryRun ? `get one with node tools/land.mjs --ci-only: ${how}` : `drop --no-dispatch, or run node tools/land.mjs --ci-only: ${how}`;
        refuse('ci', 'ci-no-run', `${none}; ${hint}; then land again`);
      }
      if (ignored.length) log(`landing: ${ignored.length} run(s) for ${short(receipt.sha)} are not push runs and do not count (${NOT_PUSH})`);
      await trigger();
      decider = await awaitDecision({ initialRuns: [] });
    }
    receipt.ci.run = decider;
    if (decider.conclusion === 'success') {
      pass('ci', `run ${decider.id} of the tests workflow concluded success for ${receipt.sha}${receipt.ci.trigger?.refPushed ? ` after one push of ${receipt.ci.trigger.ref}` : ''}${limitNote()}`);
    } else {
      const note = await mainStatusNote();
      refuse('ci', 'ci-failed', `run ${decider.id} of the tests workflow for ${receipt.sha} concluded ${decider.conclusion}${decider.url ? ` (${decider.url})` : ''}${note}; not pushing the land ref again`);
    }

    receipt.failurePhase = 'push';
    if (dryRun || ciOnly) {
      Object.assign(checkOf('push'), { result: 'skipped', detail: dryRun ? 'dry run: push not performed' : 'ci-only: main not pushed' });
      const after = await lsRemote('refs/heads/main');
      if (!after.sha) fail('push', 'main-unreadable', after.error || `git ls-remote ${remote} refs/heads/main returned no main`);
      receipt.main.after = after.sha;
      receipt.main.afterContainsSha = false;
      const moved = after.sha !== receipt.main.before;
      if (dryRun && moved) {
        refuse('push', 'main-moved', `${remote}/main moved to ${short(after.sha)} while the checks ran (it was ${short(receipt.main.before)}); a push would have been rejected as non-fast-forward. Rebase onto it and run again once the rebased commit has its own green run`, 'main-moved');
      }
      receipt.outcome = dryRun ? 'dry-run' : 'ci-only';
      receipt.message = dryRun
        ? `every check passed for ${short(receipt.sha)} (${label()}); would fast-forward ${remote}/main from ${short(receipt.main.before)}; CI run ${decider.id} success; push not performed${limitNote()}`
        : `CI is green for ${short(receipt.sha)} (${label()}): run ${decider.id} success${decider.url ? ` (${decider.url})` : ''}; main not pushed${moved ? `; ${remote}/main has since moved to ${short(after.sha)}, so rebase before landing` : `; land with node tools/land.mjs`}${limitNote()}`;
    } else {
      const push = await g('push', remote, `${receipt.sha}:refs/heads/main`);
      receipt.push = { attempted: true, ok: push.code === 0, code: push.code, stdout: push.stdout, stderr: push.stderr, error: push.error };
      if (push.code !== 0) {
        const after = await lsRemote('refs/heads/main');
        receipt.main.after = after.sha;
        receipt.main.afterError = after.error;
        const detail = describe(push);
        if (NON_FAST_FORWARD.test(detail)) {
          refuse('push', 'main-moved', `${remote}/main moved to ${short(after.sha)} after the check (it was ${short(receipt.main.before)}); the push was rejected as non-fast-forward and not retried. Rebase onto it and land again once the rebased commit has its own green run`, 'main-moved');
        }
        fail('push', 'push-failed', `git push ${remote} ${receipt.sha}:refs/heads/main failed (${exitOf(push)}): ${detail}`);
      }
      // The push succeeded, so the commit is on main: landed. Reading main
      // back afterwards informs the receipt and cannot change that.
      pass('push', `${remote}/main ${short(receipt.main.before)} -> ${short(receipt.sha)}`);
      receipt.outcome = 'landed';
      const after = await lsRemote('refs/heads/main');
      receipt.main.after = after.sha;
      receipt.main.afterError = after.error;
      let afterNote = '';
      if (after.sha === receipt.sha) {
        receipt.main.afterContainsSha = true;
      } else if (after.sha) {
        const fetched = await g('fetch', '--quiet', remote, refspec);
        const contains = fetched.code === 0 ? await g('merge-base', '--is-ancestor', receipt.sha, after.sha) : null;
        receipt.main.afterContainsSha = contains ? (contains.code === 0 ? true : contains.code === 1 ? false : null) : null;
        afterNote = receipt.main.afterContainsSha === true ? `; main is now ${short(after.sha)}, which contains it (another lane landed on top)`
          : receipt.main.afterContainsSha === false ? `; main is now ${short(after.sha)}, which does not contain it (main was rewritten after the push)`
          : `; main is now ${short(after.sha)}, not yet fetched to confirm it contains the commit`;
      } else {
        afterNote = `; main could not be read back afterwards (${after.error})`;
      }
      receipt.message = `landed ${short(receipt.sha)} (${label()}) on ${remote}/main, which was ${short(receipt.main.before)}; CI run ${decider.id} success${afterNote}${limitNote()}`;
    }
    receipt.ok = true;
    receipt.failurePhase = null;
  } catch (error) {
    receipt.ok = false;
    if (error instanceof Refusal) {
      receipt.outcome = error.outcome;
      receipt.reason = error.reason;
      receipt.message = error.message;
      receipt.failurePhase = null;
    } else if (error instanceof Interrupted) {
      receipt.outcome = 'interrupted';
      receipt.reason = 'interrupted';
      const awaited = receipt.ci.run;
      const pushed = receipt.ci.trigger?.refPushed ? receipt.ci.trigger : null;
      if (awaited) {
        receipt.message = `interrupted while awaiting run ${awaited.id} (${awaited.status}${awaited.url ? `, ${awaited.url}` : ''}) for ${receipt.sha}; the run continues on GitHub, and running the tool again awaits it rather than pushing the land ref again`;
      } else if (pushed) {
        receipt.message = `interrupted after pushing ${pushed.ref} for ${receipt.sha}, before gh listed its push run; that run continues on GitHub. A re-run awaits it once gh lists it; a re-run before then pushes the ref again and starts a second run, so check gh run list -R ${receipt.remote.repo} --workflow ${WORKFLOW_FILE} --commit ${receipt.sha} first`;
      } else {
        receipt.message = `interrupted during ${receipt.failurePhase} for ${receipt.sha || '(commit not yet read)'}; no land ref was pushed`;
      }
    } else if (error instanceof Failure) {
      receipt.outcome = 'error';
      receipt.reason = error.reason;
      receipt.message = `${error.message} [phase ${receipt.failurePhase}]`;
    } else {
      receipt.outcome = 'error';
      receipt.reason = 'error';
      receipt.message = `failed during ${receipt.failurePhase}: ${error?.message || error}`;
      receipt.error = String(error?.stack || error);
    }
  }
  // The attempt has concluded one way or another: the tool-owned ref goes.
  try { await cleanupRef(); } catch (error) {
    if (receipt.ci.trigger) { receipt.ci.trigger.refDeleted = false; receipt.ci.trigger.refDeleteError = String(error?.message || error); }
  }
  if (receipt.ci.trigger?.refDeleted === false) receipt.message += `; the ${receipt.ci.trigger.ref} ref could not be deleted (${receipt.ci.trigger.refDeleteError})`;
  return write();
}

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = () => {
      if (i + 1 >= argv.length) throw new Error(`${flag} requires a value`);
      return argv[++i];
    };
    const executable = () => { const v = value(); return v.includes('/') ? path.resolve(v) : v; };
    if (flag === '--dry-run') args.dryRun = true;
    else if (flag === '--ci-only') args.ciOnly = true;
    else if (flag === '--no-dispatch' || flag === '--no-trigger') args.noDispatch = true;
    else if (flag === '--receipt') args.receiptPath = path.resolve(value());
    else if (flag === '--remote') args.remote = value();
    else if (flag === '--repo') args.repo = value();
    else if (flag === '--root') args.root = path.resolve(value());
    else if (flag === '--gh') args.gh = executable();
    else if (flag === '--git') args.git = executable();
    else throw new Error(`unknown argument ${flag}`);
  }
  if (args.dryRun && args.ciOnly) throw new Error('--dry-run and --ci-only exclude each other: a dry run changes nothing on the remote');
  return args;
}

const USAGE = 'usage: node tools/land.mjs [--dry-run | --ci-only] [--no-dispatch | --no-trigger] [--receipt <path>] [--remote <name>] [--repo <owner/name>] [--root <path>] [--gh <path>] [--git <path>]';

const invokedAsMain = (() => { try { return Boolean(process.argv[1]) && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(path.resolve(process.argv[1])); } catch { return false; } })();
if (invokedAsMain) {
  // Exit codes: 0 landed, or a dry run or ci-only that passed every check;
  // 1 refused; 2 bad arguments; 3 an error (this run could not find out, or
  // could not write its receipt); 130 interrupted by a signal, after a
  // partial receipt. The exit code is set rather than forced: stdout to a
  // pipe is asynchronous, and process.exit() right after the summary could
  // truncate it.
  let args = null;
  try { args = parseArgs(process.argv.slice(2)); } catch (error) {
    console.error(`${error.message}\n${USAGE}`);
    process.exitCode = 2;
  }
  if (args) {
    const controller = new AbortController();
    for (const name of ['SIGINT', 'SIGTERM']) process.once(name, () => { console.error(`landing: ${name} received; writing the receipt and stopping`); controller.abort(); });
    // KAMINOS_LAND_POLL_MS overrides the poll interval (a whole number of
    // milliseconds); the receipt records the interval used.
    const pollOverride = process.env.KAMINOS_LAND_POLL_MS;
    if (pollOverride !== undefined && !/^\d+$/.test(pollOverride)) console.error(`landing: KAMINOS_LAND_POLL_MS=${JSON.stringify(pollOverride)} is not a whole number of milliseconds; polling every ${POLL_MS} ms`);
    const pollMs = pollOverride !== undefined && /^\d+$/.test(pollOverride) ? Number(pollOverride) : POLL_MS;
    if (pollMs !== POLL_MS) console.error(`landing: polling every ${pollMs} ms (KAMINOS_LAND_POLL_MS; default ${POLL_MS} ms); every poll is a gh call on the shared API limit`);
    const result = await land({ ...args, pollMs, signal: controller.signal });
    console.log(`${result.receipt.outcome}  ${result.receipt.message}; receipt: ${result.receiptError ? 'not written' : result.receiptPath}`);
    if (result.receiptError) console.error(`receipt could not be written to ${result.receiptPath}: ${result.receiptError}`);
    const outcome = result.receipt.outcome;
    process.exitCode = result.receiptError ? 3 : outcome === 'interrupted' ? 130 : result.ok ? 0 : outcome === 'error' ? 3 : 1;
  }
}
