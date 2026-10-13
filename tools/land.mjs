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
//   ci          gh reports a run of .github/workflows/tests.yml for the exact
//               commit; the latest completed one must have concluded success.
//               A run for any other commit never counts. When no run exists,
//               the branch is pushed at the commit if the remote's isn't there
//               already, the workflow is dispatched once, and the run whose
//               headSha is the commit is awaited; a run already pending is
//               awaited instead of dispatching; a failed run is refused and
//               never re-dispatched. --no-dispatch refuses instead of waiting.
//   push        git push <remote> <commit>:refs/heads/main. git itself rejects
//               the push when main moved between the check and the push; that
//               is reported as its own outcome and not retried.
//
// A receipt with every check and its result is written whenever it can be;
// --dry-run runs everything but the push to main. git and gh are injectable,
// as a command runner passed to land() or as --git and --gh paths on the
// command line, and so are the wait loop's clock and sleep, so the contracts
// run against a fixture in seconds.

import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RECEIPT_SCHEMA = 'kaminos.landing-receipt.v1';
export const WORKFLOW_FILE = 'tests.yml';
export const CHECKS = Object.freeze(['clean-tree', 'fetch', 'rebased', 'ci', 'push']);
export const RUN_FIELDS = 'databaseId,status,conclusion,workflowName,headSha,event,headBranch,url,createdAt';
export const RUN_LIST_LIMIT = 100;
export const POLL_MS = 30000;
// The wait is bounded by the workflow's own lifecycle: GitHub fails a job
// queued longer than 24 hours, and a running job ends at the workflow's
// timeout-minutes (GitHub's default when the file sets none), plus a margin
// for the run to be marked completed.
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

// A refusal is the landing not qualifying; an error is this run failing to
// find out. The receipt records both; the exit code tells them apart.
class Refusal extends Error {
  constructor(outcome, reason, message) { super(message); this.outcome = outcome; this.reason = reason; }
}
class Failure extends Error {
  constructor(reason, message) { super(message); this.reason = reason; }
}

const short = sha => (sha ? sha.slice(0, 9) : '(none)');
const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const byNewest = (a, b) => (Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0)) || ((b.id || 0) - (a.id || 0));
const isPending = run => run.status !== 'completed';

