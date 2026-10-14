// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import definition from '../experiments/material-study.experiment.mjs';
import {openExperiment} from '../workbench-experiments.mjs';
import {createWorkbenchSceneHost} from '../workbench-scene-host.mjs';

function fixture() {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const borrowed = new THREE.Group(); scene.add(borrowed);
  const rows = new Map(), events = [];
  const controls = {target: new THREE.Vector3(), update() {}};
  const shared = createWorkbenchSceneHost({scene, camera, controls,
    loadAsset() {throw Error('No external asset needed');},
    registerObject(root, metadata) {const row = {id: root.uuid, root, ...metadata}; rows.set(root, row); return row;},
    findObject: root => rows.get(root),
    removeObject({root}) {scene.remove(root); rows.delete(root);},
    redraw() {}, onFrame() {throw Error('A material comparison needs no private playback');},
  });
  return {scene, borrowed, rows, events, host: {scene: {open: async () => shared.open()}}};
}

test('example mounts in supplied scene and records effective material edits', async () => {
  const f = fixture();
  const instance = await openExperiment(definition, {host: f.host, inputs: {roughness: 0.6}, record: row => f.events.push(row)});
  assert.equal(f.rows.size, 1);
  const [{root, id}] = f.rows.values();
  assert.equal(root.parent, f.scene);
  assert.equal(root.children.length, 2);
  assert.equal(root.children[0].material.roughness, 0.15);
  assert.equal(root.children[1].material.roughness, 0.6);
  const changed = await instance.invoke('setRoughness', 0.85);
  assert.equal(changed.roughness, 0.85);
  assert.equal(root.children[1].material.roughness, 0.85);
  assert.equal(f.events.at(-1).target, id);
  assert.equal(f.events.at(-1).effective.roughness, 0.85);
  await assert.rejects(instance.invoke('setRoughness', NaN), /roughness/);
  await assert.rejects(instance.invoke('setRoughness', 2), /roughness/);
  assert.equal((await instance.read()).roughness, 0.85);
  await instance.dispose();
  assert.deepEqual(f.scene.children, [f.borrowed]);
});

test('invalid setup fails before allocating scene resources', async () => {
  const f = fixture();
  await assert.rejects(openExperiment(definition, {host: f.host, inputs: {roughness: -0.1}}), /roughness/);
  assert.equal(f.rows.size, 0);
});
