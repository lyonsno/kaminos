// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createInferenceFlame,evaluateInferenceFlame} from '../inference-flame.mjs';
const field='volume-physical-thermal',wind='volume-wind-angle';
const settings=(value,angle=30)=>({domControls:{[field]:{type:'range',value},[wind]:{type:'range',value:angle}},rendererControls:{},presentationControls:{}});
const recipe={a:{label:'A',settings:settings(2)},b:{label:'B',settings:settings(10)},fields:[field],duration:2};
const recording={schema:'kaminos.inference-recording.v1',runId:'observed-shape-fixture',source:{kind:'fixture'},status:'complete',durationMs:1000,events:[{type:'stage',stage:'decode',atMs:0},{type:'complete',atMs:1000}]};
function fixture(){let current=settings(2),callback,writes=0;const response=createInferenceFlame({flame:{read:()=>({active:true}),settings:()=>structuredClone(current),beginPreview:()=>({active:()=>true,update:s=>{writes++;current=s;},commit(){},cancel(){}})},source:{},onFrame:f=>{callback=f;return()=>{};}});return {response,get:()=>current.domControls[field].value,writes:()=>writes,tick:dt=>callback({deltaSeconds:dt})};}
test('Finished executes the entire authored ramp, including its tail after inference',()=>{
 const f=fixture();f.response.operations.load(recording);f.response.operations.assign({stage:'complete',recipe});
 assert.equal(f.response.read().playbackDurationMs,3000);
 f.response.operations.seek(2000);assert.equal(f.get(),6);
 f.response.operations.seek(3000);assert.equal(f.get(),10);f.response.dispose();
});
test('saved objects compose disjoint fields, ordered overrides, pulse returns to underlying state',()=>{
 const f=fixture(),o=f.response.operations;o.load(recording);
 o.saveObject({id:'base',kind:'state',label:'Warm',recipe});o.saveObject({id:'pulse',kind:'pulse',label:'Flare',recipe:{...recipe,b:{label:'Peak',settings:settings(20)}}});
 o.addLayer({stage:'decode',objectId:'base'});o.addLayer({stage:'decode',objectId:'pulse',timing:'phase'});
 o.seek(500);assert.equal(f.get(),20);o.seek(1000);assert.equal(f.get(),10);
 const saved=o.export();o.restore(saved);assert.deepEqual(o.export(),saved);
 assert.throws(()=>o.deleteObject('base'),/used|assigned|layer/i);
 const ids=f.response.read().score.stacks.decode.map(l=>l.id);o.moveLayer({stage:'decode',id:ids[1],direction:-1});o.seek(500);assert.equal(f.get(),10);
 o.updateLayer({stage:'decode',id:ids[0],enabled:false});o.seek(500);assert.equal(f.get(),20);f.response.dispose();
});
test('phase fit reaches B at phase boundary and seconds scale extends Finished',()=>{
 const f=fixture(),o=f.response.operations;o.load(recording);o.saveObject({id:'r',kind:'ramp',recipe});o.addLayer({stage:'decode',objectId:'r',timing:'phase'});o.addLayer({stage:'complete',objectId:'r',timing:'seconds',scale:2});
 o.seek(500);assert.equal(f.get(),6);o.seek(3000);assert.equal(f.get(),6);assert.equal(f.response.read().playbackDurationMs,5000);
 o.timeScale(2);assert.equal(f.response.read().playbackDurationMs,9000);f.response.dispose();
});
test('unchanging replay does not repeatedly write settings and lightweight reads omit saved objects',()=>{
 const f=fixture();f.response.operations.load(recording);f.response.operations.play();const before=f.writes();f.tick(.1);f.tick(.1);assert.equal(f.writes(),before);
 assert.equal(f.response.read({includeScore:false}).score,undefined);f.response.dispose();
});
test('invalid layer and object edits preserve the accepted arrangement',()=>{
 const f=fixture(),o=f.response.operations;o.load(recording);o.saveObject({id:'r',kind:'ramp',recipe});o.addLayer({stage:'decode',objectId:'r'});const before=o.export();
 assert.throws(()=>o.updateLayer({stage:'decode',id:before.score.stacks.decode[0].id,scale:0}));assert.deepEqual(o.export(),before);
 assert.throws(()=>o.updateObject({id:'r',recipe:{...recipe,duration:NaN}}));assert.deepEqual(o.export(),before);f.response.dispose();
});

test('stack arrangements use a distinct schema so older readers cannot silently omit their effects',()=>{
 const f=fixture();assert.equal(f.response.operations.export().schema,'kaminos.inference-flame.v2');f.response.dispose();
});
test('disjoint state layers combine their parameter sets',()=>{
 const f=fixture(),o=f.response.operations;o.load(recording);o.saveObject({id:'heat',kind:'state',recipe});o.saveObject({id:'wind',kind:'state',recipe:{...recipe,fields:[wind],b:{label:'Wind',settings:settings(99,70)}}});o.addLayer({stage:'decode',objectId:'heat'});o.addLayer({stage:'decode',objectId:'wind'});o.seek(500);assert.equal(f.get(),10);assert.equal(evaluateInferenceFlame(recording,500,o.export().score,settings(2)).settings.domControls[wind].value,70);f.response.dispose();
});

test('direct progress easing continues through unassigned successor phases',()=>{
 const r={...recording,durationMs:2000,events:[{type:'stage',stage:'denoise',atMs:0},{type:'progress',stage:'denoise',completed:1,total:1,atMs:1000},{type:'stage',stage:'decode',atMs:1050},{type:'complete',atMs:2000}]};
 const score={stages:{denoise:recipe},transitionMs:400,flare:null};
 assert.equal(evaluateInferenceFlame(r,1200,score,settings(2)).settings.domControls[field].value,6);
 assert.equal(evaluateInferenceFlame(r,1400,score,settings(2)).settings.domControls[field].value,10);
});

test('unused library objects do not make their parameters replay-owned',()=>{
 const score={stages:{},objects:[{id:'unused',label:'Unused',kind:'state',recipe}],stacks:{}};
 const result=evaluateInferenceFlame(recording,500,score,settings(7));
 assert.deepEqual(result.settings,settings(7));
});
test('saved look portraits stay lightweight during replay and portable across export and restore',async()=>{
 const {retainFlamePortrait,releaseFlamePortrait}=await import('../flame-portrait.mjs');
 const raw={schema:'kaminos.flame-portrait.v1',image:'data:image/png;base64,AAAA',width:1,height:1};
 const portrait=retainFlamePortrait(raw),f=fixture(),o=f.response.operations;
 o.saveObject({id:'pictured',kind:'ramp',recipe:{...recipe,a:{...recipe.a,portrait},b:{...recipe.b,portrait}}});
 releaseFlamePortrait(portrait);
 const live=f.response.read().score.objects[0].recipe.a.portrait;
 assert.equal(Object.hasOwn(live,'image'),false);assert.equal((await fetch(live.imageUrl)).status,200);
 const exported=o.export();assert.equal(exported.score.objects[0].recipe.a.portrait.image,raw.image);
 o.restore(exported);assert.equal(Object.hasOwn(f.response.read().score.objects[0].recipe.a.portrait,'image'),false);
 assert.equal(o.export().score.objects[0].recipe.a.portrait.image,raw.image);f.response.dispose();
});
