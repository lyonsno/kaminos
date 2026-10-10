// SuperMat performance suite, meant to run as one serialized GPU job (e.g. a
// GPU Greenroom structured command) so its timings are not contended by other
// batch GPU work. Runs each child witness in sequence and writes summary.json
// on every path, naming the step that failed.
import fs from 'node:fs/promises';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { assertSource } from './source-identity.mjs';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: Object.fromEntries(
  ['repo-root', 'expected-commit', 'state-root', 'chrome', 'server-port', 'out', 'plan'].map(name => [name, { type: 'string' }])) });
const out = path.resolve(values.out ?? 'supermat-perf-suite');
const summary = { schema: 'supermat.perf-suite.v0', status: 'failed', phase: 'arguments', steps: [], startedAt: new Date().toISOString() };
const persist = async () => {
  await fs.mkdir(out, { recursive: true });
  await fs.writeFile(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
};

// Whole-GPU utilization sampled before each step: Greenroom serializes queued
// jobs only, so outside work (leases, interactive pages) must stay visible.
function gpuUtilization() {
  try {
    const text = execFileSync('/usr/sbin/ioreg', ['-r', '-d', '1', '-c', 'IOAccelerator'], { encoding: 'utf8' });
    const value = name => Number(text.match(new RegExp(`"${name}"=(\\d+)`))?.[1] ?? NaN);
    return { device: value('Device Utilization %'), renderer: value('Renderer Utilization %'), at: new Date().toISOString() };
  } catch (error) { return { error: String(error) }; }
}

function run(id, script, args) {
  const report = path.join(out, id, 'report.json');
  const gpuBefore = gpuUtilization();
  const started = Date.now();
  const child = spawnSync(process.execPath, [script, ...args, '--report', report], { cwd: values['repo-root'], encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024 });
  const step = { id, exitCode: child.status, wallMs: Date.now() - started, report, gpuBefore, stdoutTail: child.stdout?.slice(-400),
    stderrTail: child.stderr?.slice(-2000), signal: child.signal };
  try { step.result = JSON.parse(readFileSync(report, 'utf8')); } catch (error) { step.reportError = String(error); }
  summary.steps.push(step);
  assertSource(values['repo-root'], summary.commit, `after step ${id}`);
  return step;
}

// The suite serves the pinned checkout itself so page steps measure the same
// source as the witness steps, never whatever a shared dev server has loaded.
async function startServer(root, state, port) {
  const link = path.join(root, 'scratch', 'supermat-weights');
  await fs.rm(link, { force: true });
  await fs.symlink(path.join(state, 'weights'), link);
  const child = spawn('python3', ['serve.py', String(port)], { cwd: root, stdio: 'ignore',
    env: { ...process.env, KAMINOS_ASSETS_DIR: path.join(state, 'assets') } });
  const url = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`server exited with ${child.exitCode}`);
    try { if ((await fetch(`${url}/models/supermat/supermat-demo.html`)).ok) return { child, url }; } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  child.kill();
  throw new Error(`server on ${port} did not answer`);
}
let server;

