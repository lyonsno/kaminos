import assert from 'node:assert/strict';
import test from 'node:test';
import * as cues from '../kiln-cinematic-cues.mjs';
import {createCueTuneEditor} from '../kiln-cue-editor.mjs';
import {normalizeCueTune,tuneForCue} from '../kiln-cue-tunes.mjs';
import {createFlameTunePanel} from '../flame-tune-panel.mjs';
import * as workspace from '../kiln-cue-workspace.mjs';
import {readFileSync} from 'node:fs';

const tune=(exposure=-3,id='blue')=>({domControls:{
  'volume-input-radius':{value:.4},'volume-flow-rate':{value:2},
  'volume-physical-exposure':{value:exposure},'hidden-detail':{value:.123456789},
  'volume-resolution':{value:64}},
  rendererControls:{},presentationControls:{},source:{presetId:id,label:id}});
function layered() {
  assert.equal(typeof cues.layerKilnCues,'function','saved basin looks must be independent of emitter animation');
  return cues.layerKilnCues(cues.defaultKilnCues(),tune());
}

test('look replacement preserves emitter curves, complete coefficients and immutable basin identity',()=>{
  const recipe=layered(),before=structuredClone(recipe.work);
  recipe.looks[0].tune=tune(-1,'yellow-version-2');
  const saved=cues.normalizeKilnCues(JSON.parse(JSON.stringify(recipe)));
  assert.deepEqual(saved.work,before);
  const sample=cues.sampleKilnPhase(saved,'work',1);
  assert.equal(sample.tune.source.presetId,'yellow-version-2');
  assert.equal(sample.tune.domControls['volume-physical-exposure'].value,-1);
  assert.equal(sample.tune.domControls['hidden-detail'].value,.123456789);
  assert.equal(sample.tune.domControls['volume-input-radius'].value,sample.radius);
});

test('sampling is time-local, holds looks, and inherits an unkeyed emitter channel',()=>{
  const recipe=layered(),first=recipe.looks[0].id;
  recipe.looks.push({id:'yellow',name:'Yellow',tune:tune(-1,'yellow')});
  recipe.lookCues.work=[{time:0,lookId:first},{time:1,lookId:'yellow'}];
  recipe.work.forEach(key=>{delete key.flow;});
  recipe.looks[1].tune.domControls['volume-flow-rate'].value=3;
  const at=cues.sampleKilnPhase(recipe,'work',2);
  assert.equal(at.flow,3);
  assert.equal(at.tune.source.presetId,'yellow');
  cues.sampleKilnPhase(recipe,'work',3.5);
  assert.deepEqual(cues.sampleKilnPhase(recipe,'work',2),at,'seek must not accumulate earlier modulation');
  assert.equal(cues.sampleKilnPhase(recipe,'work',.5).tune.source.presetId,'blue');
  assert.throws(()=>cues.normalizeKilnCues({...recipe,lookCues:{...recipe.lookCues,work:[{time:0,lookId:'absent'}]}}),/look/i);
});

test('legacy complete-key appearance interpolation survives migration',()=>{
  const recipe=cues.defaultKilnCues();
  recipe.ignition=[{time:0,radius:.1,flow:0,tune:tune(-4)},{time:2,radius:.5,flow:2,tune:tune(-2,'yellow')}];
  const before=cues.sampleKilnKeys(recipe.ignition,1);
  const after=cues.sampleKilnPhase(cues.layerKilnCues(recipe,tune()),'ignition',1);
  assert.deepEqual(after.tune,before.tune);
  assert.equal(after.radius,before.radius);assert.equal(after.flow,before.flow);
});

test('basin adoption and shared look editing do not capture the selected emitter override',async()=>{
  let recipe=layered(),current=tune();const baseline=structuredClone(current);
  const editor=createCueTuneEditor({readCues:()=>recipe,writeCues:value=>{recipe=value;},
    readTune:()=>current,applyTune:value=>{current=value;},validateTune:normalizeCueTune,
    loadTune:async()=>tune(-1,'yellow')});
  const before=structuredClone(recipe.work),id=recipe.looks[0].id;
  editor.begin('work',1);
  await editor.useBasin('yellow');editor.accept();
  assert.deepEqual(recipe.work,before);
  assert.equal(recipe.looks.find(look=>look.id===id).tune.source.presetId,'yellow');
  assert.equal(recipe.looks[0].tune.domControls['volume-input-radius'].value,.4,'look keeps its base radius');
  assert.deepEqual(current,baseline);
  editor.begin('work',1);editor.set('volume-flow-rate',.8);editor.set('volume-physical-exposure',-2);editor.accept();
  assert.equal(recipe.work[1].flow,.8);
  assert.equal(recipe.looks[0].tune.domControls['volume-flow-rate'].value,2);
  assert.equal(cues.sampleKilnPhase(recipe,'ignition',1).tune.domControls['volume-physical-exposure'].value,-2,'shared look changes all its cues');
});

