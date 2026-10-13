import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as THREE from '../lib/three.core.js';

const module = await import('../owner-scene-session.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
assert.equal(typeof module.createOwnerSceneSession, 'function',
  'shared experiments need a scoped scene session over the existing host');

function fixture(overrides = {}) {
  const scene = new THREE.Scene(), frames = new Set(), removed = [];
  let counter = 0, view = {position: [1, 2, 3], target: [0, 0, 0]}, draws = 0;
  const receipt = (root, owned = true) => ({id: `object-${++counter}`, root,
    clips: [], source: '/retained/body.glb', owned});
  const hooks = {
    loadAsset: async () => {const root = new THREE.Group(); scene.add(root); return receipt(root);},
    attach: async (root, {owned}) => {if (owned) scene.add(root); return receipt(root, owned);},
    remove: async handle => {removed.push(handle.id); scene.remove(handle.root);},
    readView: () => view,
    setView: next => {view = next; return view;},
    redraw: () => ++draws,
    onFrame: fn => {frames.add(fn); return () => frames.delete(fn);},
    ...overrides,
  };
  return {scene, frames, removed, receipt, hooks, session: module.createOwnerSceneSession(hooks),
    draws: () => draws};
}

test('actual Three root and clips retain identity; only owned registrations are removed', async () => {
  const f = fixture(), borrowed = new THREE.Group(); f.scene.add(borrowed);
  const handle = await f.session.loadAsset({source: 'body'});
  assert.equal(handle.root.parent, f.scene);
  await f.session.attach(borrowed, {owned: false});
  const disposal = f.session.dispose(); assert.equal(f.session.dispose(), disposal);
  await disposal;
  assert.deepEqual(f.removed, [handle.id]); assert.equal(borrowed.parent, f.scene);
  assert.equal(handle.root.parent, null);
  assert.throws(() => f.session.readView(), /disposed/);
  await assert.rejects(f.session.loadAsset({}), /disposed/);
});

test('late asset is removed and never adopted after session disposal', async () => {
  let finish, context;
  const f = fixture({loadAsset: (_input, ctx) => {context = ctx; return new Promise(r => {finish = r;});}});
  const load = f.session.loadAsset({source: 'slow'});
  const rejected = assert.rejects(load, /disposed/);
  await Promise.resolve();
  const close = f.session.dispose();
  assert.equal(context.signal.aborted, true); assert.equal(context.isCurrent(), false);
  const root = new THREE.Group(); f.scene.add(root); const handle = f.receipt(root);
  finish(handle); await rejected; await close;
  assert.equal(root.parent, null); assert.deepEqual(f.removed, [handle.id]);
});

test('late borrowed attachment survives close', async () => {
  let finish;
  const f = fixture({attach: () => new Promise(r => {finish = r;})});
  const root = new THREE.Group(); f.scene.add(root);
  const pending = f.session.attach(root, {owned: false});
  const rejected = assert.rejects(pending, /disposed/); await Promise.resolve();
  const close = f.session.dispose(); finish(f.receipt(root, false));
  await rejected; await close;
  assert.equal(root.parent, f.scene); assert.deepEqual(f.removed, []);
});

test('host frame callbacks drive real animation; cancellation guards stale callbacks', async () => {
  const f = fixture(), {root} = await f.session.loadAsset({});
  const mixer = new THREE.AnimationMixer(root);
  const clip = new THREE.AnimationClip('retained', 1,
    [new THREE.VectorKeyframeTrack('.position', [0, 1], [0, 0, 0, 0, 0, 2])]);
  mixer.clipAction(clip).play();
  const stop = f.session.onFrame(({deltaSeconds}) => {mixer.update(deltaSeconds); f.session.redraw();});
  const callback = [...f.frames][0]; callback({deltaSeconds: .25});
  assert.equal(root.position.z, .5); assert.equal(f.draws(), 1);
  stop(); stop(); callback({deltaSeconds: .25});
  assert.equal(root.position.z, .5); assert.equal(f.frames.size, 0);
  f.session.onFrame(() => {throw Error('stale callback ran');});
  const stale = [...f.frames][0]; await f.session.dispose(); stale({deltaSeconds: 1});
  assert.equal(f.frames.size, 0);
});

test('camera values are detached data while host validates/restores the actual view', async () => {
  const f = fixture(); const view = f.session.readView(); view.position[0] = 999;
  assert.equal(f.session.readView().position[0], 1);
  const next = {position: [5, 6, 7], target: [2, 3, 4]};
  const applied = f.session.setView(next); next.position[0] = 99; applied.position[0] = 77;
  assert.equal(f.session.readView().position[0], 5); await f.session.dispose();
});

test('cleanup attempts all owned registrations and reports failure', async () => {
  const removed = [];
  const f = fixture({remove: async h => {removed.push(h.id); if (removed.length === 1) throw Error('remove failed');}});
  await f.session.loadAsset({}); await f.session.loadAsset({});
  await assert.rejects(f.session.dispose(), /cleanup failed/);
  assert.equal(removed.length, 2);
});

test('late cleanup failure reaches close as well as its pending operation', async () => {
  let finish;
  const f = fixture({loadAsset: () => new Promise(r => {finish = r;}), remove: () => {throw Error('late remove failed');}});
  const load = f.session.loadAsset({}); const rejected = assert.rejects(load, /late remove failed/);
  await Promise.resolve(); const close = f.session.dispose();
  finish(f.receipt(new THREE.Group()));
  await rejected; await assert.rejects(close, /cleanup failed/);
});

test('failed host load remains a failed load without invented scene cleanup', async () => {
  const f = fixture({loadAsset: () => {throw Error('unreadable asset');}});
  await assert.rejects(f.session.loadAsset({}), /unreadable asset/);
  await f.session.dispose(); assert.deepEqual(f.removed, []);
});

test('duplicate borrowed root cannot acquire ownership by a second attachment', async () => {
  const f = fixture(), root = new THREE.Group(); f.scene.add(root);
  await f.session.attach(root, {owned: false});
  await assert.rejects(f.session.attach(root, {owned: true}), /already/);
  await f.session.dispose(); assert.equal(root.parent, f.scene); assert.deepEqual(f.removed, []);
});

test('two in-flight attachments of one object invoke the host only once', async () => {
  const finishes = [];
  const f = fixture({attach: () => new Promise(r => {finishes.push(r);})});
  const root = new THREE.Group();
  const first = f.session.attach(root, {owned: false});
  const second = f.session.attach(root, {owned: true});
  const results = Promise.allSettled([first, second]);
  await Promise.resolve(); await Promise.resolve();
  const count = finishes.length;
  for (const finish of finishes) finish(f.receipt(root, false));
  const settled = await results; await f.session.dispose();
  assert.equal(count, 1, 'same root must be reserved before asynchronous host attachment');
  assert.equal(settled[1].status, 'rejected'); assert.match(settled[1].reason.message, /already/);
});
