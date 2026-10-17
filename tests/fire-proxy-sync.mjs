// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createFireProxySync} from '../fire-proxy-sync.mjs';
import {createProxySnapshotRegistry} from '../proxy-snapshot.mjs';
import {createFireSplatLayer} from '../proxy-fire-splats.mjs';

// One 4x4x4 block whose mean heat is `heat`, as the residual probe reads it back.
const partials = (heat, fieldGeneration) => {
 const data = new Float32Array(20); data.set([0, 64 * heat, 0, 0, 64 * heat * 1.5, 64 * heat * 1.5, 0, 0], 12);
 return {partials: data, grid: 4, gridY: 4, workgroupsX: 1, workgroupsY: 1, workgroupsZ: 1, floatsPerWorkgroup: 20, step: 16, fieldGeneration};
};
function fakePrototype() {
 let consumer = null, generation = 1, active = true, suppressed = false;
 return {
  setResidualPartialsConsumer(fn) { consumer = typeof fn === 'function' ? fn : null; return !!consumer; },
  getResidualFieldGeneration: () => generation,
  isActive: () => active,
  setCanvasPresentationSuppressed(value) { suppressed = value === true; return suppressed; },
  setProxyPacing(value) { this.pacing = value ?? null; return this.pacing; },
  pacing: null,
  readback(heat) { consumer?.(partials(heat, generation)); },
  setGeneration(value) { generation = value; },
  setActive(value) { active = value; },
  get suppressed() { return suppressed; },
 };
}
function harness() {
 const registry = createProxySnapshotRegistry(), layers = [], prototype = fakePrototype();
 const sync = createFireProxySync({registry, readDomain: () => ({translation: [0, 0, 0], scale: 1}), now: () => 0,
  createLayer: () => { const layer = createFireSplatLayer(); layers.push(layer); return layer; }});
 const enabled = new Set(), camera = {layers: {enable: layer => enabled.add(layer), disable: layer => enabled.delete(layer)}};
 const canvas = {style: {visibility: ''}}, bridge = {mesh: {visible: true}};
 const frame = (display, required = false, stepEvery = 1) => sync.sync({prototype, display, required, camera, layerId: 4, canvas, bridge, stepEvery});
 return {registry, layers, prototype, sync, enabled, canvas, bridge, frame};
}
const near = (a, b) => Math.abs(a - b) < 1e-6;

test('Full can retain picking snapshots without drawing a proxy or changing pacing',()=>{
 const h=harness();
 h.sync.sync({prototype:h.prototype,pickable:true,display:false,required:false,camera:h.camera,layerId:4,canvas:h.canvas,bridge:h.bridge});
 h.prototype.readback(.8);
 assert.equal(h.registry.latest('fire')?.count,1);
 assert.equal(h.layers.length,0);
 assert.equal(h.prototype.suppressed,false);
 assert.equal(h.prototype.pacing,null);
 assert.equal(h.canvas.style.visibility,'');
 const ray={origin:[0,0,5],direction:[0,0,-1]};
 assert.ok(h.sync.pick(ray,[0,0,5]));
 h.prototype.setGeneration(2);
 assert.equal(h.sync.pick(ray,[0,0,5]),null,'reset invalidates before the next frame');
 h.prototype.setActive(false);
 assert.equal(h.sync.pick(ray,[0,0,5]),null);
});

test('Proxy stands in once a snapshot of the current field exists, and Full brings the fire back', () => {
 const h = harness();
 h.frame(true);
 assert.equal(h.sync.effective(), false, 'no snapshot yet: the full fire stays');
 assert.equal(h.canvas.style.visibility, '');
 h.prototype.readback(0.8); h.frame(true);
 assert.equal(h.sync.effective(), true);
 assert.equal(h.canvas.style.visibility, 'hidden');
 assert.equal(h.prototype.suppressed, true, 'the canvas raymarch is not drawn while the splats stand in');
 assert.equal(h.bridge.mesh.visible, false);
 assert.ok(h.enabled.has(4) && h.layers[0].state().count === 1);
 h.frame(false);
 assert.equal(h.sync.effective(), false);
 assert.equal(h.canvas.style.visibility, '');
 assert.equal(h.prototype.suppressed, false);
 assert.ok(!h.enabled.has(4));
});

