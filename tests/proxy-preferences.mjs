// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {PREFERENCES_SCHEMA, checkedPreferences, PROXY_SIMULATION_CHOICES} from '../user-preferences.mjs';
import {createFireProxySync} from '../fire-proxy-sync.mjs';
import {createProxySnapshotRegistry} from '../proxy-snapshot.mjs';
import {createFireSplatLayer} from '../proxy-fire-splats.mjs';

test('proxy preferences say how each fluid simulates while its proxy stands in', () => {
 assert.deepEqual(PROXY_SIMULATION_CHOICES.map(([value]) => value), [1, 2, 4, 8, 0]);
 const saved = checkedPreferences({schema: PREFERENCES_SCHEMA, proxy: {fire: {simEvery: 4}, water: {simEvery: 0}}});
 assert.deepEqual(saved.proxy, {fire: {simEvery: 4}, water: {simEvery: 0}});
 assert.equal(checkedPreferences({schema: PREFERENCES_SCHEMA}).proxy, undefined, 'documents without proxy settings stay as they are');
 for (const bad of [3, -1, 'run', 1.5]) assert.throws(() => checkedPreferences({schema: PREFERENCES_SCHEMA, proxy: {fire: {simEvery: bad}}}), /proxy/i);
});

test('a fire proxy set to pause holds the simulation while it stands in, and the full fire runs again', () => {
 const registry = createProxySnapshotRegistry();
 const sync = createFireProxySync({registry, readDomain: () => ({translation: [0, 0, 0], scale: 1}), now: () => 0, createLayer: () => createFireSplatLayer()});
 let consumer = null;
 const prototype = {pacing: null, setResidualPartialsConsumer(fn) { consumer = fn; return !!fn; }, getResidualFieldGeneration: () => 1, isActive: () => true,
  setCanvasPresentationSuppressed: value => value === true, setProxyPacing(value) { this.pacing = value ?? null; return this.pacing; }};
 const camera = {layers: {enable() {}, disable() {}}}, frame = (display, stepEvery) => sync.sync({prototype, display, required: false, camera, layerId: 4, canvas: {style: {}}, bridge: null, stepEvery});
 frame(true, 0);
 const data = new Float32Array(20); data.set([0, 64 * 0.8, 0, 0, 64 * 1.2, 64 * 1.2, 0, 0], 12);
 consumer({partials: data, grid: 4, gridY: 4, workgroupsX: 1, workgroupsY: 1, workgroupsZ: 1, floatsPerWorkgroup: 20, step: 16, fieldGeneration: 1});
 frame(true, 0);
 assert.deepEqual(prototype.pacing, {lightFieldWithSnapshots: true, simStepEvery: 1, simPaused: true});
 frame(false, 0);
 assert.equal(prototype.pacing, null, 'Full runs the simulation every frame');
});
