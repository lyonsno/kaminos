// kaminos-test: node
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {installOwnerExperimentEntry} from '../owner-experiment-entry.mjs';
// Observed contribution format; controlled host refuses an authored-water conflict.
function fixture(){
 const nodes=new Map();const node=key=>{if(!nodes.has(key))nodes.set(key,{value:'',textContent:'',listeners:{},addEventListener(k,f){this.listeners[k]=f;},replaceChildren(){}});return nodes.get(key);};
 const section={querySelector:node};return {nodes,document:{createElement:()=>section},root:{append(){}}};
}
for(const where of ['onOpen','factory'])test('failed '+where+' leaves chooser, address and actual entry empty',async()=>{
 const f=fixture(),changes=[],oldOption=globalThis.Option;globalThis.Option=class{constructor(text,value){this.text=text;this.value=value;}};
 try{
  const definition='data:text/javascript,'+encodeURIComponent(`export default {id:'refused',title:'Refused',create(){${where==='factory'?"throw Error('Close authored water');":"return {read(){return{};}};"}}}`);
  const entry=await installOwnerExperimentEntry({...f,host:{},discover:async()=>[{id:'refused',title:'Refused',moduleUrl:definition}],onOpen(){if(where==='onOpen')throw Error('Close authored water');},onChange:value=>changes.push(value)});
  const select=f.nodes.get('select');select.value='refused';await assert.rejects(entry.open('refused'),/Close authored water/);
  assert.equal(entry.state().id,null);assert.equal(select.value,'','A refused requested entry must not remain checkmarked');assert.equal(changes.at(-1)?.id,null,'Address must agree with absence of an effective entry');
 }finally{globalThis.Option=oldOption;}
});

test('refresh preserves running source, selected import failure is visible, and queue recovers',async()=>{
 const f=fixture(),oldOption=globalThis.Option,events=[];globalThis.Option=class{constructor(text,value){this.text=text;this.value=value;}};
 globalThis.__activationEvents=events;
 const moduleUrl='data:text/javascript,'+encodeURIComponent("export default {id:'good',title:'Good',create(){globalThis.__activationEvents.push('create');return {read:()=>({ok:true}),operations:{},dispose(){globalThis.__activationEvents.push('dispose');}}}};");
 const good={id:'good',title:'Good',moduleUrl},bad={id:'bad',title:'Bad',moduleUrl:'data:text/javascript,throw%20Error(%22broken%20neighbor%22)'};
 let catalogue=[good,bad],entry;
 try{
  entry=await installOwnerExperimentEntry({...f,host:{},discover:async()=>catalogue});
  assert.deepEqual(events,[]);await entry.open('good');
  catalogue=[bad,{moduleUrl:'/unregistered.mjs',error:'metadata missing'}];await entry.refresh();
  assert.equal(entry.state().moduleUrl,moduleUrl);assert.deepEqual(await entry.read(),{ok:true});assert.match(f.nodes.get('.owner-experiment-diagnostics').textContent,/metadata missing/);
  await assert.rejects(entry.open('bad'),/broken neighbor/);assert.equal(entry.state().id,null);assert.match(f.nodes.get('[role=status]').textContent,/broken neighbor/);assert.deepEqual(events,['create','dispose']);
  catalogue=[good];await entry.refresh();await entry.open('good');await entry.close();assert.deepEqual(events,['create','dispose','create','dispose']);
 }finally{await entry?.close();globalThis.Option=oldOption;delete globalThis.__activationEvents;}
});

test('close queued during lazy activation disposes the mounted instance before next open',async()=>{
 const f=fixture(),oldOption=globalThis.Option,events=[];globalThis.Option=class{};
 let release,started;globalThis.__activationWait=new Promise(resolve=>{release=resolve;});globalThis.__activationStarted=()=>started();globalThis.__activationEvents=events;
 const loading=new Promise(resolve=>{started=resolve;});
 const moduleUrl='data:text/javascript,'+encodeURIComponent("globalThis.__activationStarted();await globalThis.__activationWait;export default {id:'slow',title:'Slow',create(){globalThis.__activationEvents.push('create');return {read:()=>({ok:true}),operations:{},mount(){globalThis.__activationEvents.push('mount');},dispose(){globalThis.__activationEvents.push('dispose');}}}};");
 let entry;try{
  entry=await installOwnerExperimentEntry({...f,host:{},discover:async()=>[{id:'slow',title:'Slow',moduleUrl}]});const opening=entry.open('slow');await loading;
  const closing=entry.close();assert.deepEqual(events,[]);release();await opening;await closing;
  assert.deepEqual(events,['create','mount','dispose']);assert.equal(entry.state().id,null);
  await entry.open('slow');assert.deepEqual(events,['create','mount','dispose','create','mount']);
 }finally{release();await entry?.close();globalThis.Option=oldOption;delete globalThis.__activationWait;delete globalThis.__activationStarted;delete globalThis.__activationEvents;}
});