export async function land({
  root = process.cwd(),
  remote = 'origin',
  repo = null,
  dryRun = false,
  noDispatch = false,
  receiptPath = null,
  git = 'git',
  gh = 'gh',
  run = execFileRunner(),
  sleep = defaultSleep,
  now = Date.now,
  pollMs = POLL_MS,
} = {}) {
  root = path.resolve(root);
  if (receiptPath) receiptPath = path.resolve(receiptPath);
  const receipt = {
    schema: RECEIPT_SCHEMA, outcome: null, ok: false, reason: null, message: null, failurePhase: null, error: null,
    dryRun: Boolean(dryRun), noDispatch: Boolean(noDispatch), startedAt: new Date().toISOString(), finishedAt: null,
    root, branch: null, sha: null,
    remote: { name: remote, url: null, repo: repo || null, repoSource: repo ? 'argument' : null },
    main: { before: null, after: null, afterContainsSha: null, afterError: null },
    ci: { workflowFile: WORKFLOW_FILE, query: null, listings: 0, limit: RUN_LIST_LIMIT, limitReached: false, runs: [], run: null, main: null, dispatch: null, wait: null },
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
    const runs = parsed.map(r => ({
      id: r.databaseId, status: r.status, conclusion: r.conclusion, workflow: r.workflowName, headSha: r.headSha,
      event: r.event, headBranch: r.headBranch, url: r.url, createdAt: r.createdAt, counted: r.headSha === commit,
    }));
    return { runs, error: null };
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
      const text = await fs.readFile(path.join(root, '.github', 'workflows', WORKFLOW_FILE), 'utf8');
      const match = text.match(/^\s*timeout-minutes:\s*(\d+)/m);
      if (match) { timeoutMinutes = Number(match[1]); timeoutSource = `.github/workflows/${WORKFLOW_FILE}`; }
    } catch { /* no workflow file at this root: GitHub's default applies */ }
    return { queuedMs: QUEUE_LIMIT_MS, runningMs: timeoutMinutes * 60 * 1000 + RUNNING_MARGIN_MS, timeoutMinutes, timeoutSource };
  };

  // Poll until no counted run is pending and one has completed; the latest
  // completed run is the decision. The bound is the workflow's own lifecycle,
  // measured per phase: queued (or not yet listed) and running.
  const awaitDecision = async initialRuns => {
    const bounds = await waitBounds();
    const wait = { pollMs, polls: 0, startedAt: new Date().toISOString(), endedAt: null, elapsedMs: 0, bounds };
    receipt.ci.wait = wait;
    const started = now();
    let phase = null;
    let phaseStart = started;
    let runs = initialRuns;
    for (;;) {
      wait.polls += 1;
      wait.elapsedMs = now() - started;
      receipt.ci.runs = runs;
      const pending = pendingOf(runs);
      const decider = latestCompleted(runs);
      if (!pending.length && decider) {
        wait.endedAt = new Date().toISOString();
        return decider;
      }
      receipt.ci.run = pending[0] || null;
      const observed = pending.some(r => r.status === 'in_progress') ? 'running' : 'queued';
      if (observed !== phase) { phase = observed; phaseStart = now(); }
      const bound = phase === 'running' ? bounds.runningMs : bounds.queuedMs;
      if (now() - phaseStart > bound) {
        fail('ci', 'ci-wait-exceeded', `run ${receipt.ci.run ? receipt.ci.run.id : '(not yet listed)'} of the tests workflow for ${receipt.sha} has been ${phase} for longer than the workflow's own lifecycle allows (${Math.round(bound / 60000)} minutes, from ${bounds.timeoutSource}); not dispatching again. Inspect it with gh run list -R ${receipt.remote.repo} --commit ${receipt.sha}`);
      }
      await sleep(pollMs);
      runs = await listRuns(receipt.sha);
    }
  };

  // Put the branch at the commit on the remote if it is not there already,
  // then dispatch the workflow for it once.
  const dispatch = async () => {
    const info = { performed: false, command: null, branchTip: null, branchPushed: false };
    receipt.ci.dispatch = info;
    const tip = await lsRemote(`refs/heads/${receipt.branch}`);
    if (tip.error) fail('ci', 'dispatch-failed', tip.error);
    info.branchTip = tip.sha;
    if (tip.sha !== receipt.sha) {
      const push = await g('push', remote, `${receipt.sha}:refs/heads/${receipt.branch}`);
      if (push.code !== 0) fail('ci', 'branch-push-failed', `git push ${remote} ${receipt.sha}:refs/heads/${receipt.branch} failed (${exitOf(push)}): ${describe(push)}`);
      info.branchPushed = true;
      info.branchTip = receipt.sha;
    }
    const command = ['workflow', 'run', WORKFLOW_FILE, '-R', receipt.remote.repo, '--ref', receipt.branch];
    info.command = [gh, ...command];
    const result = await run(gh, command, { cwd: root });
    if (result.code !== 0) fail('ci', 'dispatch-failed', `gh workflow run ${WORKFLOW_FILE} --ref ${receipt.branch} ${exitOf(result)}: ${describe(result)}`);
    info.performed = true;
  };

  // On a failed run, say whether main itself is red at its own latest run, so
  // a lane can tell an inherited failure from its own.
  const mainStatusNote = async () => {
    const { runs, error } = await queryRuns(receipt.main.before);
    if (error) { receipt.ci.main = { sha: receipt.main.before, run: null, red: null, error }; return `; main's own status could not be read (${error})`; }
    const latest = latestCompleted(runs);
    receipt.ci.main = { sha: receipt.main.before, run: latest, red: latest ? latest.conclusion !== 'success' : null, error: null };
    if (!latest) return `; main (${short(receipt.main.before)}) has no completed run to compare with`;
    if (latest.conclusion !== 'success') return `; main itself is red at run ${latest.id}; this branch inherits it`;
    return `; main's own latest run ${latest.id} is green, so the failure is this branch's`;
  };

  const write = async () => {
    receipt.finishedAt = new Date().toISOString();
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
    const dispatchHint = receipt.branch ? `gh workflow run ${WORKFLOW_FILE} -R ${receipt.remote.repo} --ref ${receipt.branch}` : null;
    let runs = await listRuns(receipt.sha);
    receipt.ci.runs = runs;
    let decider = latestCompleted(runs);
    const pending = pendingOf(runs);
    if (pending.length) {
      receipt.ci.run = pending[0];
      if (noDispatch) {
        refuse('ci', 'ci-in-progress', `run ${pending[0].id} of the tests workflow for ${receipt.sha} is still ${pending[0].status}; wait for it (gh run watch ${pending[0].id}) and land again${decider ? `; its latest completed run ${decider.id} concluded ${decider.conclusion}` : ''}`);
      }
      decider = await awaitDecision(runs);
    } else if (!decider) {
      const none = `no run of the tests workflow for ${receipt.sha}${limitNote()}`;
      if (noDispatch) refuse('ci', 'ci-no-run', `${none}; dispatch one with: ${dispatchHint || `gh workflow run ${WORKFLOW_FILE} -R ${receipt.remote.repo} --ref <branch at this commit>`} (the branch must be at this commit on ${remote} first), wait for it with gh run watch <run id>, then land again`);
      if (!receipt.branch) refuse('ci', 'ci-no-run', `${none}, and HEAD is detached, so there is no branch to dispatch the workflow for; check out a branch at this commit, push it, and dispatch with: gh workflow run ${WORKFLOW_FILE} -R ${receipt.remote.repo} --ref <branch>`);
      await dispatch();
      decider = await awaitDecision([]);
    }
    receipt.ci.run = decider;
    if (decider.conclusion === 'success') {
      pass('ci', `run ${decider.id} of the tests workflow concluded success for ${receipt.sha}${receipt.ci.dispatch?.performed ? ' after one dispatch' : ''}${limitNote()}`);
    } else {
      const note = await mainStatusNote();
      refuse('ci', 'ci-failed', `run ${decider.id} of the tests workflow for ${receipt.sha} concluded ${decider.conclusion}${decider.url ? ` (${decider.url})` : ''}${note}; not dispatching again`);
    }

    receipt.failurePhase = 'push';
    if (dryRun) {
      Object.assign(checkOf('push'), { result: 'skipped', detail: 'dry run: push not performed' });
      const after = await lsRemote('refs/heads/main');
      if (!after.sha) fail('push', 'main-unreadable', after.error || `git ls-remote ${remote} refs/heads/main returned no main`);
      receipt.main.after = after.sha;
      if (after.sha !== receipt.main.before) {
        refuse('push', 'main-moved', `${remote}/main moved to ${short(after.sha)} while the checks ran (it was ${short(receipt.main.before)}); a push would have been rejected as non-fast-forward. Rebase onto it and run again once the rebased commit has its own green run`, 'main-moved');
      }
      receipt.main.afterContainsSha = false;
      receipt.outcome = 'dry-run';
      receipt.message = `every check passed for ${short(receipt.sha)} (${label()}); would fast-forward ${remote}/main from ${short(receipt.main.before)}; CI run ${decider.id} success; push not performed${limitNote()}`;
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
    else if (flag === '--no-dispatch') args.noDispatch = true;
    else if (flag === '--receipt') args.receiptPath = path.resolve(value());
    else if (flag === '--remote') args.remote = value();
    else if (flag === '--repo') args.repo = value();
    else if (flag === '--root') args.root = path.resolve(value());
    else if (flag === '--gh') args.gh = executable();
    else if (flag === '--git') args.git = executable();
    else throw new Error(`unknown argument ${flag}`);
  }
  return args;
}

