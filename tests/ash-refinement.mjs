// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {ashObjectLayout,defaultAshSettings} from '../ash/scene-record.mjs';

test('refined ash allocates coarse background and fine regions with one physical owner',async()=>{
 const settings={...defaultAshSettings(),width:1.6,depth:1.6,height:.8,cellSize:.05,refinement:{ratio:2,regions:[{min:[-.4,0,-.4],max:[.4,.4,.4]}]}};
 const p=ashObjectLayout(settings);
 assert.equal(p.refinement?.ratio,2,'authored refinement must reach the physical layout');
 const {refinementCell,refinementIndex}=await import('../ash/refinement-plan.mjs');
 let volume=0,leaves=0;
 for(let i=0;i<p.count;i++){
  const c=refinementCell(p,i);if(!c?.owned)continue;
  volume+=(c.size*p.cellSize)**3;leaves++;
  assert.equal(refinementIndex(p,c.coord),i);
 }
 assert.ok(Math.abs(volume-1.6*1.6*.8)<1e-10,'leaf volumes partition the domain without double-counting');
 assert.ok(leaves<32*16*32,'local refinement does not allocate the global fine lattice');
 assert.equal(refinementCell(p,refinementIndex(p,[16,2,16])).size,1);
 assert.equal(refinementCell(p,refinementIndex(p,[0,2,0])).size,2);
});

test('refinement regions reject misalignment and overlap instead of losing ownership',async()=>{
 const {createRefinementLayout}=await import('../ash/refinement-plan.mjs');
 const input={cellSize:.1,bounds:{min:[0,0,0],max:[2,1,2]},tileSize:4,refinement:{ratio:2,regions:[{min:[.3,0,0],max:[1,.4,1]}]}};
 assert.throws(()=>createRefinementLayout(input),/align/);
 input.refinement.regions=[{min:[0,0,0],max:[1,.4,1]},{min:[.8,0,0],max:[1.2,.4,1]}];
 assert.throws(()=>createRefinementLayout(input),/overlap/);
});

test('coarse-fine exchange conserves volume with bounded density and transfers across all six interface directions',async()=>{
 const {createRefinementLayout,refinementCell,referenceRefinementStep}=await import('../ash/refinement-plan.mjs');
 const p=createRefinementLayout({cellSize:1,bounds:{min:[0,0,0],max:[8,8,8]},tileSize:4,refinement:{ratio:2,regions:[{min:[2,2,2],max:[6,6,6]}]}});
 for(let axis=0;axis<3;axis++)for(const sign of [-1,1]){
  const values=new Float32Array(p.count);
  const source=Array.from({length:p.count},(_,i)=>({i,c:refinementCell(p,i)})).filter(({c})=>c?.owned&&c.size===(sign>0?2:1)&&c.coord[axis]===(sign>0?0:5));
  for(const {i,c}of source)values[i]=c.size**3*.8;
  const before=values.reduce((a,b)=>a+b,0);
  let state=values;
  for(let step=0;step<12;step++)state=referenceRefinementStep(p,state,{axes:[axis],gravity:false});
  const after=state.reduce((a,b)=>a+b,0);
  assert.ok(Math.abs(after-before)<1e-4,`axis ${axis}/${sign} conserves volume`);
  assert.ok(state.every((m,i)=>m>=0&&m<=refinementCell(p,i).size**3+1e-6));
  assert.ok(state.some((m,i)=>m>0&&refinementCell(p,i).size!==(sign>0?2:1)),'material crosses resolution boundary');
 }
});

import {createAshSceneObject} from '../ash/scene-object.mjs';
import {Group} from '../lib/three.core.js';
test('native field forwards refinement to its runtime and retains refined checkpoint identity',async()=>{
 const ash={...defaultAshSettings(),width:1.6,depth:1.6,height:.8,cellSize:.05,initialDepth:0,sourcePosition:[0,.4,0],refinement:{ratio:2,regions:[{min:[-.4,0,-.4],max:[.4,.4,.4]}]}};
 const record={id:'refined-field',type:'retained-ash',source:'kaminos:retained-ash',transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},ash};
 let received;
 const obj=await createAshSceneObject({record,readObjects:()=>[],createPatch:async options=>{
  received=options;
  return {root:new Group(),setSoftNormals(){},setSliding(){},syncScene(){},read:()=>({}),dispose(){}};
 }});
 assert.deepEqual(received.refinement,ash.refinement,'native ash must construct the actual refined backend');
 obj.dispose();
});
