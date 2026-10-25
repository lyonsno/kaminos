// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createInvestigationRecording} from '../investigation-recording.mjs';

const unavailable = () => {throw Error('Owner module entry is unavailable on the baseline');};
const {loadExperimentContributions = unavailable, openExperiment = unavailable} =
  await import('../workbench-experiments.mjs').catch(error => {
    if(error.code === 'ERR_MODULE_NOT_FOUND' && error.url?.endsWith('/workbench-experiments.mjs'))return {};
    throw error;
  });

test('discovery reads metadata without creating a simulation; follow-up needs no central list', async () => {
  let starts=0;
  const modules=new Map([['/paper.experiment.mjs',{default:{id:'paper',title:'Finite water',create(){starts++;}}}]]);
  const loadModule=async url=>modules.get(url);
  assert.equal((await loadExperimentContributions([...modules].map(([moduleUrl,{default:{id,title}}])=>({id,title,moduleUrl})),{loadModule}))[0].id,'paper');
  assert.equal(starts,0);
  modules.set('/hand.experiment.mjs',{default:{id:'hand',title:'Hand comparison',create(){starts++;}}});
  const second=await loadExperimentContributions([...modules].map(([moduleUrl,{default:{id,title}}])=>({id,title,moduleUrl})),{loadModule});
  assert.deepEqual(second.map(row=>row.id),['paper','hand']);
  assert.equal(starts,0);
});

test('UI and agent invoke the same owner operations and explicit shared recording', async () => {
  const recording=createInvestigationRecording({id:'entry',source:{kind:'fixture'},initial:{beta:0},startingConditions:{kind:'fixture'}});
  let beta=0,reads=0,disposals=0;
  const host={name:'supplied-host'};
  const definition={id:'paper',title:'Finite water',create({host:provided,inputs,record}){
    assert.equal(provided,host);assert.equal(inputs.dt,1/240);
    const operations={setBeta(value){beta=value;const result={effective:{beta},requested:value};
      record({kind:'paper.beta',phase:'applied',target:'water',...result});return result;}};
    return {read(){reads++;return {beta,dt:inputs.dt};},operations,
      mount({invoke}){return {onInput:invoke.bind(null,'setBeta')};},dispose(){disposals++;}};
  }};
  const instance=await openExperiment(definition,{host,inputs:{dt:1/240}});
  const controls=await instance.mount({});
  assert.equal((await controls.onInput(.2)).effective.beta,.2);
  assert.equal((await instance.invoke('setBeta',.3)).effective.beta,.3);
  assert.equal(reads,0,'commands must not implicitly read dense state');
  assert.deepEqual(await instance.read(),{beta:.3,dt:1/240});
  assert.equal(recording.finish().operations.length,2);
  await assert.rejects(instance.invoke('toString'),/Unknown operation/);
  await instance.dispose();await instance.dispose();assert.equal(disposals,1);
  await assert.rejects(instance.invoke('setBeta',.4),/disposed/);
});

test('hand operations preserve unavailable intervals, source timing and custom output', async () => {
  const samples=[{captureOffsetMs:10,available:true},{captureOffsetMs:20,available:false,reason:'missing'}];
  let cursor=0;
  const instance=await openExperiment({id:'hand',title:'Recorded hand',create(){return {
    read:()=>samples[cursor],operations:{seek(index){cursor=index;return samples[index];}},
  };}},{host:{}});
  assert.deepEqual(await instance.invoke('seek',1),samples[1]);
  assert.deepEqual(await instance.read(),samples[1]);
  assert.equal(await instance.mount({}),null);
});

test('duplicate identity, import errors and invalid factories fail with source context', async () => {
  const definition={id:'same',title:'Same',create(){}};
  const duplicates=await loadExperimentContributions(['/one','/two'].map(moduleUrl=>({id:'same',title:'Same',moduleUrl})));
  await assert.rejects(openExperiment(duplicates[0]),/Duplicate.*same.*one.*two/);
  const [broken]=await loadExperimentContributions([{id:'broken',title:'Broken',moduleUrl:'/broken'}],{loadModule:async()=>{throw Error('syntax');}});
  await assert.rejects(openExperiment(broken),/broken.*syntax/);
  await assert.rejects(openExperiment({id:'missing',title:'Missing',create:()=>({operations:{}})},{host:{}}),/read/);
  await assert.rejects(openExperiment({id:'bad',title:'Bad',create:()=>({read(){},operations:{start:3}})},{host:{}}),/start/);
});

