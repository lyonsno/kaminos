// kaminos-test: node
import assert from 'node:assert/strict';
import * as stock from '../experiments/stock-family/model.mjs';
import {Matrix4,Vector3,Quaternion,Euler} from '../lib/three.core.js';
assert.equal(typeof stock.stockMouthFrame,'function','Stock mouths must travel through the same authored warp');
const profile={min:-.5,max:.5,xMin:-.1,xMax:.1,locks:[]},parameters={length:2,bend:90,protect:false};
const warp=stock.createStockWarp(profile,parameters),mouths=stock.stockMouths(profile);
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const frame=side=>stock.stockMouthFrame(warp,profile,mouths,side);
for(const side of ['start','end']){
 const f=frame(side),p=warp.point([0,0,side==='start'?-.5:.5]);
 f.position.forEach((v,i)=>near(v,p.position[i]));
 const n=new Vector3(0,0,1).applyQuaternion(new Quaternion(...f.quaternion));
 near(n.dot(new Vector3(Math.sin(p.theta),0,Math.cos(p.theta))),side==='start'?-1:1);
}
const moving=frame('start'),target=frame('end');
const matrix=(p,r,s)=>new Matrix4().compose(new Vector3(...p),new Quaternion().setFromEuler(new Euler(...r)),new Vector3(...s));
const parent=matrix([5,2,-1],[.1,.5,.2],[2,2,2]),world=parent.clone().multiply(matrix([1,0,2],[0,.2,0],[.5,.5,.5]));
const fixed=matrix([-3,1,4],[.2,-.6,.3],[1.4,1.4,1.4]);
const aligned=stock.alignStockMouth({moving,target,movingWorld:world,targetWorld:fixed,parentWorld:parent});
const next=parent.clone().multiply(matrix(aligned.position,aligned.rotation,aligned.scale));
const gap=stock.stockMouthGap(moving,next,target,fixed);near(gap.distance,0);near(gap.facingDegrees,0);
aligned.scale.forEach(v=>near(v,.5));
assert.throws(()=>stock.alignStockMouth({moving,target,movingWorld:matrix([0,0,0],[0,0,0],[1,2,1]),targetWorld:fixed}),/uniform/i);
assert.throws(()=>stock.alignStockMouth({moving,target,movingWorld:world,targetWorld:matrix([0,0,0],[0,0,0],[-1,1,1])}),/uniform/i);
for(const a of ['start','end'])for(const b of ['start','end']){
 const nextPose=stock.alignStockMouth({moving:frame(a),target:frame(b),movingWorld:world,targetWorld:fixed,parentWorld:parent});
 const joined=parent.clone().multiply(matrix(nextPose.position,nextPose.rotation,nextPose.scale));
 const result=stock.stockMouthGap(frame(a),joined,frame(b),fixed);near(result.distance,0);near(result.facingDegrees,0);
}
assert.throws(()=>stock.stockMouths(profile,{start:{station:0,x:0,y:0},end:{station:-.1,x:0,y:0}}),/ordered/i);
assert.throws(()=>stock.stockMouths(profile,{start:{station:-.5,x:NaN,y:0},end:mouths.end}),/finite/i);
assert.throws(()=>stock.stockMouths(profile,{...mouths,start:{...mouths.start,station:-.6}}),/profile/i);
assert.throws(()=>stock.stockMouthFrame(warp,profile,mouths,'bad'),/mouth/i);
const recipe=structuredClone(stock.DEFAULT_RECIPE);recipe.source.mouths=stock.stockMouths(recipe.source.profile);
assert.deepEqual(stock.validateRecipe(JSON.parse(JSON.stringify(recipe))).source.mouths,recipe.source.mouths);
assert.throws(()=>stock.validateRecipe({...recipe,source:{...recipe.source,mouths:{}}}),/mouth/i);
assert.throws(()=>stock.validateRecipe({...recipe,supports:[{label:'Post',source:recipe.source,pose:{position:[0,0,0],rotation:[0,0,0],scale:[0,1,1]}}]}),/support/i);
console.log('stock mouths: warped outward frames, parented alignment, scale retention, explicit calibration and recipe validation passed');
