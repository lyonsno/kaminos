// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {presentationPhase, presentationBlendPhase, cadenceSimSpeed} from '../fire-presentation-cadence.mjs';

test('between real steps the phase is the fraction of a step that has elapsed', () => {
 const phases = [0, 1, 2, 3, 4, 5].map(frame => presentationPhase({frame, simStepEvery: 3, presentationAdvect: true}));
 assert.deepEqual(phases.map(p => Number(p.toFixed(6))), [0, 0.333333, 0.666667, 0, 0.333333, 0.666667]);
});

test('no phase without opted-in advection or with the sim stepping every frame', () => {
 assert.equal(presentationPhase({frame: 1, simStepEvery: 3, presentationAdvect: false}), 0);
 assert.equal(presentationPhase({frame: 1, simStepEvery: 1, presentationAdvect: true}), 0);
 assert.equal(presentationPhase(null), 0);
 assert.equal(presentationPhase({frame: Number.NaN, simStepEvery: 2, presentationAdvect: true}), 0);
 assert.equal(presentationPhase({frame: 3, simStepEvery: 2.7, presentationAdvect: true}), 0.5, 'the interval floors like the sim pacing');
});

test('the raymarch carries each sample point forward by the phase, clipped against scene solids, and the frame writes the phase', () => {
 const source = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
 const fn = /fn presentationAdvect\([\s\S]*?\n}\n/.exec(source)?.[0] ?? '';
 assert.match(fn, /u\.reserved_render_controls\.y/, 'the phase rides the free reserved render lane');
 assert.match(fn, /sceneClipCharacteristic\(/, 'the carried point stops at scene solids like the sim backtrace');
 assert.match(fn, /dynamicsBacktraceScale\(\)/, 'one real step carries as far as the sim transport does');
 assert.match(source, /let p = presentationAdvect\(select\(ro \+ rd \* t, fullGridP, fullGridCapture\)/);
 assert.match(source, /uniforms\[45\] = presentationPhase\(/);
});

test('blend shows the previous real state on a step frame and moves toward the new one between steps', () => {
 const pacing = frame => ({frame, simStepEvery: 4, presentationBlend: true});
 assert.deepEqual([0, 1, 2, 3, 4].map(frame => presentationBlendPhase(pacing(frame))), [0, 0.25, 0.5, 0.75, 0]);
 assert.equal(presentationPhase(pacing(1)), 0, 'blend is not a carry');
 assert.equal(presentationBlendPhase({frame: 1, simStepEvery: 4, presentationAdvect: true}), 0, 'carry is not a blend');
 assert.equal(presentationBlendPhase({frame: 1, simStepEvery: 1, presentationBlend: true}), 0);
});

test('the frame blends the previous and current fluid state into the buffer the raymarch reads', () => {
 const source = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
 assert.match(source, /uniforms\[41\] = presentationBlendPhase\(/);
 assert.match(source, /presented\[i\] = mix\(previous\[i\], current\[i\], blend\.x\)/);
 assert.match(source, /copyBufferToBuffer\(fluidBuffers\[currentFluid\], 0, fluidPrevBuffer, 0/);
 assert.match(source, /pass\.setBindGroup\(0, options\.bindGroup \|\| presentationBindGroup\(\)\)/);
});

test('a paused sim shows the latest real state, crisp, in every mode', () => {
 const paused = {paused: true};
 assert.equal(presentationBlendPhase({frame: 2, simStepEvery: 4, presentationBlend: true}, paused), 1, 'blend shows the current state, not a held half-mix');
 assert.equal(presentationPhase({frame: 2, simStepEvery: 4, presentationAdvect: true}, paused), 0, 'carry shows the real state, not a held extrapolation');
 assert.equal(presentationBlendPhase({frame: 2, simStepEvery: 4, presentationBlend: true}, {paused: false}), 0.5);
});

test('Speed is the world rate: stepping every N frames takes N-times-larger steps', () => {
 assert.equal(cadenceSimSpeed(1.6, 1), 1.6);
 assert.ok(Math.abs(cadenceSimSpeed(1.6, 3) - 4.8) < 1e-9);
 assert.equal(cadenceSimSpeed(0.5, 4.9), 2, 'the interval floors like the sim pacing');
 assert.equal(cadenceSimSpeed(1.2, undefined), 1.2);
});

test('the flame panel carries the cadence as renderer controls under Speed', () => {
 const schema = JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json', import.meta.url), 'utf8'));
 const every = schema.rendererControls.find(control => control.key === 'volume-sim-every');
 const between = schema.rendererControls.find(control => control.key === 'volume-sim-between');
 assert.deepEqual(every, {key: 'volume-sim-every', param: 'volume_sim_every', tagName: 'INPUT', type: 'range', additiveDefault: 1});
 assert.deepEqual(between, {key: 'volume-sim-between', param: 'volume_sim_between', tagName: 'SELECT', type: 'select-one', allowedValues: ['held', 'carry', 'blend'], additiveDefault: 'blend'});
 const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
 assert.match(index, /id="volume-speed"[\s\S]*?<\/div>\s*<div class="slider-row"[^>]*>\s*<span class="slider-label">Sim every \(frames\)<\/span>\s*<input type="range" id="volume-sim-every"/, 'Sim every sits directly under Speed');
});

test('a saved cockpit layout gains the cadence controls directly under Speed, not in New controls', async () => {
 const {reconcileVolumeCockpitLayoutDocument, VOLUME_COCKPIT_LAYOUT_IDENTITY} = await import('../volume-cockpit-layout.mjs');
 const saved = {identity: VOLUME_COCKPIT_LAYOUT_IDENTITY, layoutId: 'operator-layout', label: 'Operator', groups: [
  {id: 'organized-simulation', label: 'Simulation dynamics', surface: 'primary', collapsed: false, controlIds: ['volume-projection', 'volume-speed', 'volume-fire-scale']}]};
 const result = reconcileVolumeCockpitLayoutDocument({document: saved,
  authorableControlIds: ['volume-projection', 'volume-speed', 'volume-sim-every', 'volume-sim-between', 'volume-fire-scale']});
 assert.deepEqual(result.document.groups.map(group => [group.id, group.controlIds]),
  [['organized-simulation', ['volume-projection', 'volume-speed', 'volume-sim-every', 'volume-sim-between', 'volume-fire-scale']]]);
});
