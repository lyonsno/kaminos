// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createCorrosionState,advanceCorrosion,corrosionSummary,serializeCorrosion,restoreCorrosion} from '../coating-corrosion.mjs';
const sum=a=>a.reduce((s,x)=>s+x,0);
test('dry and oxygen-free controls cannot consume steel',()=>{
 for(const options of [{wetFraction:0},{oxygenSupply:0}]){
  const s=createCorrosionState({resolution:8,...options});advanceCorrosion(s,2);
  assert.equal(sum(s.metalLoss),0);assert.equal(sum(s.rustIron),0);
 }
});
test('corrosion retains separate consumed, transported and precipitated iron',()=>{
 const s=createCorrosionState({resolution:10,wetFraction:1});advanceCorrosion(s,4);
 const r=corrosionSummary(s);assert.ok(r.consumedIron>0);assert.ok(r.dissolvedIron>0);assert.ok(r.depositedIron>0);
 assert.ok(Math.abs(r.ironBalanceError)<1e-10);assert.ok(s.rustIron.every(v=>Number.isFinite(v)&&v>=0));
 assert.ok(s.oxygen.every(v=>v>=0&&v<=1));assert.ok(s.moisture.every(v=>v>=0&&v<=1));
});
test('periodic iron transport conserves mass across the tile seam',()=>{
 const s=createCorrosionState({resolution:8,corrosionRate:0,precipitationRate:0,wetFraction:1});s.moisture.fill(1);s.dissolvedIron[0]=1;
 advanceCorrosion(s,.03);assert.ok(Math.abs(sum(s.dissolvedIron)-1)<1e-12);assert.ok(s.dissolvedIron[7]>0);assert.ok(s.dissolvedIron[56]>0);
});
test('deposited oxide creates contact lift and irreversible loss of adhesion',()=>{
 const s=createCorrosionState({resolution:8,corrosionRate:0,precipitationRate:0,adhesionEnergy:1e-8});s.rustIron[27]=2;s.metalLoss[27]=2;
 advanceCorrosion(s,.02);assert.ok(s.filmHeight[27]>.001);assert.equal(s.bond[27],0);
 const before=Array.from(s.bond);s.rustIron.fill(0);advanceCorrosion(s,.02);assert.ok(s.bond.every((v,i)=>v<=before[i]));
});
test('retained state round trips and continues the same deterministic process',()=>{
 const a=createCorrosionState({resolution:8,seed:19});advanceCorrosion(a,.3);const b=restoreCorrosion(serializeCorrosion(a));advanceCorrosion(a,.2);advanceCorrosion(b,.2);
 assert.deepEqual(serializeCorrosion(a),serializeCorrosion(b));
});
test('invalid configuration and time reject before state changes',()=>{
 assert.throws(()=>createCorrosionState({resolution:0}),/resolution/);const s=createCorrosionState({resolution:8});const before=serializeCorrosion(s);
 assert.throws(()=>advanceCorrosion(s,-1),/time/);assert.deepEqual(serializeCorrosion(s),before);
});
test('an unloaded detached flat sheet is not pinned to the bottom of an opening',()=>{
 const s=createCorrosionState({resolution:8,corrosionRate:0,precipitationRate:0,defects:[{a:[.5,.5],b:[.5,.5],radius:.15}]});assert.ok(sum(s.opening)>0);s.bond.fill(0);s.filmHeight.fill(.1);
 advanceCorrosion(s,.02);advanceCorrosion(s,.02);assert.ok(s.filmHeight.every((v,i)=>s.opening[i]||Math.abs(v-.1)<1e-10));
});
test('defect-fed interface stays dry without access and detachment increases local transport',()=>{
 const options={resolution:8,transportRegime:'defect-fed',wetFraction:1,defects:[],corrosionRate:0,precipitationRate:0};
 const sealed=createCorrosionState(options);advanceCorrosion(sealed,1);assert.equal(sum(sealed.moisture),0);
 const held=createCorrosionState(options),loose=createCorrosionState(options);loose.bond.fill(0);
 advanceCorrosion(held,.2);advanceCorrosion(loose,.2);assert.ok(sum(loose.moisture)>sum(held.moisture));
});
test('legacy retained states keep their distributed-permeation route when restored',()=>{
 const raw=serializeCorrosion(createCorrosionState({resolution:8,transportRegime:'distributed'}));delete raw.config.transportRegime;
 const restored=restoreCorrosion(raw);assert.equal(restored.config.transportRegime,'distributed');
});
