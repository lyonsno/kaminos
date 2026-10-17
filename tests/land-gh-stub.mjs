// kaminos-test: helper — stands in for gh under tests/land-contracts.mjs; executed by the fixture, not a test
// Usage: node land-gh-stub.mjs <state.json> <gh arguments...>, or in-process
// as ghStub(statePath, argv, { env }), which returns { code, stdout, stderr };
// env is what the stub's own git and hook commands run with.
//
// The state file holds the canned answers and is rewritten on every call:
//   calls           every invocation's arguments, one string each
//   dispatches      the `workflow run` invocations
//   runsByCommit    { <sha>: [run, ...] } answered to `run list --commit <sha>`
//                   and searched by `run view <id>`; a run's _file is matched
//                   against --workflow; a run with a _timeline
//                   (['queued', 'in_progress', 'completed:success']) shows one
//                   entry per answer and stays on the last; a run with
//                   _hiddenFor > 0 is left out of that many answers first
//   pushTrigger     { headSha, run, originDir, updatesLog, logOffset } — the
//                   tests workflow's push trigger on land/**: before `run list`
//                   or `run view` answers, every push of refs/heads/land/<headSha>
//                   to the bare origin at originDir registers one run for
//                   headSha with event push and headBranch land/<headSha>, a
//                   copy of run (its databaseId plus the push's index). Pushes
//                   are read from updatesLog (one "<ref> <old> <new>" line per
//                   update, written by the origin's update hook), counting
//                   only lines past logOffset and never deletions; without a
//                   log, a ref that exists counts as one push. pushesSeen
//                   records how many it has registered
//   dispatch        { headSha, run } — a `workflow run` adds that run for that
//                   commit and prints its URL the way gh does, unless
//                   dispatchSilent is set, in which case it prints nothing;
//                   kept so contracts can assert the tool never calls it
//   dispatchFails   { code, stderr } — `workflow run` fails with these instead
//   hook            a shell script run once, before the next `run list` answers
//   fail            { command: 'run list', code, stderr } — that command fails
//   raw             text printed verbatim by `run list` instead of JSON
//   ignoreCommit    answer `run list` with every commit's runs, ignoring --commit
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function ghStub(statePath, argv, { env = process.env } = {}) {
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  state.calls.push(argv.join(' '));
  const save = () => fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  const flag = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
  const command = argv.slice(0, 2).join(' ');
  const allRuns = () => Object.values(state.runsByCommit).flat();
  const done = (code, stdout = '', stderr = '') => ({ code, stdout, stderr });

  // The push trigger: register one push run per push of land/<headSha> seen so far.
  function registerPushRuns() {
    const trigger = state.pushTrigger;
    if (!trigger) return;
    const ref = `refs/heads/land/${trigger.headSha}`;
    let pushes;
    if (trigger.updatesLog) {
      const lines = fs.existsSync(trigger.updatesLog) ? fs.readFileSync(trigger.updatesLog, 'utf8').split('\n').filter(Boolean) : [];
      pushes = lines.slice(trigger.logOffset || 0).filter(line => { const [name, , next] = line.split(' '); return name === ref && !/^0+$/.test(next); }).length;
    } else {
      let exists = false;
      try { execFileSync('git', [`--git-dir=${trigger.originDir}`, 'rev-parse', '--verify', '-q', ref], { stdio: 'ignore', env }); exists = true; } catch { exists = false; }
      pushes = exists ? 1 : 0;
    }
    trigger.pushesSeen ||= 0;
    for (; trigger.pushesSeen < pushes; trigger.pushesSeen += 1) {
      const run = JSON.parse(JSON.stringify(trigger.run));
      Object.assign(run, { databaseId: trigger.run.databaseId + trigger.pushesSeen, headSha: trigger.headSha, event: 'push', headBranch: `land/${trigger.headSha}` });
      run.url = run.url ? run.url.replace(/\d+$/, String(run.databaseId)) : run.url;
      (state.runsByCommit[trigger.headSha] ||= []).push(run);
    }
  }
  if (command === 'run list' || command === 'run view') registerPushRuns();

  // A run's answer for this call: hidden runs are skipped, timelines advance.
  function answer(run) {
    if (run._hiddenFor > 0) { run._hiddenFor -= 1; return null; }
    if (Array.isArray(run._timeline) && run._timeline.length) {
      const [status, conclusion] = String(run._timeline[0]).split(':');
      run.status = status;
      run.conclusion = conclusion || '';
      if (run._timeline.length > 1) run._timeline.shift();
    }
    return run;
  }
  const project = (run, fields) => Object.fromEntries(fields.map(f => [f, run[f] ?? (f === 'conclusion' ? '' : null)]));
  const fields = () => (flag('--json') || '').split(',').filter(Boolean);

  if (state.hook && command === 'run list') {
    const hook = state.hook;
    state.hook = null;
    save();
    execFileSync('sh', [hook], { stdio: ['ignore', 'ignore', 'inherit'], env });
  }
  if (state.fail && state.fail.command === command) {
    save();
    return done(state.fail.code ?? 1, '', state.fail.stderr || 'gh: stub failure\n');
  }

  if (command === 'run list') {
    if (state.raw != null) { save(); return done(0, state.raw); }
    const commit = flag('--commit');
    const workflow = flag('--workflow');
    const limit = Number(flag('--limit') || 20);
    const candidates = state.ignoreCommit ? allRuns() : (state.runsByCommit[commit] || []);
    const listed = [];
    for (const run of candidates) {
      if (workflow && run._file !== workflow) continue;
      const shown = answer(run);
      if (shown) listed.push(shown);
    }
    save();
    return done(0, `${JSON.stringify(listed.slice(0, limit).map(run => project(run, fields())))}\n`);
  }
  if (command === 'run view') {
    const id = Number(argv[2]);
    const run = allRuns().find(r => r.databaseId === id);
    const shown = run && answer(run);
    save();
    if (!shown) return done(1, '', `could not find run ${id}\n`);
    return done(0, `${JSON.stringify(project(shown, fields()))}\n`);
  }
  if (command === 'workflow run') {
    state.dispatches.push(argv.join(' '));
    if (state.dispatchFails) {
      save();
      return done(state.dispatchFails.code ?? 1, '', state.dispatchFails.stderr || 'gh: dispatch refused\n');
    }
    let created = null;
    if (state.dispatch) {
      const { headSha, run } = state.dispatch;
      created = JSON.parse(JSON.stringify(run));
      (state.runsByCommit[headSha] ||= []).push(created);
    }
    save();
    return done(0, created && !state.dispatchSilent ? `https://github.com/${flag('-R')}/actions/runs/${created.databaseId}\n` : '');
  }
  save();
  return done(64, '', `gh stub: unexpected command ${argv.join(' ')}\n`);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const [statePath, ...argv] = process.argv.slice(2);
  const { code, stdout, stderr } = ghStub(statePath, argv);
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  process.exitCode = code;
}