const USAGE = 'usage: node tools/land.mjs [--dry-run] [--no-dispatch] [--receipt <path>] [--remote <name>] [--repo <owner/name>] [--root <path>] [--gh <path>] [--git <path>]';

const invokedAsMain = (() => { try { return Boolean(process.argv[1]) && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(path.resolve(process.argv[1])); } catch { return false; } })();
if (invokedAsMain) {
  // Exit codes: 0 landed or a dry run that passed every check, 1 refused,
  // 2 bad arguments, 3 an error (this run could not find out, or could not
  // write its receipt). The exit code is set rather than forced: stdout to a
  // pipe is asynchronous, and process.exit() right after the summary could
  // truncate it.
  let args = null;
  try { args = parseArgs(process.argv.slice(2)); } catch (error) {
    console.error(`${error.message}\n${USAGE}`);
    process.exitCode = 2;
  }
  if (args) {
    const result = await land(args);
    console.log(`${result.receipt.outcome}  ${result.receipt.message}; receipt: ${result.receiptError ? 'not written' : result.receiptPath}`);
    if (result.receiptError) console.error(`receipt could not be written to ${result.receiptPath}: ${result.receiptError}`);
    process.exitCode = result.receiptError ? 3 : result.ok ? 0 : result.receipt.outcome === 'error' ? 3 : 1;
  }
}
