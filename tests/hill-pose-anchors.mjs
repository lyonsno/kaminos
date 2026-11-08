// kaminos-test: node
import assert from 'node:assert/strict';
import {makeVolumeSpecimen,volumePoseAnchors,contains,rotate,weatherBody} from '../experiments/hill-terrain/volume-model.mjs';
const model=makeVolumeSpecimen({spacing:.15}),before=volumePoseAnchors(model);assert.equal(before.length,9);assert.equal(new Set(before.map(a=>a.id)).size,9);
for(const a of before){assert.equal(a.frame,'specimen');assert.deepEqual(a.locks,{position:true,orientation:true});assert.equal(a.canRelease,true);assert.ok(contains(model.bodies[a.rock].solid,a.mount,1e-6));const pl=model.bodies[a.rock].solid.planes;assert.ok(pl.some(p=>Math.abs(p.slice(0,3).reduce((n,v,k)=>n+v*a.mount[k],0)-p[3])<1e-6),'Mount is on a source face');}
const grown=volumePoseAnchors(model,.25);for(let i=0;i<9;i++){const p=model.bodies[i].position,expected=.25*Math.exp(-(p[0]**2+p[2]**2)/.75);assert.ok(Math.abs(grown[i].specimenPoint[1]-before[i].specimenPoint[1]-expected)<1e-10);}
model.bodies[7].anchored=false;const released=volumePoseAnchors(model);assert.equal(released[7].specimenPoint,null);assert.equal(released[0].canRelease,false);assert.match(released[0].reason,/Reset/);
model.bodies[7].anchored=true;weatherBody(model,7,.02);const after=volumePoseAnchors(model);assert.equal(after[7].id,before[7].id);assert.ok(contains(model.bodies[7].solid,after[7].mount,1e-6));assert.notDeepEqual(after[7].mount,before[7].mount,'Weathering reconstructs the actual surface mount');
const body=model.bodies[0];body.restPosition=[...body.position];body.rotation=[0,0,Math.sin(.2),Math.cos(.2)];const a=volumePoseAnchors(model)[0],p=rotate(body.rotation,a.mount).map((v,k)=>v+body.restPosition[k]);assert.deepEqual(a.specimenPoint,p);
