import test from 'node:test';
import assert from 'node:assert/strict';
import * as controls from '../finger-fluid-webgpu-core.js';

test('partial controls preserve volume calibration and publish only at a submitted step',()=>{
  assert.equal(typeof controls.createIPBFPressureControlState,'function','live pressure-control state capability absent');
  const state=controls.createIPBFPressureControlState({baseRadius:.185,pressureRadiusScale:1,beta:60,densityIterations:3,capillaryStrength:.72});
  state.request({pressureRadiusScale:.1155/.185,beta:60*.185/.1155,densityIterations:2});
  assert.equal(state.read().effective.radius,.185);
  assert.equal(state.read().requested.radius,.1155);
  assert.equal(state.read().requested.capillaryStrength,.72);
  assert.equal(state.read().effectiveGeneration,0);
  const packet=state.submit(42);
  assert.ok(packet instanceof Float32Array&&packet.length===4);
  assert.equal(packet[0],Math.fround(.1155));
  assert.equal(packet[1],Math.fround(60*.185/.1155));
  assert.equal(state.read().effective.densityIterations,2);
  assert.equal(state.read().submittedStep,42);
  assert.equal(state.read().effectiveGeneration,1);
});

test('invalid updates are atomic and an unchanged request does not create a generation',()=>{
  assert.equal(typeof controls.createIPBFPressureControlState,'function','live pressure-control state capability absent');
  const state=controls.createIPBFPressureControlState({baseRadius:.185,pressureRadiusScale:1,beta:60,densityIterations:3,capillaryStrength:.72});
  const before=state.read();
  for(const patch of [{pressureRadiusScale:0},{beta:Infinity},{densityIterations:1.5},{capillaryStrength:3},{particleCount:20000}]) {
    assert.throws(()=>state.request(patch));
    assert.deepEqual(state.read(),before);
  }
  state.request({pressureRadiusScale:1});assert.deepEqual(state.read(),before);
});

test('linked damping changes beta to preserve threshold while unlinked edits preserve beta',()=>{
  assert.equal(typeof controls.ipbfBetaForRadius,'function','linked damping control capability absent');
  assert.equal(controls.ipbfBetaForRadius({radius:.1155,beta:60,previousRadius:.185,linked:true}),60*.185/.1155);
  assert.equal(controls.ipbfBetaForRadius({radius:.1155,beta:60,previousRadius:.185,linked:false}),60);
});

test('replay URLs keep the physical population and unrelated optical settings',()=>{
  assert.equal(typeof controls.ipbfPressureReplayURL,'function','pressure-control replay capability absent');
  const u=new URL(controls.ipbfPressureReplayURL('http://localhost:20211/index.html?finger_fluid_particle_count=12288&finger_fluid_fixed_volume_reference_count=36864&finger_fluid_renderer=screen_space_refraction',
    {pressureRadiusScale:.625,beta:96,densityIterations:5,capillaryStrength:.4},true));
  assert.equal(u.searchParams.get('finger_fluid_particle_count'),'12288');
  assert.equal(u.searchParams.get('finger_fluid_fixed_volume_reference_count'),'36864');
  assert.equal(u.searchParams.get('finger_fluid_renderer'),'screen_space_refraction');
  assert.equal(u.searchParams.get('finger_fluid_density_iterations'),'5');
  assert.equal(u.searchParams.get('finger_fluid_ipbf_beta'),'96');
  assert.equal(u.searchParams.get('finger_fluid_pressure_cockpit'),'1');
});
