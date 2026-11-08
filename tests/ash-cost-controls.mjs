// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {checkedAshSettings,defaultAshSettings} from '../ash/scene-record.mjs';
import {createAshSceneObject} from '../ash/scene-object.mjs';
import {createRefinementLayout} from '../ash/refinement-plan.mjs';
import {fallingLayout} from '../ash/fall-plan.mjs';
import {Group} from '../lib/three.core.js';
const settings=()=>({...defaultAshSettings(),width:.64,depth:.64,height:.4,cellSize:.00125,initialDepth:0,sourcePosition:[0,.36,0],refinement:{mode:'hierarchy',ratio:2,backgroundCellSize:.08,budgetMiB:4,airBudgetMiB:1}});
const layout=s=>createRefinementLayout({cellSize:s.cellSize,bounds:{min:[-.32,0,-.32],max:[.32,.4,.32]},refinement:s.refinement});
test('independent draw and evolution switches reject invalid saved values',()=>{
 for(const key of ['showAirborne','showDeposited','moveAirborne','settleDeposited'])assert.throws(()=>checkedAshSettings({...settings(),[key]:'off'}),/ash.*(switch|activity)/i,key);
});
test('runtime switches and allocation policy edit without clearing material or rebuilding',async()=>{
 let builds=0;const activity=[],policies=[];
 const s=settings(),record={id:'f',type:'retained-ash',source:'kaminos:retained-ash',label:'Ash',transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},ash:s};
 const object=await createAshSceneObject({record,readObjects:()=>[],createPatch:async()=>{builds++;return {root:new Group(),syncScene(){},read:()=>({}),setActivity:v=>activity.push(v),setRefinementPolicy:v=>policies.push(v),dispose(){}};}});
 try{await object.initialize();object.set({showAirborne:false,showDeposited:true,moveAirborne:false,settleDeposited:true});assert.equal(activity.at(-1)?.moveAirborne,false,'native control reaches airborne update owner');
 object.set({refinement:{...s.refinement,maxDepth:4,planningRounds:2,depthBudgetMiB:[0,.5,.5,1,1,0,0]}});assert.equal(policies.at(-1)?.maxDepth,4);assert.equal(builds,1,'policy must preserve the existing field and material');assert.equal(object.read().settings.refinement.maxDepth,4);
 }finally{object.dispose();}
});
test('transport volume stays independent of receiving precision',()=>{
 const s=settings();s.refinement.transportCellSize=.0025;
 const a=fallingLayout(layout(s));s.cellSize=.000625;const b=fallingLayout(layout(s));
 assert.ok(Math.abs(a.parcelVolume-b.parcelVolume)<1e-20,'one finer receiving level cannot shrink a chosen physical transport parcel');
 assert.ok(Math.abs(a.parcelVolume-8*.0025**3)<1e-20);
});
test('hierarchy policy validates maximum depth, per-depth targets and planning allowance',()=>{
 for(const patch of [{maxDepth:-1},{maxDepth:1.5},{planningRounds:0},{planningRounds:NaN},{depthBudgetMiB:[0,-1]},{depthBudgetMiB:[0,NaN]},{transportCellSize:0}])assert.throws(()=>layout({...settings(),refinement:{...settings().refinement,...patch}}),/ash.*(depth|planning|transport|budget)/i,JSON.stringify(patch));
});

test('saved layout compatibility ignores derived addresses and live policy, but retains physical limits',async()=>{
 const {sameAshLayout}=await import('../ash/cost-policy.mjs'),s=settings(),a=layout(s),b=structuredClone(a);
 a.hierarchyArena={nodes:20,end:100};b.hierarchyArena={nodes:20,end:140,policy:101};b.refinement.maxDepth=2;b.refinement.planningRounds=2;
 assert.equal(sameAshLayout(a,b),true,'rebuilding derived metadata and changing admission policy preserves a saved physical layout');
 b.cellSize/=2;assert.equal(sameAshLayout(a,b),false,'changed material units cannot reuse the old saved layout');b.cellSize=a.cellSize;b.dims[0]++;assert.equal(sameAshLayout(a,b),false,'changed bounds cannot silently adopt saved material');
});
