import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { createGenerationBoundLocalLiquidHostMount } from '../local-liquid-host-lifecycle.mjs';

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
