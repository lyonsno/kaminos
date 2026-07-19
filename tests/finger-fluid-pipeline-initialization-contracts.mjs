import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const source = readFileSync(join(root, 'finger-fluid-webgpu-core.js'), 'utf8');

assert.match(
  source,
  /export async function createNamedResourcesConcurrently/,
  'the fluid initializer exposes one concurrency boundary for independent GPU resources',
);

const { createNamedResourcesConcurrently } = await import('../finger-fluid-webgpu-core.js');

const starts = [];
const releases = new Map();
const pending = createNamedResourcesConcurrently(
  {
    clear: 'clear_grid',
    predict: 'predict_positions',
    render: 'render_surface',
  },
  resource => new Promise(resolve => {
    starts.push(resource);
    releases.set(resource, resolve);
  }),
);

await Promise.resolve();
assert.deepEqual(
  starts,
  ['clear_grid', 'predict_positions', 'render_surface'],
  'all independent compilations start before any one compilation resolves',
);

releases.get('render_surface')('render-pipeline');
releases.get('clear_grid')('clear-pipeline');
releases.get('predict_positions')('predict-pipeline');

assert.deepEqual(
  await pending,
  {
    clear: 'clear-pipeline',
    predict: 'predict-pipeline',
    render: 'render-pipeline',
  },
  'parallel completion preserves stable named resource identity',
);

assert.doesNotMatch(
  source,
  /clear:\s*await pipelineFor|projection:\s*await energyPipelineFor/,
  'compute and energy pipeline startup cannot regress to serial awaits',
);
assert.doesNotMatch(
  source,
  /renderPipeline\s*=\s*await device\.createRenderPipelineAsync/,
  'render pipeline startup cannot regress to serial awaits',
);
assert.match(
  source,
  /KAMINOS_FINGER_FLUID_RUNTIME_PROFILES[\s\S]*live_play[\s\S]*compileInterfaceCarriers:\s*false[\s\S]*compileLiquidFireContacts:\s*false[\s\S]*compileEnergyDiagnostics:\s*false/,
  'live play declares which full-bench diagnostics and composition carriers it intentionally omits',
);
assert.match(
  readFileSync(join(root, 'hand-state-runtime.mjs'), 'utf8'),
  /runtimeProfile:\s*['"]live_play['"]/,
  'the live hand route explicitly requests the bounded continuous-play profile',
);
assert.match(
  source,
  /initialization:\s*\{[\s\S]*totalMs:[\s\S]*stages:/,
  'effective solver truth retains per-stage initialization timing instead of only requested profile identity',
);

console.log('finger-fluid pipeline initialization contracts passed');