test('make unique forks only the selected look cue and remains cancelable',()=>{
  let recipe=layered(),current=tune();
  const editor=createCueTuneEditor({readCues:()=>recipe,writeCues:value=>{recipe=value;},
    readTune:()=>current,applyTune:value=>{current=value;},validateTune:normalizeCueTune,loadTune:async()=>tune()});
  const before=structuredClone(recipe);
  editor.begin('work',1);editor.makeUnique();editor.set('volume-physical-exposure',-1);editor.cancel();
  assert.deepEqual(recipe,before);
  editor.begin('work',1);editor.makeUnique();editor.set('volume-physical-exposure',-1);editor.accept();
  assert.equal(cues.sampleKilnPhase(recipe,'work',2.5).tune.domControls['volume-physical-exposure'].value,-1);
  assert.equal(cues.sampleKilnPhase(recipe,'ignition',1).tune.domControls['volume-physical-exposure'].value,-3);
  assert.equal(recipe.looks.length,2);
});

test('cue picker consumes the observed shared index including earlier versions without relabeling IDs',()=>{
  const index=JSON.parse(readFileSync(new URL('./fixtures/kiln-layered-library-index.json',import.meta.url)));
  assert.equal(typeof workspace.cueBasinEntries,'function','picker must consume library history, not only current labels');
  const entries=workspace.cueBasinEntries(index,null);
  for(const version of index.earlierVersions)assert.ok(entries.some(item=>item.presetId===version.presetId));
  assert.ok(entries.some(item=>item.label.includes('Earlier:')));
});

test('host materializes legacy looks once rather than recapturing a temporary preview',()=>{
  const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const start=source.indexOf('function readKilnCueRecipe()');
  const code=source.slice(start,source.indexOf('async function loadFlameSettingsBasin',start));
  let live=tune(),authored=cues.defaultKilnCues();
  const read=new Function('kilnCues','kilnPerformanceSnapshot','flameSettingsState','defaultKilnCues','readVolumeControls','layerKilnCues',
    `${code};return readKilnCueRecipe;`)(authored,null,()=>live,cues.defaultKilnCues,()=>({}),cues.layerKilnCues);
  const first=read();live=tune(-1,'temporary-preview');
  assert.deepEqual(read(),first,'preview must not become the saved look baseline');
  first.looks[0].name='caller mutation';
  assert.notEqual(read().looks[0].name,first.looks[0].name,'caller reads do not mutate authored cues');
});

test('migration preserves the previous host baseline hydration on mixed legacy keys',()=>{
  const recipe=cues.defaultKilnCues(),baseline=tune(-2);
  recipe.work[0].tune=tune(-4);
  recipe.ignition[1].tune=tune(-1);
  const migrated=cues.layerKilnCues(recipe,baseline);
  for(const phase of ['ignition','work']) {
    const hydrated=recipe[phase].map(key=>({...key,tune:tuneForCue(key,baseline)}));
    for(const seconds of [0,.6,1.2,1.25,2.5,3,4]) {
      const expected=cues.sampleKilnKeys(hydrated,seconds),actual=cues.sampleKilnPhase(migrated,phase,seconds);
      assert.deepEqual(actual.tune,expected.tune,`${phase} at ${seconds}`);
    }
  }
});

