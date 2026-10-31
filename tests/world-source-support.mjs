// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveImmersedSourceConfig,immersedSourceWeights} from '../volume-core.js';
import {flameSourceInputs} from '../scene-fire-domain.mjs';
import {checkedImmersedSources} from '../volume-immersed-source-collection.mjs';
const controls={emitterSourceLaw:'immersed-source',pressureSolver:'converged-open-top',pressureIterations:8,immersedRadius:.2,immersedSpeed:.1,immersedCentreX:2,immersedCentreY:0,immersedCentreZ:0};
test('world source retains its true location and full support outside Fine',()=>{
 const c=resolveImmersedSourceConfig(controls,{grid:32,gridHeight:64,worldSource:true});
 assert.equal(c.requested.centre[0],2,'outside source must not be clamped onto Fine wall');
 assert.equal(c.effective.admitted,true);
 assert.ok(immersedSourceWeights(c.effective,{grid:32,gridHeight:64,unbounded:true}).sum>0);
 assert.equal(c.effective.fluxRequested,0,'Fine receives no supply from a wholly exterior source');
 assert.ok(c.effective.fullFlux>0,'world receives the same source supply law outside Fine');
});
test('whole-support normalization does not concentrate a source clipped by Fine',()=>{
 const full=resolveImmersedSourceConfig({...controls,immersedCentreX:0},{grid:32,gridHeight:64,worldSource:true});
 const edge=resolveImmersedSourceConfig({...controls,immersedCentreX:1},{grid:32,gridHeight:64,worldSource:true});
 assert.ok(Math.abs(edge.effective.fluxRequested/full.effective.fluxRequested-.5)<1e-5,'half aperture supplies half the volume to Fine');
});
test('authored world source remains enabled beyond Fine and carries authority to compilation',()=>{
 const record={id:'source',type:'flame-emitter',source:'kaminos:analytic-flame',transform:{position:[3,0,0],rotation:[0,0,0],scale:[1,1,1]}};
 const [input]=flameSourceInputs([record],{controls,worldSources:true});
 assert.equal(input.controls.immersedSourceEnabled,true);
 assert.equal(input.controls.immersedCentreX,3);
 assert.equal(checkedImmersedSources([input])[0].worldSource,true);
});

test('direct world supply completes the Fine partition and preserves source motion in anchor units',async()=>{
 const {compileWorldSourceParcels,compileImmersedSourceCollection}=await import('../volume-immersed-source-collection.mjs');
 assert.equal(typeof compileWorldSourceParcels,'function','authored source supply must reach world cells');
 const controls={emitterSourceLaw:'immersed-source',pressureSolver:'converged-open-top',pressureIterations:8,immersedCentreX:1,immersedCentreY:0,immersedCentreZ:0,immersedRadius:.2,immersedPitch:90,immersedSpeed:.1};
 const packed=compileImmersedSourceCollection([{id:'crossing',worldSource:true,controls}],{controls,grid:16,gridHeight:16});
 const t={translate:[2,0,0],scale:2},anchor={translate:[0,0,0],scale:1};
 const result=compileWorldSourceParcels(packed,{grid:16,gridHeight:16,transform:t,anchor});
 assert.ok(result.parcels.length>0,'the crossing fixture must actually reach outside Fine');
 const e=packed.sources[0].config.effective,cellVolume=(2/16*2)**3;
 const volume=result.parcels.reduce((s,p)=>s+p.rate*p.lo.reduce((v,x,a)=>v*(p.hi[a]-x),1),0);
 assert.ok(Math.abs(volume/cellVolume+e.fluxEffectivePredicted-e.fullFlux)<1e-7);
 assert.ok(result.parcels.every(p=>p.lo[0]>=4),'exterior supply must not duplicate Fine supply');
 assert.ok(result.parcels.every(p=>Math.abs(p.velocity[1]-.025)<1e-8),'velocity converts from source cells to anchor distance');
 assert.equal(compileWorldSourceParcels({sources:[]},{grid:16,gridHeight:16,transform:t,anchor}).parcels.length,0);
});
