// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {seedSourceHistory,predictSourceHistory,scoreSourceHistory,sourceHistoryTarget} from '../particle-source-history.mjs';
const stamp=(step, materialStamp=step)=>({epoch:13,step,materialStamp});
const hit=(step,power,point=[0,0,.45],extras={})=>({identity:stamp(step),slot:2,birth:19,point,sourcePower:power,...extras});
const ray=(emission,tau)=>[emission,0,0,0,0,0,0,tau];
const bundle=(step,a,b,ta=Math.log(2),tb=Math.log(4))=>{
 const moments=Array.from({length:9},()=>ray(0,0));moments[4]=ray(a,ta);moments[5]=ray(b,tb);
 return {key:'geometry',identity:stamp(step),route:'native-particle-bundle-ordered-deposition',source:'flame',width:3,sections:2,halfWidth:.3,emitter:[0,0,0],receiver:[0,0,2],moments,isolatedMoments:moments.map(row=>[...row]),isolatedCarrier:{slot:2,birth:19}};
};
test('native deposited emission seeds two distinct path columns at one explicit depth',()=>{
 const target=sourceHistoryTarget(bundle(1,8,4));
 assert.deepEqual([target.donor,target.receiver,target.section],[4,5,0]);
 assert.deepEqual(target.point,[0,0,.5]);
 assert.equal(sourceHistoryTarget({...bundle(1,8,4),source:'probe'}),null);
 assert.equal(sourceHistoryTarget(bundle(1,8,0)),null);
});
test('live source fades through held per-ray extinction, with no current recipient input',()=>{
 const sample=bundle(1,8,4),history=seedSourceHistory(sample,hit(1,20));
 assert.ok(history);
 const prediction=predictSourceHistory(history,hit(2,10,[0,.05,.45]));
 assert.equal(prediction.available,true);
 assert.equal(prediction.profiles[5].at(-1).light[0],.5);
 assert.ok(Math.abs(prediction.profiles[5].at(-1).transmission-.25)<1e-12);
 assert.deepEqual(prediction.profiles[5].map(s=>s.tau),[0,Math.log(4)]);
 const reference=bundle(2,2,3,Math.log(2),Math.log(8));
 const result=scoreSourceHistory(history,prediction,reference);
 assert.equal(result.donorCorrected.light[0],.25);
 assert.equal(result.donorCorrected.transmission,.25);
 assert.ok(Math.abs(result.fresh.light[0]-.375)<1e-12);
 assert.ok(Math.abs(result.fresh.transmission-.125)<1e-12);
 const withOtherB=scoreSourceHistory(history,prediction,bundle(2,2,30));
 assert.deepEqual(withOtherB.donorCorrected,result.donorCorrected);
 assert.notDeepEqual(withOtherB.fresh,result.fresh);
 assert.equal(predictSourceHistory(history,hit(3,0)).profiles[5].at(-1).light[0],0);
});
test('pool reuse, unsupported movement and mismatched material observations cannot claim authority',()=>{
 const sample=bundle(1,8,4);
 assert.equal(seedSourceHistory(sample,hit(2,20)),null);
 assert.equal(seedSourceHistory(sample,hit(1,20,[0,0,.45],{identity:stamp(1,91)})),null);
 const seed=seedSourceHistory(sample,hit(1,20));
 for(const candidate of [hit(2,10,undefined,{birth:20}),hit(2,10,undefined,{slot:3}),hit(2,10,[2,0,.45]),hit(2,10,undefined,{identity:{...stamp(2),epoch:14}})])assert.equal(predictSourceHistory(seed,candidate).available,false);
 const prediction=predictSourceHistory(seed,hit(2,10));
 assert.equal(scoreSourceHistory(seed,prediction,bundle(3,4,2)),null);
 assert.equal(scoreSourceHistory(seed,prediction,{...bundle(2,4,2),key:'changed'}),null);
});

test('a source carried downstream changes depth order of emission, while every blocker stays at its held depth',()=>{
 const sample=bundle(1,8,4);
 // The first two intervals are clear and the third is extinctive.
 sample.sections=3;sample.receiver=[0,0,3];
 sample.moments=sample.moments.map(r=>[...r.slice(0,4),0,0,0,0,...r.slice(4)]);
 sample.isolatedMoments=sample.moments.map(row=>[...row]);
 sample.moments[4][7]=Math.log(2);sample.moments[5][7]=Math.log(2);
 const history=seedSourceHistory(sample,hit(1,20));
 assert.ok(history);
 const carried=predictSourceHistory(history,hit(2,20,[0,0,2.45]));
 assert.ok(carried.available,carried.reason);
 assert.deepEqual(carried.profiles[5].map(r=>r.tau),[0,Math.log(2),Math.log(4)]);
 assert.equal(carried.profiles[5][0].light[0],0);
 assert.ok(carried.profiles[5].at(-1).light[0]>1);
 assert.ok(Math.abs(carried.profiles[5].at(-1).transmission-.125)<1e-12);
});

test('a chosen depth window excludes strong sources outside the observed interval',()=>{
 const sample=bundle(1,8,4);
 sample.moments[4][4]=100;sample.moments[5][4]=80;
 assert.equal(sourceHistoryTarget(sample).section,1);
 assert.equal(sourceHistoryTarget(sample,{start:0,end:.5}).section,0);
 assert.equal(sourceHistoryTarget(sample,{start:0,end:.1}),null);
});

test('a shared track may replace only its isolated deposited RGB, not unrelated light in the same section',()=>{
 const sample=bundle(1,8,4);
 sample.moments[5][2]=32;
 delete sample.isolatedCarrier;
 assert.equal(seedSourceHistory(sample,hit(1,20)),null);
 sample.isolatedCarrier={slot:2,birth:19};
 const seeded=seedSourceHistory(sample,hit(1,20));assert.ok(seeded);
 const off=predictSourceHistory(seeded,hit(2,0));
 assert.deepEqual(off.profiles[5].at(-1).light,[0,0,8]);
 assert.equal(scoreSourceHistory(seeded,predictSourceHistory(seeded,hit(1,20)),sample),null);
 const opticallyDifferent=bundle(2,8,4,0,Math.log(8));
 const checked=scoreSourceHistory(seeded,off,opticallyDifferent);
 assert.ok(Math.abs(checked.fresh.light[0]-.5)<1e-12);
 assert.equal(checked.freshEmissionHeldExtinction.light[0],1);
 sample.isolatedMoments[5][0]=0;
 assert.equal(seedSourceHistory(sample,hit(1,20)),null);
});
