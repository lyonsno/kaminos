// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {installOwnerExperimentEntry} from '../owner-experiment-entry.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(){
 const nodes=new Map();const node=key=>{if(!nodes.has(key))nodes.set(key,{value:'',textContent:'',listeners:{},addEventListener(k,f){this.listeners[k]=f;},replaceChildren(){}});return nodes.get(key);};
 const section={querySelector:node};return {nodes,document:{createElement:()=>section},root:{append(){}}};
}
const moduleUrl='data:text/javascript,'+encodeURIComponent("export default {id:'slow',title:'Slow',create:args=>globalThis.__refreshCreate(args)}");
const row={id:'slow',title:'Slow',moduleUrl};
for(const pending of ['activation','operation'])test('catalogue refresh completes while '+pending+' is still pending',async()=>{
 const f=fixture(),oldOption=globalThis.Option,hold=deferred(),entered=deferred();globalThis.Option=class{};
 let discoveries=0,starts=0,disposals=0,entry,operation;
 globalThis.__refreshCreate=async()=>{starts++;if(pending==='activation'){entered.resolve();await hold.promise;}return {read:()=>({starts}),operations:{wait:async()=>{entered.resolve();await hold.promise;}},dispose(){disposals++;}};};
 try{
  entry=await installOwnerExperimentEntry({...f,host:{},discover:async()=>{discoveries++;return [row];}});
  operation=entry.open('slow');if(pending==='operation'){await operation;operation=entry.invoke('wait');}await entered.promise;
  let refreshed=false;const refreshing=entry.refresh().then(()=>{refreshed=true;});
  // Drain immediately runnable tasks; the feature remains held by construction.
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(discoveries,2,'Refresh did not even request the catalogue while feature work was pending');
  assert.equal(refreshed,true,'Metadata refresh waited for a feature operation');
  assert.equal(starts,1);assert.equal(disposals,0);hold.resolve();await operation;await refreshing;
 }finally{hold.resolve();await operation;await entry?.close();globalThis.Option=oldOption;delete globalThis.__refreshCreate;}
});

test('newer refresh wins and stale completion cannot overwrite catalogue or button state',async()=>{
 const f=fixture(),oldOption=globalThis.Option;globalThis.Option=class{};let discover=async()=>[row],entry;
 try{
  entry=await installOwnerExperimentEntry({...f,host:{},discover:()=>discover()});
  const old=deferred(),newer=deferred();discover=()=>old.promise;const first=entry.refresh();discover=()=>newer.promise;const second=entry.refresh();
  assert.equal(f.nodes.get('button').disabled,true);old.resolve([{id:'old',title:'Old',moduleUrl:'/old.mjs'}]);await first;
  assert.equal(f.nodes.get('button').disabled,true,'Stale completion claimed the active refresh had finished');assert.equal(entry.list()[0].id,'slow');
  newer.resolve([{id:'new',title:'New',moduleUrl:'/new.mjs'}]);await second;assert.equal(entry.list()[0].id,'new');assert.equal(f.nodes.get('button').disabled,false);
  const late=deferred();discover=()=>late.promise;const stale=entry.refresh();discover=async()=>[row];await entry.refresh();late.resolve([{id:'stale',title:'Stale',moduleUrl:'/stale.mjs'}]);await stale;assert.equal(entry.list()[0].id,'slow');
 }finally{await entry?.close();globalThis.Option=oldOption;}
});
test('failed refresh keeps the current catalogue and instance usable and recovers on retry',async()=>{
 const f=fixture(),oldOption=globalThis.Option;globalThis.Option=class{};let fail=false,entry;globalThis.__refreshCreate=()=>({read:()=>({ok:true}),operations:{}});
 try{
  entry=await installOwnerExperimentEntry({...f,host:{},discover:async()=>{if(fail)throw Error('Discovery HTTP 503');return [row];}});await entry.open('slow');fail=true;await assert.rejects(entry.refresh(),/503/);
  assert.equal(entry.list()[0].id,'slow');assert.deepEqual(await entry.read(),{ok:true});assert.equal(entry.state().moduleUrl,moduleUrl);assert.equal(f.nodes.get('button').disabled,false);assert.match(f.nodes.get('.owner-experiment-diagnostics').textContent,/503/);
  fail=false;await entry.refresh();assert.equal(f.nodes.get('.owner-experiment-diagnostics').textContent,'');assert.deepEqual(await entry.read(),{ok:true});
 }finally{await entry?.close();globalThis.Option=oldOption;delete globalThis.__refreshCreate;}
});
