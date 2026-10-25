// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evaluateInferenceFlame,validateRecording} from '../inference-flame.mjs';
const settings=n=>({domControls:{'volume-physical-thermal':{type:'range',value:n},'volume-wind-angle':{type:'range',value:30}},rendererControls:{},presentationControls:{}});
const recipe={a:{label:'A',settings:settings(2)},b:{label:'B',settings:settings(10)},fields:['volume-physical-thermal'],duration:0.4};
const recording={schema:'kaminos.inference-recording.v1',runId:'fixture',source:{kind:'fixture'},status:'complete',durationMs:4000,events:[{atMs:0,type:'stage',stage:'denoise'},{atMs:1000,type:'progress',stage:'denoise',completed:1,total:2},{atMs:1500,type:'preview',width:1,height:1,rgba:[255,0,0,255]},{atMs:3000,type:'progress',stage:'denoise',completed:2,total:2},{atMs:4000,type:'complete'}]};
const score={stages:{denoise:recipe},transitionMs:200,flare:{settings:settings(20),fields:recipe.fields,attackMs:100,settleMs:300}};
const heat=s=>s.settings.domControls['volume-physical-thermal'].value;
test('recorded progress drives a stage ramp and reveal flare returns to moving underlying values',()=>{
 assert.equal(heat(evaluateInferenceFlame(recording,1200,score,settings(1))),6);
 assert.equal(heat(evaluateInferenceFlame(recording,1600,score,settings(1))),20);
 assert.equal(heat(evaluateInferenceFlame(recording,2000,score,settings(1))),6);
 assert.equal(heat(evaluateInferenceFlame(recording,3300,score,settings(1))),10);
 assert.equal(evaluateInferenceFlame(recording,1600,score,settings(1)).settings.domControls['volume-wind-angle'].value,30);
});
test('seeking reconstructs coefficients deterministically without pretending unknown progress is measured',()=>{
 assert.deepEqual(evaluateInferenceFlame(recording,1600,score,settings(1)),evaluateInferenceFlame(recording,1600,score,settings(1)));
 assert.equal(evaluateInferenceFlame(recording,200,score,settings(1)).progress,null);
 const other={...recording,events:[...recording.events,{atMs:4000,type:'stage',stage:'unmapped'}]};
 assert.equal(heat(evaluateInferenceFlame(other,4000,score,settings(1))),10);
});
test('malformed recordings are rejected rather than replaced with demo or partial output',()=>{
 for(const changes of [{schema:'wrong'},{events:[]},{events:[{atMs:NaN,type:'stage'}]},{events:[{atMs:2,type:'stage'},{atMs:1,type:'stage'}]}])assert.throws(()=>validateRecording({...recording,...changes}));
 assert.equal(validateRecording(recording).events.length,recording.events.length);
});

