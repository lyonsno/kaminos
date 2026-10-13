#!/usr/bin/env node
// Kaminos landing check.
//
// Lanes land by fast-forwarding main to their branch tip; there are no pull
// requests. Main went red when a lane pushed a commit that had never had a
// green run of the tests workflow. This tool makes that push conditional:
//
//   clean-tree  the working tree has nothing modified or untracked;
//   fetch       the remote is fetched, so <remote>/main is current;
//   rebased     merge-base of <remote>/main and HEAD is <remote>/main, so the
//               branch contains main and the push is a fast-forward;
//   ci          gh reports a run of the tests workflow for HEAD's exact commit
//               that concluded success; a run for any other commit, or of
//               another workflow, never counts;
//   push        git push <remote> HEAD:main. git itself rejects the push when
//               main moved between the check and the push; that is reported
//               as its own outcome and not retried.
//
// A receipt is written for every invocation, including ones that refuse or
// crash, with every check and its result. --dry-run runs every check and
// writes the receipt without pushing. git and gh are injectable, as a command
// runner passed to land() or as --git and --gh paths on the command line, so
// the contracts run against a fixture.

import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RECEIPT_SCHEMA = 'kaminos.landing-receipt.v1';
export const CI_WORKFLOW = 'tests';
export const CHECKS = Object.freeze(['clean-tree', 'fetch', 'rebased', 'ci', 'push']);
export const RUN_FIELDS = 'databaseId,status,conclusion,workflowName,headSha';
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

class Refusal extends Error {
  constructor(outcome, reason, message) { super(message); this.outcome = outcome; this.reason = reason; }
}

const short = sha => (sha ? sha.slice(0, 9) : '(none)');

