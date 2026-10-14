// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('async function ensureSamImageTools()');
const end = html.indexOf('async function samHostDeviceRequirements(', start);
assert.ok(start >= 0 && end > start, 'actual SAM bootstrap must be present');
const source = html.slice(start, end).replace("await import('./sam-image-tools.js')", 'samModule');
function fixture(acquireHost) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {});
    return elements.get(id);
  };
  const handoffs = [], tools = { setActive() {} }, legacy = {}, device = {};
  let options, creations = 0, mode = 'workbench';
  const context = {
    sceneInitialization: Promise.resolve(), samImageToolsPromise: null, samImageTools: null,
    samHostContext: { inferenceSession: legacy }, samHostConfig: { mounted: true },
    renderer: { backend: { device } }, selectedSceneObjectEntry: () => null,
    document: { getElementById: element, querySelector: () => ({ dataset: { tab: 'masks' } }) },
    window: { kaminosAppGpu: acquireHost,
      kaminosWorkspace: { state: () => ({ mode }), setMode(value) { mode = value; handoffs.push(['mode', value]); } },
      kaminosAssets: { open(value) { handoffs.push(['open', value]); }, select(value) { handoffs.push(['select', value]); } } },
    samModule: { createSamImageTools(value) { options = value; creations++; return tools; } },
  };
  const bootstrap = vm.runInNewContext(`${source}\nensureSamImageTools;`, context);
  return { bootstrap, context, tools, element, legacy, handoffs,
    options: () => options, creations: () => creations };
}
const session = {}, app = { session: () => session };
const connected = fixture(async () => app);
assert.equal(await connected.bootstrap(), connected.tools);
assert.equal(connected.options().inferenceSession, session);
assert.equal(connected.options().foregroundService, app, 'use the facade, not its raw service');
await connected.bootstrap();
assert.equal(connected.creations(), 1);
const cutout = { name: 'selected-cutout.png', source: '/api/read?root=image-inbox&path=selected-cutout.png', maskProvenance: { invocationId: 'fixture' } };
connected.options().onAsset(cutout);
assert.deepEqual(connected.handoffs.map(row => row[0]), ['mode', 'open', 'select']);
assert.equal(connected.handoffs[1][1], 'generate');
assert.equal(connected.handoffs[2][1].source, cutout.source);
assert.equal(connected.handoffs[2][1].maskProvenance, cutout.maskProvenance);

const upload = fixture(async () => app);
await upload.bootstrap();
upload.options().onAsset({ name: 'source.jpg', source: '/api/read?root=image-inbox&path=source.jpg' });
assert.equal(upload.context.window.kaminosWorkspace.state().mode, 'workbench',
  'source ingestion must leave Masks open for the prompt, not take the export handoff');
assert.equal(upload.handoffs.some(row => row[0] === 'open'), false,
  'a newly uploaded source is not a saved mask or cutout');

const failed = fixture(async () => { throw new Error('application GPU host failed'); });
await assert.rejects(failed.bootstrap(), /application GPU host failed/,
  'a failed app host must not silently substitute the legacy SAM session');
assert.equal(failed.creations(), 0);
assert.equal(failed.element('sam-image-status').textContent, 'application GPU host failed');

const legacy = fixture(undefined);
await legacy.bootstrap();
assert.equal(legacy.options().inferenceSession, legacy.legacy, 'an absent app accessor retains explicit legacy compatibility');
assert.equal(legacy.options().foregroundService, undefined);
console.log('SAM actual host bootstrap and saved-export handoff contracts passed (controlled host/DOM dependencies)');