import {createInferenceFlame} from '../inference-flame.mjs';
import {createInferenceEvents} from '../inference-events.mjs';
import {createSceneEdits} from '../scene-edit-session.mjs';
import {createFlameAuthoring} from '../flame-authoring.mjs';
function fixture(){
 let live=settings(2),frame;const edits=createSceneEdits({read:()=>null,write(){}});
 const author=createFlameAuthoring({edits,read:()=>structuredClone(live),check:x=>x,write:x=>{live=structuredClone(x);}});
 const source=createInferenceEvents();const flame={settings:author.read,read:()=>({active:true}),beginPreview:author.beginPreview};
 const response=createInferenceFlame({flame,source,onFrame:fn=>{frame=fn;return()=>{frame=()=>{};};}});
 return {response,source,edits,author,tick:seconds=>frame({deltaSeconds:seconds})};
}
test('replay seeking uses one preview and cancel restores authored look; disposal stops future writes',()=>{
 const f=fixture();f.response.operations.load(recording);f.response.operations.assign({stage:'denoise',recipe});
 f.response.operations.seek(1200);assert.equal(f.response.read().previewing,true);assert.equal(f.edits.state().undoCount,0);
 f.response.operations.seek(3300);f.response.operations.cancel();assert.equal(f.author.read().domControls['volume-physical-thermal'].value,2);
 f.response.operations.play();f.tick(2);f.response.dispose();const before=f.author.read();f.tick(20);assert.deepEqual(f.author.read(),before);
});
test('only live following requests preview compute, terminal and cancellation release it',()=>{
 const f=fixture();assert.equal(f.source.hasPreviewObservers(),false);
 f.response.operations.follow();assert.equal(f.source.hasPreviewObservers(),true);
 const run=f.source.begin({kind:'fixture'});run.emit({type:'stage',stage:'denoise'});run.finish('complete');
 assert.equal(f.source.hasPreviewObservers(),false);assert.equal(f.response.read().live,false);
 f.response.operations.follow();f.response.operations.pause();assert.equal(f.source.hasPreviewObservers(),false);f.response.dispose();
});
test('unknown totals remain unknown and imported recipes do not mutate the current flame',()=>{
 const unknown={...recording,events:[{type:'progress',stage:'weights',completed:5,total:null,atMs:0}]};validateRecording(unknown);
 assert.equal(evaluateInferenceFlame(unknown,100,score,settings(1)).progress,null);
 const f=fixture();f.response.operations.load(recording);f.response.operations.assign({stage:'denoise',recipe});const saved=f.response.operations.export(),before=f.author.read();
 f.response.operations.restore(saved);assert.deepEqual(f.author.read(),before);const migrated=f.response.operations.export();assert.deepEqual(migrated.recording,saved.recording);assert.deepEqual(migrated.score.objects[0].recipe,saved.score.stages.denoise);f.response.operations.restore(migrated);assert.deepEqual(f.response.operations.export(),migrated);f.response.dispose();
});
test('following waits at zero and lets the finished look settle after the terminal event',()=>{
 const f=fixture();f.response.operations.assign({stage:'complete',recipe:{...recipe,a:recipe.b}});f.response.operations.follow();f.tick(5);
 assert.equal(f.response.read().position,0);
 const run=f.source.begin({kind:'fixture'});run.finish('complete');
 assert.equal(f.response.read().live,false);assert.equal(f.response.read().playing,true);
 f.tick(1);assert.equal(f.response.read().playing,false);
 assert.equal(f.author.read().domControls['volume-physical-thermal'].value,10);
 f.response.dispose();
});
test('live events are retained incrementally without recopied history on every byte update',()=>{
 let clock=0,reads=0;const source=createInferenceEvents({now:()=>clock});const original=source.read;source.read=(...args)=>{reads++;return original(...args);};
 const f=fixture();let settingsNow=settings(2);const response=createInferenceFlame({source,flame:{read:()=>({active:true}),settings:()=>settingsNow,beginPreview:()=>({active:()=>true,update:x=>{settingsNow=x;},commit(){},cancel(){}})},onFrame:()=>()=>{}});
 response.operations.follow();const run=source.begin({kind:'fixture'});
 for(let i=1;i<=20;i++){clock=i;run.emit({type:'progress',stage:'weights',completed:i,total:20});}
 run.finish('complete');assert.equal(reads,1);assert.deepEqual(response.operations.export().recording,source.read(run.runId));response.dispose();f.response.dispose();
});
test('pause and resume preserve the evaluation baseline and current held settings',()=>{
 const f=fixture();f.response.operations.load({...recording,events:[{atMs:0,type:'stage',stage:'denoise'},{atMs:1000,type:'complete'}],durationMs:1000});
 f.response.operations.assign({stage:'denoise',recipe:{...recipe,a:{label:'Hot A',settings:settings(10)},b:{label:'Hot B',settings:settings(20)}}});
 f.response.operations.seek(200);assert.equal(f.author.read().domControls['volume-physical-thermal'].value,6);
 for(let i=0;i<3;i++){f.response.operations.pause();f.response.operations.play();assert.equal(f.response.read().position,200);assert.equal(f.author.read().domControls['volume-physical-thermal'].value,6);}
 f.response.operations.pause();const held=f.author.read();held.domControls['volume-wind-angle'].value=75;f.author.apply(held);
 f.response.operations.play();assert.equal(f.author.read().domControls['volume-wind-angle'].value,75);assert.equal(f.author.read().domControls['volume-physical-thermal'].value,6);
 f.tick(.1);f.response.operations.cancel();assert.equal(f.author.read().domControls['volume-physical-thermal'].value,6);f.response.dispose();
});
test('unassigned replay pauses, resumes and restarts without changing the flame',()=>{
 const f=fixture(),before=f.author.read();f.response.operations.load(recording);
 f.response.operations.play();f.tick(.2);f.response.operations.pause();f.response.operations.play();
 assert.deepEqual(f.author.read(),before);f.tick(10);assert.equal(f.response.read().playing,false);
 f.response.operations.play();assert.equal(f.response.read().position,0);assert.deepEqual(f.author.read(),before);f.response.dispose();
});
