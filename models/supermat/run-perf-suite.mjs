// SuperMat performance suite, meant to run as one serialized GPU job (e.g. a
// GPU Greenroom structured command) so its timings are not contended by other
// batch GPU work. Runs each child witness in sequence and writes summary.json
// on every path, naming the step that failed.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: Object.fromEntries(
  ['repo-root', 'expected-commit', 'state-root', 'chrome', 'server-url', 'out'].map(name => [name, { type: 'string' }])) });
const out = path.resolve(values.out ?? 'supermat-perf-suite');
const summary = { schema: 'supermat.perf-suite.v0', status: 'failed', phase: 'arguments', steps: [], startedAt: new Date().toISOString() };
const persist = async () => {
  await fs.mkdir(out, { recursive: true });
  await fs.writeFile(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
};

function run(id, script, args) {
  const report = path.join(out, id, 'report.json');
  const started = Date.now();
  const child = spawnSync(process.execPath, [script, ...args, '--report', report], { cwd: values['repo-root'], encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024 });
  const step = { id, exitCode: child.status, wallMs: Date.now() - started, report, stdoutTail: child.stdout?.slice(-400) };
  try { step.result = JSON.parse(execFileSync('cat', [report], { encoding: 'utf8' })); } catch (error) { step.reportError = String(error); }
  summary.steps.push(step);
  return step;
}

try {
  await persist();
  for (const name of ['repo-root', 'expected-commit', 'state-root', 'chrome', 'server-url']) {
    if (!values[name]) throw new Error(`--${name} is required`);
  }
  const root = values['repo-root'], state = values['state-root'];
  summary.commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  summary.dirty = execFileSync('git', ['status', '--porcelain', '--', 'models/supermat', 'webgpu-inference-kit/src'], { cwd: root, encoding: 'utf8' });
  if (summary.commit !== values['expected-commit'] || summary.dirty) throw new Error('suite must run from the exact clean requested commit');
  const witness = 'models/supermat/run-witness.mjs', demo = 'models/supermat/demo-witness.mjs';
  const common = ['--repo-root', root, '--expected-commit', summary.commit, '--chrome', values.chrome, '--receiver', 'paint-stripper'];
  const image = ['--image', `${state}/assets/images/inbox/ring.webp`, '--decoded-reference', `${state}/preprocess/ring-0000-decoded-rgba.u8`];

  summary.phase = 'kernel-bench';
  run('bench', witness, [...common, '--stage', 'bench', '--fixture', `${state}/reference/ring-0000-512`, '--weights', `${state}/weights/f16`]);

  summary.phase = 'route-timing';
  const routes = [
    ['route-512-f16w-f32act', 'ring-0000-512', 'f16', {}],
    ['route-512-f16w-f16act', 'ring-0000-512', 'f16', { activations: 'f16' }],
    ['route-512-f16w-f16act-f16partial', 'ring-0000-512', 'f16', { activations: 'f16', gemmPrecision: 'f16-partial' }],
    ['route-1024-f16w-f32act', 'ring-0000-1024', 'f16', {}],
    ['route-1024-f16w-f16act', 'ring-0000-1024', 'f16', { activations: 'f16' }],
    ['route-1024-f16w-f16act-f16partial', 'ring-0000-1024', 'f16', { activations: 'f16', gemmPrecision: 'f16-partial' }],
  ];
  for (const [id, fixture, weights, options] of routes) {
    run(id, witness, [...common, '--stage', 'route', '--fixture', `${state}/reference/${fixture}`, '--weights', `${state}/weights/${weights}`,
      ...image, '--options', JSON.stringify(options)]);
  }

  summary.phase = 'weight-load-frames';
  const loads = [['chunks16', 'f16'], ['chunks4', 'f16-c4'], ['chunks16', 'f16'], ['chunks4', 'f16-c4']];
  for (const [index, [label, weights]] of loads.entries()) {
    const id = `load-${label}-${index}`;
    run(id, demo, ['--url', `${values['server-url']}/models/supermat/supermat-demo.html?weights=/scratch/supermat-weights/${weights}/`,
      '--chrome', values.chrome, '--screenshot', path.join(out, id, 'screen.png'), '--until', 'ready']);
  }

  summary.phase = 'cooperative-run-frames';
  const coop = [['coop-f32w', 'weights=/scratch/supermat-weights/f32/'], ['coop-f16w', 'weights=/scratch/supermat-weights/f16/'],
    ['coop-f16w-f16act', 'weights=/scratch/supermat-weights/f16/&activations=f16']];
  for (const [id, query] of coop) {
    run(id, demo, ['--url', `${values['server-url']}/models/supermat/supermat-demo.html?image_root=image-inbox&image_path=evil-orb.png&autorun=1&repeat=3&${query}`,
      '--chrome', values.chrome, '--screenshot', path.join(out, id, 'screen.png')]);
  }

  summary.phase = 'complete';
  summary.status = summary.steps.every(step => step.exitCode === 0) ? 'passed' : 'completed-with-failures';
} catch (error) {
  summary.error = `${error?.name ?? 'Error'}: ${error?.message ?? String(error)}`;
  process.exitCode = 1;
} finally {
  summary.finishedAt = new Date().toISOString();
  await persist();
  console.log(JSON.stringify({ status: summary.status, phase: summary.phase, error: summary.error ?? null, out }));
}
