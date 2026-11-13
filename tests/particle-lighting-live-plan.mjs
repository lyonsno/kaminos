// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {liveParticleLightingSettings,particleLightingSourcePlan} from '../particle-lighting-live-plan.mjs';
function source(){const records=new Float32Array(48);for(let i=0;i<2;i++){records.set([i?5:0,i?8:0,0,1],i*24);records.set([1,.5,.1,1],i*24+8);records.set([.1,0,0,1],i*24+16);records.set([1,1,.2,1],i*24+20);}return {records,state:{effective:'world-optical-particles',slots:2,step:12,settings:{radius:.4,stretch:2,gain:1,opacity:1,stateLife:1,lifeFade:.2,flowAlignment:0,expansion:0,supportFloor:0},lightingSource:{identity:'live-source',revision:20,dims:[6,8,6],material:{density:2,extinction:3,smokeVisible:1},step:12,frame:20}}};}
test('live field contains complete active source and receiver support outside the Fine grid',()=>{
 const input=source(),p=particleLightingSourcePlan({...input,settings:liveParticleLightingSettings({enabled:true,width:8})});
 assert.equal(p.slots,2);assert.equal(p.sourceIdentity,'live-source');assert.equal(p.sourceStep,12);assert.equal(p.sourceSettings.extinction,6);
 assert.ok(p.origin[0]<=-1&&p.origin[1]<=-1);assert.ok(p.origin[0]+p.extent[0]>5.16&&p.origin[1]+p.extent[1]>8.32,'distant second particle cannot be dropped to retain a fine-box boundary');
 assert.equal(p.dims[0],8);assert.ok(Math.abs(p.extent[0]/p.dims[0]-p.extent[1]/p.dims[1])<1e-12);
});
test('source planning rejects partial populations and keeps captured scattering out of intrinsic coefficients',()=>{
 const a=source(),s=liveParticleLightingSettings();const original=particleLightingSourcePlan({...a,settings:s});a.records[4]=1e20;a.records[28]=1e20;assert.deepEqual(particleLightingSourcePlan({...a,settings:s}),original,'captured light is not an intrinsic source');
 assert.throws(()=>particleLightingSourcePlan({...source(),records:new Float32Array(24),settings:s}),/complete|population/i);
 const wrong=source();wrong.state.effective='fallback';assert.throws(()=>particleLightingSourcePlan({...wrong,settings:s}),/native|route|population/i);
});
test('display controls remain independent of transport discretization and valid ranges remain open',()=>{
 assert.equal(liveParticleLightingSettings({width:33,transportWidth:65,directions:96}).width,33);
 for(const patch of [{directions:3},{albedo:2},{width:1},{filterLength:-1},{gain:NaN}])assert.throws(()=>liveParticleLightingSettings(patch));
});
