import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluateIPBF} from '../finger-fluid-ipbf-reference.mjs';
import {createIPBFPressureControlState,ipbfPressureReplayURL} from '../finger-fluid-pressure-controls.mjs';
let api={};try{api=await import('../finger-fluid-ipbf-calibration.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
const config={particleVolume:.00016666666666666666,radius:.125,dt:1/60};
const reference=()=>{assert.equal(typeof api.deriveIPBFSoftnessReference,'function','Missing derived alternate-response calibration');return api.deriveIPBFSoftnessReference(config);};
test('compressed reference has active pressure and independently predicts alternate correction brackets',()=>{
 const r=reference();assert.ok(r.constraint>0);assert.ok(r.directionalPressureHessian>0);
 const normal=evaluateIPBF(r.state).updates[r.index];
 for(const b of r.brackets){const soft=evaluateIPBF({...r.state,compliance:b.alternativeCompliance}).updates[r.index];assert.ok(Math.abs(soft[0]/normal[0]-b.updateFraction)<1e-8);}
});
test('full local updates covary under geometric scale and timestep with derived compliance',()=>{
 const r=reference(),alpha=r.brackets[1].alternativeCompliance;
 const base=evaluateIPBF({...r.state,compliance:alpha}).updates[r.index];
 for(const [s,t] of [[8,1],[.25,2]]){
  const scaled={...r.state,positions:r.state.positions.map(p=>p.map(x=>x*s)),inertial:r.state.inertial.map(p=>p.map(x=>x*s)),masses:r.state.masses.map(m=>m*s**3),supportRadius:r.state.supportRadius*s,dt:r.state.dt*t,compliance:alpha*t*t/s**5};
  const moved=evaluateIPBF(scaled).updates[r.index];moved.forEach((v,k)=>assert.ok(Math.abs(v/s-base[k])<1e-9));
 }
});
test('alternate compliance is independently editable, packed, retained on replay and rejects invalid input atomically',()=>{
 const state=createIPBFPressureControlState({baseRadius:.185,pressureRadiusScale:1,beta:60,densityIterations:3,capillaryStrength:.48,alternativeCompliance:.001});
 state.request({alternativeCompliance:12});assert.equal(state.read().requested.radius,.185);assert.equal(state.read().effective.alternativeCompliance,.001);assert.equal(state.submit(2)[2],12);
 const before=state.read();for(const x of [-1,Infinity,1e300]){assert.throws(()=>state.request({alternativeCompliance:x}));assert.deepEqual(state.read(),before);}
 const url=new URL(ipbfPressureReplayURL('http://localhost/?finger_fluid_truth_scene=river_playground',state.read().requested,false));assert.equal(url.searchParams.get('finger_fluid_ipbf_alternative_compliance'),'12');
});

test('actual live-step pressure write includes alternate compliance',()=>{
 const source=readFileSync(new URL('../finger-fluid-webgpu-core.js',import.meta.url),'utf8');
 const body=source.split('function writeSimulationParams(dt)')[1].split('const buffer = new ArrayBuffer')[0];
 const expression=body.match(/const packet=(.*);/)[1];
 const packet=new Function('effective',`return ${expression}`)({radius:.185,beta:60,alternativeCompliance:12});
 assert.equal(packet[2],12,'Live GPU writer substituted padding for alternate compliance');
});