try {
  await persist();
  for (const name of ['repo-root', 'expected-commit', 'state-root', 'chrome', 'server-port']) {
    if (!values[name]) throw new Error(`--${name} is required`);
  }
  const root = values['repo-root'], state = values['state-root'];
  summary.phase = 'source-identity';
  summary.commit = assertSource(root, values['expected-commit'], 'at start').commit;
  summary.phase = 'server';
  server = await startServer(root, state, Number(values['server-port']));
  summary.server = { url: server.url, root, pid: server.child.pid };
  const witness = 'models/supermat/run-witness.mjs', demo = 'models/supermat/demo-witness.mjs';
  const common = ['--repo-root', root, '--expected-commit', summary.commit, '--chrome', values.chrome, '--receiver', 'paint-stripper'];
  const image = ['--image', `${state}/assets/images/inbox/ring.webp`, '--decoded-reference', `${state}/preprocess/ring-0000-decoded-rgba.u8`];

  summary.phase = 'kernel-bench';
  run('bench', witness, [...common, '--stage', 'bench', '--fixture', `${state}/reference/ring-0000-512`, '--weights', `${state}/weights/f16`]);

  const plan = values.plan ?? 'profiles';
  summary.plan = plan;
  if (!['profiles', 'coop-sweep', 'coop-alternate'].includes(plan)) throw new Error(`unknown plan ${plan}`);
  const page = (id, query) => run(id, demo, ['--url',
    `${server.url}/models/supermat/supermat-demo.html?image_root=image-inbox&image_path=evil-orb.png&autorun=1&repeat=3&${query}`,
    '--chrome', values.chrome, '--screenshot', path.join(out, id, 'screen.png')]);
  if (plan === 'profiles') {
    summary.phase = 'route-timing';
    // Reference-faithful profile (F32 activations, unfused) vs the demo's product
    // profile (F16 activations, fused GroupNorm+SiLU), both on F16 weights.
    const routes = [
      ['route-512-faithful', 'ring-0000-512', 'f16', { activations: 'f32', fuseNorm: false }],
      ['route-512-f16act', 'ring-0000-512', 'f16', { activations: 'f16', fuseNorm: false }],
      ['route-512-product', 'ring-0000-512', 'f16', { activations: 'f16', fuseNorm: true }],
      ['route-1024-faithful', 'ring-0000-1024', 'f16', { activations: 'f32', fuseNorm: false }],
      ['route-1024-product', 'ring-0000-1024', 'f16', { activations: 'f16', fuseNorm: true }],
    ];
    for (const [id, fixture, weights, options] of routes) {
      run(id, witness, [...common, '--stage', 'route', '--fixture', `${state}/reference/${fixture}`, '--weights', `${state}/weights/${weights}`,
        ...image, '--options', JSON.stringify(options)]);
    }

    summary.phase = 'cooperative-run-frames';
    const coop = [['coop-faithful', 'weights=/scratch/supermat-weights/f16/&activations=f32&fuseNorm=0'],
      ['coop-product', 'weights=/scratch/supermat-weights/f16/']];
    for (const [id, query] of coop) {
      run(id, demo, ['--url', `${server.url}/models/supermat/supermat-demo.html?image_root=image-inbox&image_path=evil-orb.png&autorun=1&repeat=3&${query}`,
        '--chrome', values.chrome, '--screenshot', path.join(out, id, 'screen.png')]);
    }
  } else if (plan === 'coop-alternate') {
    // Paired blocking/cooperative alternation inside one page session (17 runs:
    // a cold blocking run, then 8 cooperative/blocking pairs) per profile.
    summary.phase = 'cooperative-alternate';
    for (const [name, query] of [['product-12ms', 'dutyMs=12'], ['product-16ms', 'dutyMs=16'], ['product-20ms', 'dutyMs=20'],
      ['product-12ms-repeat', 'dutyMs=12']]) {
      run(`alternate-${name}`, demo, ['--url',
        `${server.url}/models/supermat/supermat-demo.html?image_root=image-inbox&image_path=evil-orb.png&autorun=1&repeat=17&alternate=1&${query}`,
        '--chrome', values.chrome, '--screenshot', path.join(out, `alternate-${name}`, 'screen.png')]);
    }
  } else {
    // Cooperative 512 throughput vs scene smoothness: duty target sweep for
    // both profiles, with a blocking baseline per profile.
    summary.phase = 'cooperative-sweep';
    const profiles = [['faithful', 'activations=f32&fuseNorm=0'], ['product', '']];
    // Profiles alternate within each setting so machine-load drift does not favor one.
    for (const [name, query] of profiles) page(`blocking-${name}`, `cooperative=0&${query}`);
    for (const dutyMs of [12, 20, 30]) {
      for (const [name, query] of profiles) page(`coop-${name}-${dutyMs}ms`, `dutyMs=${dutyMs}&${query}`);
    }
  }

  summary.phase = 'control-bench';
  run('bench-end', witness, [...common, '--stage', 'bench', '--fixture', `${state}/reference/ring-0000-512`, '--weights', `${state}/weights/f16`]);

  summary.phase = 'complete';
  // A step passes only if it exited cleanly and its report was read back.
  summary.status = summary.steps.every(step => step.exitCode === 0 && step.result && !step.reportError) ? 'passed' : 'completed-with-failures';
} catch (error) {
  summary.error = `${error?.name ?? 'Error'}: ${error?.message ?? String(error)}`;
  process.exitCode = 1;
} finally {
  server?.child.kill();
  summary.finishedAt = new Date().toISOString();
  await persist();
  console.log(JSON.stringify({ status: summary.status, phase: summary.phase, error: summary.error ?? null, out }));
}