export async function land({
  root = process.cwd(),
  remote = 'origin',
  repo = null,
  workflow = CI_WORKFLOW,
  dryRun = false,
  receiptPath = null,
  git = 'git',
  gh = 'gh',
  run = execFileRunner(),
} = {}) {
  root = path.resolve(root);
  receiptPath = receiptPath ? path.resolve(receiptPath) : path.join(os.tmpdir(), `kaminos-land-${Date.now()}`, 'receipt.json');
  const receipt = {
    schema: RECEIPT_SCHEMA, outcome: null, ok: false, reason: null, message: null, failurePhase: null, error: null,
    dryRun: Boolean(dryRun), startedAt: new Date().toISOString(), finishedAt: null,
    root, branch: null, sha: null,
    remote: { name: remote, url: null, repo: repo || null, repoSource: repo ? 'argument' : null },
    main: { before: null, after: null },
    ci: { workflow, query: null, runs: [], run: null },
    checks: CHECKS.map(name => ({ name, result: 'skipped', detail: null })),
    push: null,
    effective: { git, gh, node: process.version, platform: `${process.platform}-${process.arch}` },
  };
  const checkOf = name => receipt.checks.find(c => c.name === name);
  const pass = (name, detail) => { Object.assign(checkOf(name), { result: 'pass', detail }); };
  const refuse = (name, reason, message, outcome = 'refused') => {
    Object.assign(checkOf(name), { result: 'fail', detail: message });
    throw new Refusal(outcome, reason, message);
  };
  const g = (...args) => run(git, args, { cwd: root });
  // Plumbing that must work for the check to mean anything; its failure is an
  // error of the run, not a refusal of the landing.
  const must = async (promise, what) => {
    const result = await promise;
    if (result.code !== 0) throw new Error(`${what} failed (exit ${result.code}): ${(result.stderr || result.error || '').trim()}`);
    return result.stdout.trim();
  };
  const remoteMain = async () => {
    const out = await must(g('ls-remote', remote, 'refs/heads/main'), `git ls-remote ${remote} refs/heads/main`);
    const sha = out.split(/\s+/)[0];
    if (!/^[0-9a-f]{40}$/.test(sha || '')) throw new Error(`git ls-remote ${remote} refs/heads/main returned no main: ${JSON.stringify(out)}`);
    return sha;
  };
  const write = async () => {
    receipt.finishedAt = new Date().toISOString();
    await fs.mkdir(path.dirname(receiptPath), { recursive: true });
    await fs.writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    return { ok: receipt.ok, receipt, receiptPath };
  };

  try {
    receipt.failurePhase = 'identify';
    receipt.sha = await must(g('rev-parse', '--verify', 'HEAD'), 'git rev-parse HEAD');
    const symbolic = await g('symbolic-ref', '--quiet', '--short', 'HEAD');
    receipt.branch = symbolic.code === 0 ? symbolic.stdout.trim() : null;
    receipt.remote.url = await must(g('remote', 'get-url', remote), `git remote get-url ${remote}`);
    if (!receipt.remote.repo) {
      receipt.remote.repo = repoFromRemoteUrl(receipt.remote.url);
      receipt.remote.repoSource = receipt.remote.repo ? 'remote-url' : null;
    }

    receipt.failurePhase = 'clean-tree';
    const status = await must(g('status', '--porcelain'), 'git status');
    if (status) {
      const paths = status.split('\n').filter(Boolean);
      refuse('clean-tree', 'dirty-tree', `working tree is not clean: ${paths.length} path(s) modified or untracked (${paths.slice(0, 5).map(l => l.slice(3)).join(', ')}${paths.length > 5 ? ', ...' : ''}); commit or remove them first`);
    }
    pass('clean-tree', 'nothing modified or untracked');

    receipt.failurePhase = 'fetch';
    const fetch = await g('fetch', '--quiet', remote);
    if (fetch.code !== 0) refuse('fetch', 'fetch-failed', `git fetch ${remote} failed (exit ${fetch.code}): ${(fetch.stderr || fetch.error || '').trim()}`);
    receipt.main.before = await must(g('rev-parse', '--verify', `refs/remotes/${remote}/main`), `git rev-parse ${remote}/main`);
    pass('fetch', `${remote}/main is ${receipt.main.before}`);

    receipt.failurePhase = 'rebased';
    const label = receipt.branch || `detached HEAD ${short(receipt.sha)}`;
    if (receipt.sha === receipt.main.before) refuse('rebased', 'nothing-to-land', `${label} is already ${remote}/main (${short(receipt.sha)}); nothing to land`);
    const mergeBase = await must(g('merge-base', `${remote}/main`, 'HEAD'), `git merge-base ${remote}/main HEAD`);
    if (mergeBase !== receipt.main.before) {
      refuse('rebased', 'not-rebased', `${label} does not contain ${remote}/main (${short(receipt.main.before)}); their merge-base is ${short(mergeBase)}. Rebase first, then land the rebased commit once its own CI run is green`);
    }
    pass('rebased', `merge-base of ${remote}/main and HEAD is ${remote}/main`);

    receipt.failurePhase = 'ci';
    if (!receipt.remote.repo) refuse('ci', 'repo-unresolved', `cannot tell the GitHub repository from the ${remote} URL ${JSON.stringify(receipt.remote.url)}; pass --repo owner/name`);
    const query = ['run', 'list', '-R', receipt.remote.repo, '--commit', receipt.sha, '--limit', '100', '--json', RUN_FIELDS];
    receipt.ci.query = [gh, ...query];
    const listed = await run(gh, query, { cwd: root });
    if (listed.code !== 0) refuse('ci', 'ci-query-failed', `gh run list exited ${listed.code === null ? 'without starting' : listed.code}: ${(listed.stderr || listed.error || '').trim()}`);
    let runs;
    try { runs = JSON.parse(listed.stdout); } catch (error) { refuse('ci', 'ci-query-failed', `gh run list output is not JSON (${error.message}): ${listed.stdout.trim().slice(0, 200)}`); }
    if (!Array.isArray(runs)) refuse('ci', 'ci-query-failed', `gh run list output is not a JSON array: ${listed.stdout.trim().slice(0, 200)}`);
    receipt.ci.runs = runs.map(r => ({
      id: r.databaseId, status: r.status, conclusion: r.conclusion, workflow: r.workflowName, headSha: r.headSha,
      counted: r.headSha === receipt.sha && r.workflowName === workflow,
    }));
    const counted = receipt.ci.runs.filter(r => r.counted);
    const green = counted.find(r => r.status === 'completed' && r.conclusion === 'success');
    const pending = counted.filter(r => r.status !== 'completed');
    const failed = counted.filter(r => r.status === 'completed' && r.conclusion !== 'success');
    const describeFailed = () => failed.map(r => `${r.id} concluded ${r.conclusion}`).join(', ');
    if (green) {
      receipt.ci.run = green;
      pass('ci', `run ${green.id} of the ${workflow} workflow concluded success for ${receipt.sha}`);
    } else if (!counted.length) {
      refuse('ci', 'ci-no-run', `no run of the ${workflow} workflow for ${receipt.sha}${runs.length ? ` (${runs.length} run(s) returned, none for this commit and workflow)` : ''}; push the branch or dispatch the workflow for it and wait for the run`);
    } else if (pending.length) {
      receipt.ci.run = pending[0];
      refuse('ci', 'ci-in-progress', `run ${pending[0].id} of the ${workflow} workflow for ${receipt.sha} is still ${pending[0].status}; wait for it${failed.length ? ` (run ${describeFailed()})` : ''}`);
    } else {
      receipt.ci.run = failed[0];
      refuse('ci', 'ci-failed', `run ${failed[0].id} of the ${workflow} workflow for ${receipt.sha} concluded ${failed[0].conclusion}${failed.length > 1 ? ` (also run ${failed.slice(1).map(r => `${r.id} concluded ${r.conclusion}`).join(', ')})` : ''}`);
    }

    receipt.failurePhase = 'push';
    if (dryRun) {
      Object.assign(checkOf('push'), { result: 'skipped', detail: 'dry run: push not performed' });
      receipt.main.after = await remoteMain();
      receipt.outcome = 'dry-run';
      receipt.message = `every check passed for ${short(receipt.sha)} (${label}); would fast-forward ${remote}/main from ${short(receipt.main.before)}; CI run ${receipt.ci.run.id} success; push not performed`;
    } else {
      const push = await g('push', remote, 'HEAD:main');
      receipt.push = { attempted: true, ok: push.code === 0, code: push.code, stdout: push.stdout, stderr: push.stderr, error: push.error };
      receipt.main.after = await remoteMain();
      if (push.code !== 0) {
        const detail = (push.stderr || push.error || '').trim();
        if (NON_FAST_FORWARD.test(detail)) {
          refuse('push', 'main-moved', `${remote}/main moved to ${short(receipt.main.after)} after the check (it was ${short(receipt.main.before)}); the push was rejected as non-fast-forward and not retried. Rebase onto it and land again once the rebased commit's CI run is green`, 'main-moved');
        }
        refuse('push', 'push-failed', `git push ${remote} HEAD:main exited ${push.code === null ? 'without starting' : push.code}: ${detail}`, 'push-failed');
      }
      if (receipt.main.after !== receipt.sha) throw new Error(`push reported success but ${remote}/main is ${receipt.main.after}, not ${receipt.sha}`);
      pass('push', `${remote}/main ${short(receipt.main.before)} -> ${short(receipt.sha)}`);
      receipt.outcome = 'landed';
      receipt.message = `landed ${short(receipt.sha)} (${label}) on ${remote}/main, which was ${short(receipt.main.before)}; CI run ${receipt.ci.run.id} success`;
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
    else if (flag === '--receipt') args.receiptPath = path.resolve(value());
    else if (flag === '--remote') args.remote = value();
    else if (flag === '--repo') args.repo = value();
    else if (flag === '--workflow') args.workflow = value();
    else if (flag === '--root') args.root = path.resolve(value());
    else if (flag === '--gh') args.gh = executable();
    else if (flag === '--git') args.git = executable();
    else throw new Error(`unknown argument ${flag}`);
  }
  return args;
}

const USAGE = 'usage: node tools/land.mjs [--dry-run] [--receipt <path>] [--remote <name>] [--repo <owner/name>] [--workflow <name>] [--root <path>] [--gh <path>] [--git <path>]';

const invokedAsMain = (() => { try { return Boolean(process.argv[1]) && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(path.resolve(process.argv[1])); } catch { return false; } })();
if (invokedAsMain) {
  // The exit code is set rather than forced: stdout to a pipe is asynchronous
  // on macOS, and process.exit() right after the summary could truncate it.
  let args = null;
  try { args = parseArgs(process.argv.slice(2)); } catch (error) {
    console.error(`${error.message}\n${USAGE}`);
    process.exitCode = 2;
  }
  if (args) {
    const result = await land(args);
    console.log(`${result.receipt.outcome}  ${result.receipt.message}; receipt: ${result.receiptPath}`);
    process.exitCode = result.ok ? 0 : 1;
  }
}
