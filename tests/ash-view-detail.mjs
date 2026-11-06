// kaminos-test: node
import assert from 'node:assert/strict';
import {createRefinementLayout,refinementIndex,refinementCell,refinementSurfaceCache} from '../ash/refinement-plan.mjs';
import {adaptiveView} from '../ash/adaptive-plan.mjs';
const input={cellSize:.04,bounds:{min:[0,0,0],max:[.64,.32,.64]},refinement:{mode:'adaptive',ratio:2,levels:3,fineCapacity:4,detailCapacity:2}};
const p=createRefinementLayout(input);
assert.equal(p.cellSize,.02,'third physical level halves the receiving pitch while preserving the existing background');
assert.equal(p.regions[0].layout.cellSize,.08);
assert.equal(p.regions[0].scale,4);
assert.equal(p.pool.scale,2);
assert.equal(p.detailPool.scale,1);
assert.equal(p.detailPool.capacity,2);
const residency={map:new Array(p.pool.pages).fill(0),slots:new Array(p.pool.capacity).fill(0),detail:{map:new Array(p.detailPool.pages).fill(0),slots:new Array(p.detailPool.capacity).fill(0)}};
for(let i=0;i<p.pool.pages;i++){residency.map[i]=i+1;residency.slots[i]=i+1;}
residency.detail.map[0]=1;residency.detail.slots[0]=1;
const view=adaptiveView(p,residency);
assert.equal(refinementCell(view,refinementIndex(view,[1,1,1])).size,1);
assert.equal(refinementCell(view,refinementIndex(view,[9,1,1])).size,2);
let ownedVolume=0;for(let i=0;i<p.count;i++){const c=refinementCell(view,i);if(c.owned)ownedVolume+=c.size**3;}
assert.equal(ownedVolume,p.dims.reduce((a,b)=>a*b,1),'three owner levels cover the field exactly once');
const broken=structuredClone(residency);broken.map.fill(0);broken.slots.fill(0);
assert.throws(()=>adaptiveView(p,broken),/parent|balance/i,'fine checkpoints must have their supporting middle owners');
assert.ok(refinementSurfaceCache(p).words*4 < p.faceWords*4);
assert.throws(()=>createRefinementLayout({...input,refinement:{...input.refinement,levels:4}}),/levels/i);
console.log('three-level physical addresses, coverage, capacity and checkpoint parents pass');
import {fallingLayout} from '../ash/fall-plan.mjs';
const two=createRefinementLayout({...input,refinement:{...input.refinement,levels:2}}),oldAir=fallingLayout(two),newAir=fallingLayout(p);
assert.equal(newAir.capacity,oldAir.capacity,'finer contact cells must not multiply the existing airborne parcel pool');
assert.equal(newAir.parcelVolume,oldAir.parcelVolume,'contact refinement preserves physical airborne parcel size');
import {createAshSceneObject} from '../ash/scene-object.mjs';
import {defaultAshSettings,ashObjectLayout,checkedAshSettings} from '../ash/scene-record.mjs';
import {OrthographicCamera,Group} from '../lib/three.core.js';
assert.equal(defaultAshSettings().refinement.levels,3,'new native fields include the requested extra physical level');
const old={...defaultAshSettings(),refinement:{mode:'adaptive',ratio:2,fineFraction:.125},checkpoint:null};
assert.equal(ashObjectLayout(checkedAshSettings(old)).cellSize,old.cellSize,'saved two-level settings keep their original physical meaning');
const camera=new OrthographicCamera(-2,2,2,-2,.1,10);camera.position.set(0,0,5);camera.updateMatrixWorld(true);
let received;
const sceneObject=await createAshSceneObject({record:{id:'view-field',type:'retained-ash',source:'kaminos:retained-ash',transform:{position:[1,0,0],rotation:[0,0,0],scale:[1,1,1]},ash:{...defaultAshSettings(),width:.64,depth:.64,height:.32,initialDepth:0}},camera,renderer:{getDrawingBufferSize(v){return v.set(1000,800);}},readObjects:()=>[],createPatch:async options=>{
 received=options;return {root:new Group(),setSoftNormals(){},setSliding(){},syncScene(){},read:()=>({}),dispose(){}};
}});
try{
 assert.equal(received.cellSize,.04,'native build must not halve the requested pitch twice');
 const first=received.readView();assert.deepEqual(first.viewport,[1000,800]);assert.equal(first.matrix[12],.5,'projection includes the field transform');
 camera.position.x=1;assert.equal(received.readView().matrix[12],0,'current camera motion reaches the allocator input');
 await sceneObject.regrid({cellSize:.02});assert.equal(received.cellSize,.02);
}finally{sceneObject.dispose();}
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const badOut=mkdtempSync(join(tmpdir(),'ash-detail-invalid-level-'));
const badLevel=spawnSync(process.execPath,['tools/ash-adaptive-native-witness.mjs','--repo',process.cwd(),'--url','http://127.0.0.1:1','--levels','4','--out',badOut],{encoding:'utf8'});
assert.equal(badLevel.status,1);const failure=JSON.parse(readFileSync(join(badOut,'report.json'),'utf8'));
assert.equal(failure.status,'failed');assert.equal(failure.phase,'arguments');assert.equal(failure.requested.levels,4);assert.match(failure.error,/levels must be/);
