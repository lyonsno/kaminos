import assert from 'node:assert/strict';
import test from 'node:test';
import * as cues from '../kiln-cinematic-cues.mjs';
import {createCueTuneEditor} from '../kiln-cue-editor.mjs';
import {normalizeCueTune,tuneForCue} from '../kiln-cue-tunes.mjs';
import {createFlameTunePanel} from '../flame-tune-panel.mjs';
import * as workspace from '../kiln-cue-workspace.mjs';
import {readFileSync} from 'node:fs';
import {createSceneEdits} from '../scene-edit-session.mjs';

const tune=(exposure=-3,id='blue')=>({domControls:{
  'volume-input-radius':{value:.4},'volume-flow-rate':{value:2},
  'volume-physical-exposure':{value:exposure},'hidden-detail':{value:.123456789},
  'volume-resolution':{value:64}},
  rendererControls:{},presentationControls:{},source:{presetId:id,label:id}});
function layered() {
  assert.equal(typeof cues.layerKilnCues,'function','saved basin looks must be independent of emitter animation');
  return cues.layerKilnCues(cues.defaultKilnCues(),tune());
}

test('actual host basin snapshot stays immutable through adoption, audition and scene roundtrip',async()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const start=html.indexOf('function flameSettingsState('),end=html.indexOf('// Every reason the flame settings edit',start);
  const factory=new Function(html.slice(start,end)+';return flameSettingsState;')();
  const preset=tune(-1,'alternate'),receipt={presetId:'alternate',label:'Blue',preset};
  preset.domControls['volume-resolution'].value=160;
  const incoming=factory(preset,receipt),original=structuredClone(preset);
  assert.equal(incoming.domControls,incoming.source.preset.domControls,'replay the observed host alias structure');
  let current=tune(),recipe=layered();
  const editor=createCueTuneEditor({readCues:()=>recipe,writeCues:value=>{recipe=value;},
    readTune:()=>current,applyTune:value=>{current=value;},validateTune:normalizeCueTune,loadTune:async()=>incoming});
  editor.begin('work',1);await editor.useBasin('alternate');
  assert.deepEqual(editor.state().tune.source.preset,original,'retaining scene settings must not rewrite the embedded source');
  editor.audition();assert.deepEqual(editor.state().tune.source.preset,original);
  editor.accept();
  const reopened=JSON.parse(JSON.stringify(recipe));
  assert.deepEqual(reopened.looks[0].tune.source.preset,original);
  assert.equal(reopened.looks[0].tune.domControls['volume-resolution'].value,64);
});

test('basin search and refresh retain the owning pending-load button state',async()=>{
  const source=readFileSync(new URL('../kiln-cue-workspace.mjs',import.meta.url),'utf8');
  let start=source.indexOf('  let basinLoading=');
  if(start<0)start=source.indexOf('  const showBasins=');
  const body=source.slice(start,source.indexOf("  byId('cue-preview')",start));
  const select={value:'alternate',options:[],replaceChildren(){this.options=[];},append(option){this.options.push(option);}};
  const button={disabled:false,textContent:'Use basin'},search={value:''},feedback={textContent:''};
  const elements={'cue-basin-select':select,'cue-basin-apply':button,'cue-basin-search':search,'cue-basin-status':feedback};
  let resolve;const loaded=new Promise(done=>{resolve=done;});
  let current=tune(),recipe=layered();const errors=[];
  const editor=createCueTuneEditor({readCues:()=>recipe,writeCues:value=>{recipe=value;},
    readTune:()=>current,applyTune:value=>{current=value;},validateTune:normalizeCueTune,loadTune:()=>loaded});
  editor.begin('work',1);
  const view=new Function('byId','document','api','basins','cueBasinEntries','guard','ensure','editor','syncPanels','status',
    body+';return {showBasins};')(id=>elements[id],{createElement:()=>({})},{readTune:()=>current},
    {entries:[{presetId:'alternate',label:'Blue'}]},workspace.cueBasinEntries,
    action=>()=>Promise.resolve().then(action).catch(error=>errors.push(error.message)),()=>{},editor,()=>{},()=>{});
  const pending=button.onclick();await Promise.resolve();await Promise.resolve();
  try {
    assert.equal(button.disabled,true);assert.equal(button.textContent,'Loading...');
    search.oninput();assert.equal(button.disabled,true,'search must not release pending load state');
    view.showBasins();assert.equal(button.disabled,true,'list refresh must not release pending load state');
    await button.onclick();assert.deepEqual(errors,[]);
    assert.equal(button.textContent,'Loading...');assert.equal(feedback.textContent,'Loading basin...');
  }finally{resolve(tune(-1,'alternate'));await pending;}
  assert.equal(button.disabled,false);assert.equal(button.textContent,'Use basin');
});

test('opening cues refreshes through context entry exactly once',()=>{
  const source=readFileSync(new URL('../kiln-cue-workspace.mjs',import.meta.url),'utf8');
  const body=source.slice(source.lastIndexOf('  return {open()'),source.lastIndexOf('\n}'));
  let refreshes=0;const render=()=>refreshes++,panel={scrollTop:20};
  const workspace={setMode(){},setContext:()=>render()};
  const api=new Function('workspace','render','panel',body)(workspace,render,panel);
  api.open();assert.equal(refreshes,1,'context entry already refreshes the cue inspector');
  assert.equal(panel.scrollTop,0);
});