test('all look events have selectable cue rows and combined row edits move or remove both layers',()=>{
  let recipe=layered();const id=recipe.looks[0].id;
  recipe.lookCues.work=[{time:0,lookId:id},{time:1,lookId:id},{time:2.5,lookId:id},{time:4,lookId:id}];
  recipe=cues.normalizeKilnCues(recipe);
  assert.ok(recipe.work.some(key=>key.time===1),'look-only event needs a selectable row');
  const source=readFileSync(new URL('../kiln-cue-workspace.mjs',import.meta.url),'utf8');
  const remove=source.split('\n').find(line=>line.includes("byId('cue-remove').onclick="));
  const move=source.split('\n').find(line=>line.includes("time.addEventListener('change'"));
  const exercise=(line,index,value)=>{
    const time={value,addEventListener:(_,action)=>action()};
    new Function('byId','guard','changeRecipe','phase','index','time','priorTime','failure',line)(
      ()=>({}),action=>action,change=>{time.value=recipe.work[index].time;change(recipe);recipe=cues.normalizeKilnCues(recipe);},
      'work',index,time,0,error=>{throw error;});
  };
  exercise(move,recipe.work.findIndex(key=>key.time===2.5),3);
  assert.ok(recipe.lookCues.work.some(key=>key.time===3));
  assert.ok(!recipe.lookCues.work.some(key=>key.time===2.5));
  exercise(move,recipe.work.length-1,5);
  assert.equal(recipe.lookCues.work.at(-1).time,5,'terminal look travels with the row');
  exercise(move,recipe.work.length-1,4);
  assert.equal(recipe.lookCues.work.at(-1).time,4,'terminal shortening keeps the look in phase');
  // Invoke the installed remove command as well as the native time change listener.
  const target={};
  new Function('byId','guard','changeRecipe','phase','index',remove)(()=>target,action=>action,
    change=>{change(recipe);recipe=cues.normalizeKilnCues(recipe);},'work',recipe.work.length-1);
  target.onclick();
  assert.ok(!recipe.lookCues.work.some(key=>key.time===4));
});

test('make unique inside a legacy blend pins the evaluated look, not an emitter override',()=>{
  const legacy=cues.defaultKilnCues();legacy.work=[{time:0,radius:.2,flow:1,tune:tune(-4)},{time:4,radius:.6,flow:3,tune:tune(-2,'yellow')}];
  let recipe=cues.layerKilnCues(legacy,tune()),current=tune();recipe.work.splice(1,0,{time:2,radius:.5,flow:.8});
  const editor=createCueTuneEditor({readCues:()=>recipe,writeCues:value=>{recipe=value;},readTune:()=>current,
    applyTune:value=>{current=value;},validateTune:normalizeCueTune,loadTune:async()=>tune()});
  editor.begin('work',1);const before=editor.state().tune;
  editor.makeUnique();assert.deepEqual(editor.state().tune,before);editor.accept();
  const fork=recipe.looks.at(-1).tune;
  assert.equal(fork.domControls['volume-input-radius'].value,.4);
  assert.equal(fork.domControls['volume-flow-rate'].value,2);
});

for(const [channel,id,last,edited] of [['flow','volume-flow-rate',3,1],['radius','volume-input-radius',.6,.2]])
test(`cancelled native ${channel} field edit restores sparse channel absence before accepting the draft`,()=>{
  class Element extends EventTarget {
    constructor(tag,doc){super();this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.style={};this.classList={add(){},remove(){}};this.type='';this.min='';this.max='';this.step='.01';this.validity={valid:true};}
    append(...children){this.children.push(...children);}
    setAttribute(){}
  }
  const doc=new EventTarget();doc.createElement=tag=>new Element(tag,doc);
  const source=doc.createElement('input');source.type='range';source.min='0';source.max='3';doc.getElementById=()=>source;
  const oldDocument=globalThis.document,oldWindow=globalThis.window;
  globalThis.document=doc;globalThis.window=new EventTarget();
  try {
    let recipe=layered(),current=tune();recipe.work=[{time:0},{time:2},{time:4,[channel]:last}];
    const editor=createCueTuneEditor({readCues:()=>recipe,writeCues:value=>{recipe=value;},readTune:()=>current,
      applyTune:value=>{current=value;},validateTune:normalizeCueTune,loadTune:async()=>tune()});
    editor.begin('work',1);const before=cues.sampleKilnPhase(recipe,'work',3);
    const host=doc.createElement('div');
    const panel=createFlameTunePanel({document:doc,host,read:()=>editor.state().tune,set:(id,value)=>editor.set(id,value),
      capture:id=>editor.captureField(id),cancel:(id,value,snapshot)=>editor.restoreField(snapshot),
      only:[id],onError:error=>{throw error;}});
    panel.sync();const input=host.children[0].children[1].children[1];
    input.dispatchEvent(new Event('focus'));input.value=String(edited);input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('pointercancel'));editor.accept();
    assert.ok(!Object.hasOwn(recipe.work[1],channel),'cancellation must restore absence, not just the displayed value');
    assert.deepEqual(cues.sampleKilnPhase(recipe,'work',3),before);
  } finally {globalThis.document=oldDocument;globalThis.window=oldWindow;}
});
