// kaminos-test: helper — stands in for gh under tests/land-contracts.mjs; executed by the fixture, not a test
// Usage: node land-gh-stub.mjs <state.json> <gh arguments...>
//
// The state file holds the canned answers and is rewritten on every call:
//   calls           every invocation's arguments, one string each
//   dispatches      the `workflow run` invocations
//   runsByCommit    { <sha>: [run, ...] } answered to `run list --commit <sha>`;
//                   a run's _file is matched against `--workflow`; a run with
//                   a _timeline (['queued', 'in_progress', 'completed:success'])
//                   shows one entry per listing and stays on the last; a run
//                   with _hiddenFor > 0 is left out of that many listings first
//   dispatch        { headSha, run } — a `workflow run` adds that run for that commit
//   dispatchFails   { code, stderr } — `workflow run` fails with these instead
//   hook            a shell script run once, before the next `run list` answers
//   fail            { command: 'run list', code, stderr } — that command fails
//   raw             text printed verbatim by `run list` instead of JSON
//   ignoreCommit    answer `run list` with every commit's runs, ignoring --commit
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const [statePath, ...argv] = process.argv.slice(2);
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
state.calls.push(argv.join(' '));
const save = () => fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
const flag = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const command = argv.slice(0, 2).join(' ');

if (state.hook && command === 'run list') {
  const hook = state.hook;
  state.hook = null;
  save();
  execFileSync('sh', [hook], { stdio: ['ignore', 'ignore', 'inherit'] });
}
if (state.fail && state.fail.command === command) {
  save();
  process.stderr.write(state.fail.stderr || 'gh: stub failure\n');
  process.exit(state.fail.code ?? 1);
}

if (command === 'run list') {
  if (state.raw != null) { save(); process.stdout.write(state.raw); process.exit(0); }
  const commit = flag('--commit');
  const workflow = flag('--workflow');
  const limit = Number(flag('--limit') || 20);
  const fields = (flag('--json') || '').split(',').filter(Boolean);
  const listed = [];
  // ignoreCommit makes the stub answer with every commit's runs, the way a
  // broken --commit filter would; the tool must still count only its own.
  const candidates = state.ignoreCommit ? Object.values(state.runsByCommit).flat() : (state.runsByCommit[commit] || []);
  for (const run of candidates) {
    if (workflow && run._file !== workflow) continue;
    if (run._hiddenFor > 0) { run._hiddenFor -= 1; continue; }
    if (Array.isArray(run._timeline) && run._timeline.length) {
      const [status, conclusion] = String(run._timeline[0]).split(':');
      run.status = status;
      run.conclusion = conclusion || '';
      if (run._timeline.length > 1) run._timeline.shift();
    }
    listed.push(run);
  }
  const projected = listed.slice(0, limit).map(run => Object.fromEntries(fields.map(f => [f, run[f] ?? (f === 'conclusion' ? '' : null)])));
  save();
  process.stdout.write(`${JSON.stringify(projected)}\n`);
} else if (command === 'workflow run') {
  state.dispatches.push(argv.join(' '));
  if (state.dispatchFails) {
    save();
    process.stderr.write(state.dispatchFails.stderr || 'gh: dispatch refused\n');
    process.exit(state.dispatchFails.code ?? 1);
  }
  if (state.dispatch) {
    const { headSha, run } = state.dispatch;
    (state.runsByCommit[headSha] ||= []).push(JSON.parse(JSON.stringify(run)));
  }
  save();
  process.stdout.write('\n');
} else {
  save();
  process.stderr.write(`gh stub: unexpected command ${argv.join(' ')}\n`);
  process.exit(64);
}