async function mountedMaterial() {
  const {default:definition}=await import('../experiments/material-study.experiment.mjs');
  const {installRelativeNumberDrag}=await import('../scene-control-history.mjs');
  class Element extends EventTarget {
    constructor(tag){super();this.tagName=tag;this.children=[];this.style={};this.classList={add(){},remove(){}};this.captures=0;this.ownerDocument=doc;}
    append(...children){for(const child of children){child.parentNode=this;this.children.push(child);}}
    setAttribute(){}
    setPointerCapture(){this.captures++;}
    hasPointerCapture(){return false;}
    focus(){doc.activeElement=this;this.fire('focus');}
    blur(){doc.activeElement=null;this.fire('blur');}
    select(){}
    fire(type,init={}){const e=new Event(type,{cancelable:true,bubbles:true});for(const [k,v] of Object.entries(init))Object.defineProperty(e,k,{value:v});this.dispatchEvent(e);return e;}
    dispatchEvent(e){super.dispatchEvent(e);if(e.bubbles)this.parentNode?.dispatchEvent(e);return !e.defaultPrevented;}
  }
  const doc=new EventTarget();doc.createElement=tag=>new Element(tag);doc.defaultView=new EventTarget();
  globalThis.document=doc;globalThis.window=doc.defaultView;
  const records=[];const session={attach:async()=>({id:'material'}),readView:()=>({}),redraw(){},dispose(){}};
  const owner=await definition.create({host:{scene:{open:async()=>session},controls:{installNumberDrag:installRelativeNumberDrag}},inputs:{},record:r=>records.push(r)});
  const panel=new Element('div');owner.mount({root:panel,document:doc,invoke:async(op,value)=>owner.operations[op](value)});
  const flatten=el=>[el,...el.children.flatMap(flatten)];
  const input=flatten(panel).find(el=>el.tagName==='input');
  const grip=flatten(panel).find(el=>el!==input&&el.style.cursor==='ew-resize');
  return {owner,panel,input,grip,records,close(){delete globalThis.document;delete globalThis.window;}};
}

test('material numeric editing preserves caret clicks while its separate grip scrubs',async()=>{
  const f=await mountedMaterial();try {
    f.input.focus();f.input.readOnly=false;
    const event=f.input.fire('pointerdown',{button:0,pointerId:1,clientX:10,clientY:0});
    assert.equal(event.defaultPrevented,false,'focused editing must keep native caret and selection');
    f.grip.fire('pointerdown',{button:0,pointerId:2,clientX:10,clientY:0});
    f.grip.fire('pointermove',{pointerId:2,clientX:40,clientY:0});
    f.grip.fire('pointerup');
    assert.ok(f.owner.read().roughness>.6,'deliberate grip drag must update roughness');
  } finally {f.close();}
});

test('material numeric drafts do not apply empty zero or erase a decimal during typing',async()=>{
  const f=await mountedMaterial();try {
    f.input.focus();f.input.readOnly=false;
    f.input.value='';f.input.fire('input');await Promise.resolve();
    assert.equal(f.owner.read().roughness,.6,'empty draft must not apply zero');assert.equal(f.records.length,0);
    f.input.value='0.';f.input.fire('input');await Promise.resolve();
    assert.equal(f.input.value,'0.','typing must preserve an unfinished decimal');
    f.input.value='0.35';f.input.fire('input');await Promise.resolve();assert.equal(f.owner.read().roughness,.35);
    f.input.value='';f.input.fire('input');f.input.blur();assert.equal(f.input.value,'0.35','blur restores the accepted value');
    f.input.focus();f.input.value='0';f.input.fire('input');await Promise.resolve();assert.equal(f.owner.read().roughness,0,'explicit zero remains valid');
  } finally {f.close();}
});
