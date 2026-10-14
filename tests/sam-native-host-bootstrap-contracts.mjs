// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createAuthoringAssets } from '../authoring-assets.mjs';

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
await connected.options().onAsset(cutout);
assert.deepEqual(connected.handoffs.map(row => row[0]), ['mode', 'open', 'select']);
assert.equal(connected.handoffs[1][1], 'generate');
assert.equal(connected.handoffs[2][1].source, cutout.source);
assert.equal(connected.handoffs[2][1].maskProvenance, cutout.maskProvenance);

const upload = fixture(async () => app);
await upload.bootstrap();
await upload.options().onAsset({ name: 'source.jpg', source: '/api/read?root=image-inbox&path=source.jpg' });
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

const drawerSource = fs.readFileSync(new URL('../authoring-assets.mjs', import.meta.url), 'utf8');
const openStart = drawerSource.indexOf("open(next='browse'){");
const openEnd = drawerSource.indexOf(',state:', openStart);
assert.ok(openStart >= 0 && openEnd > openStart, 'actual asset drawer open method must exist');
const actionSource = drawerSource.split('\n').find(line => line.trimStart().startsWith('const action=fn=>'));
assert.ok(actionSource, 'actual drawer action helper must exist');
let releaseRoots, startedRoots;
const rootsEntered = new Promise(resolve => { startedRoots = resolve; });
const rootsPending = new Promise(resolve => { releaseRoots = resolve; });
const controller = createAuthoringAssets({ request: async address => {
  if (address === '/api/roots') { startedRoots(); return rootsPending; }
  return { schema: 'kaminos.authoring-assets.v1', collection: 'image-inbox', entries: [], warnings: [] };
} });
const drawer = vm.runInNewContext(`${actionSource}\n({${drawerSource.slice(openStart, openEnd)}})`, {
  panel: { hidden: true }, document: { body: { classList: { add() {} } } },
  setMode() {}, byId: () => ({}), controller,
});
const asynchronous = fixture(async () => app);
asynchronous.context.window.kaminosAssets = { ...controller, open: mode => drawer.open(mode) };
await asynchronous.bootstrap();
let completedHandoff = false;
const pendingHandoff = Promise.resolve(asynchronous.options().onAsset(cutout))
  .then(() => { completedHandoff = true; });
await rootsEntered;
await new Promise(resolve => setImmediate(resolve));
assert.equal(completedHandoff, false, 'saved PNG handoff must await the actual drawer refresh');
releaseRoots({ 'image-inbox': { exists: true } });
await pendingHandoff;
assert.equal(controller.read().selected.source, cutout.source,
  'selection must be applied after refresh clears the previous asset');
assert.deepEqual(controller.read().selected.maskProvenance, cutout.maskProvenance);
console.log('SAM saved export composes actual drawer refresh and persistent selection');
