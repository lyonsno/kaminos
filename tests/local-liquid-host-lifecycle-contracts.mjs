import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { createGenerationBoundLocalLiquidHostMount } from '../local-liquid-host-lifecycle.mjs';
import { createSceneLoadRequests } from '../scene-load-generation.mjs';

const root = new URL('..', import.meta.url).pathname;
const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');
const hostSource = readFileSync(join(root, 'local-liquid-host.mjs'), 'utf8');

test('local-liquid mount is generation-scoped so a stale async create cannot own a later scene', () => {
  assert.ok(/createGenerationBoundLocalLiquidHostMount/.test(indexHtml), 'scene host mounting must use a generation-bound lifecycle controller');
  const staleCheck = hostSource.indexOf('if (!isCurrent())');
  const supportAttach = hostSource.indexOf('scene.add(group)');
  assert.ok(staleCheck >= 0 && supportAttach > staleCheck, 'a stale solver result must be retired before its support geometry attaches to the shared scene');
});

test('a clear/load generation retires delayed old creation without blocking or replacing the new scene host', async () => {
  let generation = 1;
  let host = null;
  const pending = new Map();
  const failures = [];
  const manager = createGenerationBoundLocalLiquidHostMount({
    getGeneration: () => generation,
    getHost: () => host,
    setHost: value => { host = value; },
    createHost: ({setup, isCurrent}) => new Promise((resolve, reject) => {
      pending.set(generation, {setup, isCurrent, resolve, reject});
    }),
    onFailure: error => failures.push(error.message),
  });
  const oldMount = manager.mount({setup:{scene:'old'}, emitterIds:['old-emitter']});
  await Promise.resolve();
  assert.equal(manager.isLoading(), true);

  generation++;
  const nextMount = manager.mount({setup:{scene:'new'}, emitterIds:['new-emitter']});
  await Promise.resolve();
  assert.equal(manager.isLoading(), true, 'new scene gets an independent in-flight mount while the old one is pending');
  assert.deepEqual(pending.get(1).setup, {scene:'old'});
  assert.deepEqual(pending.get(2).setup, {scene:'new'});

  const staleHost = {setup:'old', disposed:false, dispose(){this.disposed=true;}};
  pending.get(1).resolve(staleHost);
  assert.equal(await oldMount, false, 'stale create result is not mounted');
  assert.equal(staleHost.disposed, true, 'stale host resources are disposed');
  assert.equal(host, null);
  assert.equal(pending.get(1).isCurrent(), false);

  const newHost = {setup:'new', disposed:false, dispose(){this.disposed=true;}};
  pending.get(2).resolve(newHost);
  assert.equal(await nextMount, true);
  assert.equal(host, newHost, 'loaded scene owns its matching host');
  assert.equal(manager.isLoading(), false);
  assert.deepEqual(failures, [], 'stale completion does not publish a failure into the current scene');
});

test('successful async mount reconciles emitter records edited while creation was pending', async () => {
  let generation = 4;
  let host = null;
  let latestEmitters = [{id:'A'}];
  let resolveCreate;
  const manager = createGenerationBoundLocalLiquidHostMount({
    getGeneration: () => generation,
    getHost: () => host,
    setHost: value => { host = value; },
    createHost: ({emitters}) => new Promise(resolve => {
      resolveCreate = () => resolve({emitters:emitters.map(row=>row.id), setEmitters(rows){this.emitters=rows.map(row=>row.id);}, dispose(){}});
    }),
    onMounted: mountedHost => mountedHost.setEmitters(latestEmitters),
  });
  const mounting = manager.mount({setup:{scene:'same'},emitters:[{id:'A'}]});
  await Promise.resolve();
  latestEmitters = [{id:'A'},{id:'B'}];
  resolveCreate();
  assert.equal(await mounting, true);
  assert.deepEqual(host.emitters, ['A','B'], 'mounted solver consumes the latest same-scene emitter membership');
});

test('scene-load continuations recheck ownership before publishing loaded identity', () => {
  const loadFileStart = indexHtml.indexOf('async function loadSceneFile(');
  const claimFile = indexHtml.indexOf('claimLoadedSceneFile(file);', loadFileStart);
  const loadSlice = indexHtml.slice(loadFileStart, claimFile);
  assert.match(loadSlice, /sceneLoadRequests\.begin\(\)/, 'each scene load must own a supersedable load request');
  assert.match(loadSlice, /sceneLoadRequests\.isCurrent\(loadRequestId\)/, 'async load continuations must test current request ownership');
  assert.match(loadSlice, /sceneLoadRequests\.awaitStage\(loadRequestId, loadSceneObjects\(/, 'the production scene loader must bind its async host/load stage to request ownership');
  assert.match(indexHtml.slice(claimFile - 400, claimFile + 100), /sceneLoadRequests\.isCurrent\(loadRequestId\)/,
    'stale load cannot publish file identity after host admission');
});

test('overlapping scene-load stages cannot publish an older file after the newer host resolves', async () => {
  const requests = createSceneLoadRequests();
  let currentFile = null;
  let releaseOld;
  const oldRequest = requests.begin();
  const oldLoad = (async () => {
    const stage = await requests.awaitStage(oldRequest, new Promise(resolve => { releaseOld = resolve; }));
    if (!stage.current) return false;
    currentFile = stage.value;
    return true;
  })();
  const newRequest = requests.begin();
  const newStage = await requests.awaitStage(newRequest, Promise.resolve('new.kaminos.json'));
  assert.equal(newStage.current, true);
  currentFile = newStage.value;
  releaseOld('old.kaminos.json');
  assert.equal(await oldLoad, false);
  assert.equal(currentFile, 'new.kaminos.json');
});