test('accept refreshes cues once after commit and history replay waits for settlement',async()=>{
  const source=readFileSync(new URL('../kiln-cue-workspace.mjs',import.meta.url),'utf8');
  const subscription=source.slice(source.indexOf('  window.kaminosSceneEdits.subscribe('),source.indexOf('  void api.listBasins'));
  const command=source.split('\n').find(line=>line.includes("byId('cue-accept').onclick="));
  let value={flow:1},refreshes=0,resolveReplay;
  const edits=createSceneEdits({});
  edits.register('@kiln-cues',{read:()=>value,check:next=>next,write:next=>{
    value=next;
    if(edits.state().undoCount)return new Promise(resolve=>{resolveReplay=resolve;});
  }});
  const render=()=>refreshes++,editor={active:()=>false};
  new Function('window','workspace','editor','render',subscription)(
    {kaminosSceneEdits:edits},{state:()=>({context:'cues'})},editor,render);
  const button={};
  new Function('byId','guard','accept','render','status',command)(()=>button,action=>action,
    ()=>edits.apply('@kiln-cues',{flow:2},'Tune kiln keyframe'),render,()=>{});
  button.onclick();
  assert.equal(refreshes,1,'begin/preview notifications and the command must not repeat the committed refresh');
  assert.equal(edits.state().undoCount,1);assert.equal(value.flow,2);
  const pending=edits.undo();
  assert.equal(refreshes,1,'do not refresh during an unfinished asynchronous history replay');
  resolveReplay();await pending;
  assert.equal(refreshes,2);assert.equal(value.flow,1);assert.equal(edits.state().redoCount,1);
  edits.redo();assert.equal(refreshes,3);assert.equal(value.flow,2);
});

test('alternate basin appearance retains scene simulation and emitter animation with explicit provenance',async()=>{
  let recipe=layered(),current=tune();current.domControls['volume-pressure-solver']={value:'converged'};
  recipe=cues.layerKilnCues(cues.defaultKilnCues(),current);
  const original=structuredClone(current),keys=structuredClone(recipe.work);
  const incoming=tune(-1,'alternate-blue');
  incoming.domControls['volume-resolution'].value=160;
  incoming.domControls['volume-pressure-solver']={value:'jacobi'};
  const untouched=structuredClone(incoming);
  const editor=createCueTuneEditor({readCues:()=>recipe,writeCues:value=>{recipe=value;},
    readTune:()=>current,applyTune:value=>{current=value;},validateTune:normalizeCueTune,loadTune:async()=>incoming});
  editor.begin('work',1);await editor.useBasin('alternate-blue');
  assert.equal(current.domControls['volume-resolution'].value,64);
  assert.equal(current.domControls['volume-pressure-solver'].value,'converged');
  assert.equal(current.domControls['volume-physical-exposure'].value,-1);
  assert.deepEqual(current.source.cueSimulation.retainedFields,['volume-resolution','volume-pressure-solver']);
  assert.deepEqual(incoming,untouched,'immutable library snapshot remains intact');
  editor.accept();assert.deepEqual(recipe.work,keys);assert.deepEqual(current,original);
});

test('audition reapplies the current draft without accepting it or adding history',()=>{
  let recipe=layered(),current=tune(),writes=0,applied=0;
  const editor=createCueTuneEditor({readCues:()=>recipe,writeCues:value=>{writes++;recipe=value;},
    readTune:()=>current,applyTune:value=>{applied++;current=value;},validateTune:normalizeCueTune,loadTune:async()=>tune()});
  editor.begin('work',1);editor.set('volume-physical-exposure',-1);
  const before=structuredClone(current),count=applied;
  assert.equal(typeof editor.audition,'function');
  editor.audition();assert.equal(applied,count+1);assert.deepEqual(current,before);
  assert.equal(writes,0);assert.ok(editor.active());
});

test('one flame-panel refresh reads one tune snapshot for all fields',()=>{
  class Element extends EventTarget {
    constructor(tag,doc){super();this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.style={};this.classList={add(){},remove(){}};this.type='';this.min='';this.max='';this.step='.01';}
    append(...children){this.children.push(...children);}setAttribute(){}
  }
  const doc=new EventTarget();doc.createElement=tag=>new Element(tag,doc);
  const source=doc.createElement('input');source.type='range';doc.getElementById=()=>source;
  const oldDocument=globalThis.document,oldWindow=globalThis.window;globalThis.document=doc;globalThis.window=new EventTarget();
  try{
    let reads=0;const host=doc.createElement('div');
    const panel=createFlameTunePanel({document:doc,host,read:()=>{reads++;return tune();},set(){},onError:error=>{throw error;},
      only:['volume-input-radius','volume-flow-rate']});
    panel.sync();assert.equal(reads,1,'a complete tune must not be rebuilt once per field');
    assert.equal(host.children[0].children[1].children[1].value,.4);
    assert.equal(host.children[0].children[2].children[1].value,2);
  }finally{globalThis.document=oldDocument;globalThis.window=oldWindow;}
});

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
