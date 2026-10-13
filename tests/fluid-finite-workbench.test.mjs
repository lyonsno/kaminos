import assert from 'node:assert/strict';
import {finiteWorkbenchRoute} from '../fluid-finite-workbench.mjs';
assert.equal(finiteWorkbenchRoute(new URLSearchParams()),null);
const r=finiteWorkbenchRoute(new URLSearchParams('finger_fluid_box_scene=dam_break&finger_fluid_box_resolution=32&finger_fluid_playback_rate=2'));
assert.equal(r.fixture.scene,'dam_break');assert.equal(r.fixture.particleCount,32768);assert.equal(r.fixture.representedVolume,1);assert.equal(r.dt,1/240);
for(const q of ['finger_fluid_box_scene=oops','finger_fluid_box_scene=block_drop&finger_fluid_physics_dt=.003','finger_fluid_box_scene=block_drop&finger_fluid_playback_rate=0','finger_fluid_box_scene=block_drop&finger_fluid_pressure_solver=ipbf'])assert.throws(()=>finiteWorkbenchRoute(new URLSearchParams(q)));
console.log('Finite scene, volume, clock and requested solver admission pass');