test('a disabled volume draws no proxy, and enabling it again brings the held field back', () => {
 const h = harness();
 h.frame(true);
 h.prototype.readback(0.8); h.frame(true);
 assert.equal(h.sync.effective(), true);
 h.prototype.setActive(false); h.frame(true);
 const layer = h.sync.layer();
 assert.ok(!h.enabled.has(4), 'the viewport camera stops drawing the proxy layer');
 assert.ok(!layer || layer.state().count === 0 || layer.group.visible === false, 'no splats remain drawable for a disabled volume');
 assert.equal(h.sync.effective(), false);
 assert.equal(h.prototype.suppressed, false);
 h.prototype.setActive(true); h.frame(true);
 assert.equal(h.sync.effective(), true, 'the held field stands in again without a new readback');
 assert.equal(h.sync.layer().state().count, 1);
});

test('hidden Proxy fire is not pickable, while visible Proxy and snapshot-only Full still are',()=>{
 const h=harness(),ray={origin:[0,0,5],direction:[0,0,-1]},eye=[0,0,5];
 h.frame(true);h.prototype.readback(.8);h.frame(true);
 assert.ok(h.sync.pick(ray,eye));
 h.sync.layer().setStyle({visible:false});
 assert.equal(h.sync.pick(ray,eye),null,'the suppressed Full canvas cannot make hidden Proxy fire pickable');
 assert.equal(h.registry.latest('fire').count,1,'visibility does not delete shared consumer data');
 h.sync.layer().setStyle({visible:true});assert.ok(h.sync.pick(ray,eye));
 h.sync.layer().setStyle({visible:false});h.frame(false,true);
 assert.ok(h.sync.pick(ray,eye),'a hidden secondary-camera proxy does not hide the Full flame');
 h.frame(false);assert.equal(h.sync.layer(),null);assert.ok(h.sync.pick(ray,eye));
});

test('switching to Full and back keeps the field heat peak; a new field starts its own', () => {
 const h = harness();
 h.frame(true); // attaches the snapshot consumer
 h.prototype.readback(0.8); h.frame(true);
 h.prototype.readback(0.4); h.frame(true);
 assert.ok(near(h.sync.layer().state().heatReference, 0.8), 'a cooler snapshot keeps the field peak');
 h.frame(false); h.frame(true);
 assert.ok(near(h.sync.layer().state().heatReference, 0.8), `Full and back does not rebrighten the cooled flame (reference ${h.sync.layer().state().heatReference})`);
 h.prototype.setGeneration(2); h.frame(true);
 h.prototype.readback(0.4); h.frame(true);
 assert.ok(near(h.sync.layer().state().heatReference, 0.4), 'a new field does not inherit the retired peak');
});

test('the proxy writes the canvas visibility it owns and leaves other writers alone', () => {
 const h = harness();
 h.frame(false);
 h.canvas.style.visibility = 'hidden';
 h.frame(false);
 assert.equal(h.canvas.style.visibility, 'hidden', 'Full does not unhide a canvas someone else hid');
 h.canvas.style.visibility = '';
 h.frame(true); h.prototype.readback(0.8); h.frame(true);
 assert.equal(h.canvas.style.visibility, 'hidden');
 h.frame(false);
 assert.equal(h.canvas.style.visibility, '', 'the proxy restores what it hid');
});

test('while the splats stand in, the light field rebuilds only with snapshots and the sim steps at the opted-in interval', () => {
 const h = harness();
 h.frame(true);
 assert.equal(h.prototype.pacing, null, 'no pacing before the proxy stands in');
 h.prototype.readback(0.8); h.frame(true);
 assert.deepEqual(h.prototype.pacing, {lightFieldWithSnapshots: true, simStepEvery: 1});
 h.frame(true, false, 4);
 assert.deepEqual(h.prototype.pacing, {lightFieldWithSnapshots: true, simStepEvery: 4}, 'the opt-in step interval reaches the sim');
 h.frame(false);
 assert.equal(h.prototype.pacing, null, 'Full runs the sim and light field every frame');
 h.frame(true); h.prototype.setActive(false); h.frame(true);
 assert.equal(h.prototype.pacing, null, 'a disabled volume carries no pacing');
});
