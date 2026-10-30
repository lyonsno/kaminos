// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseSavedSceneFromLibrary} from '../scene-library-client.mjs';
test('Load mounts a cancellable chooser before discovery or document reads finish',async()=>{
 let mounted=false; const reads=[];
 const c={
  grFetchApi:(route)=>{reads.push(route);return new Promise(()=>{});},
  request:()=>new Promise(()=>{}),
  pickSavedScene:()=>{mounted=true;return Promise.resolve(null);},
 };
 const opening=chooseSavedSceneFromLibrary(c);
 assert.equal(mounted,true,'the chooser must open before any discovery request resolves');
 await opening;
 assert.equal(reads.includes('read'),false,'discovery must never fetch scene payloads');
});

test('catalogue discovery never reads payloads; only the selected document is read',async()=>{
 const calls=[]; const selected={name:'chosen.kaminos.json',label:'Chosen',metadata:'complete'};
 const result=await chooseSavedSceneFromLibrary({
  request:async url=>({ok:true,json:async()=> url==='/api/scene-library'?{stores:[]}:{scenes:[selected]}}),
  grFetchApi:async(route,args)=>{calls.push([route,args.path]);return {label:'Chosen',objects:[]};},
  pickSavedScene:async({scenes,local})=>{assert.deepEqual(scenes,[]);const listing=await local.next();assert.deepEqual(listing.value,[selected]);return selected;},
 });
 assert.equal(result.name,selected.name);assert.deepEqual(calls,[['read',selected.name]]);
});
test('cold catalogue publishes names before waiting for metadata; changed metadata replaces the snapshot',async()=>{
 let release;const pending=new Promise(resolve=>release=resolve); const calls=[];
 await chooseSavedSceneFromLibrary({
  request:async url=>{calls.push(url);return {ok:true,json:async()=>url==='/api/scene-library'?{stores:[]}:url.includes('?')?await pending:{scenes:[{name:'old.kaminos.json',metadata:'pending'}]}};},
  grFetchApi:()=>assert.fail('no selection, no payload'),
  pickSavedScene:async({local})=>{const first=await local.next();assert.equal(first.value[0].name,'old.kaminos.json');assert.equal(calls.includes('/api/scene-catalogue?metadata=1'),false);const next=local.next();release({scenes:[{name:'old.kaminos.json',label:'Recovered',metadata:'complete'}]});assert.equal((await next).value[0].label,'Recovered');return null;},
 });
});

test('startup Scenes sidebar lists metadata without fetching all saved documents',async()=>{
 const {readFileSync}=await import('node:fs');const vm=await import('node:vm');
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const source=html.slice(html.indexOf('let sceneBrowseGeneration ='),html.indexOf('async function grBrowseScratch()'));
 const reads=[]; const element={style:{},dataset:{},appendChild(){},append(){},innerHTML:''};
 const c={document:{getElementById:()=>element,createElement:()=>({...element})},sceneDocument:{state:()=>({})},escapeHtml:x=>x,
 grFetchApi:async(route)=>{reads.push(route);return route==='browse'?{entries:[{name:'one.kaminos.json'}]}:route==='scene-catalogue'?{scenes:[{name:'one.kaminos.json',timestamp:'',metadata:'complete'}]}:{label:'One'};}};
 vm.runInNewContext(source,c);await c.grBrowseScenes();
 assert.equal(reads.includes('read'),false,'startup sidebar must not hydrate scene payloads');
});

test('other-store names stay selectable while details are blocked and import keeps store identity',async()=>{
 const calls=[];let imported;
 const result=await chooseSavedSceneFromLibrary({
  grFetchApi:()=>assert.fail('other-store choice is an import, never a local read'),
  request:async(url,options)=>{
   calls.push(url);
   if(url==='/api/scene-library?metadata=1')return new Promise(()=>{});
   if(url==='/api/scene-library')return {ok:true,json:async()=>({stores:[{id:'retained',label:'Retained store',scenes:[{name:'kiln.kaminos.json',metadata:'pending'}]}]})};
   assert.equal(url,'/api/scene-library-import');imported=JSON.parse(options.body);return {ok:true,json:async()=>({saved:'copy.kaminos.json',document:{label:'Kiln'},dependencies:[]})};
  },
  pickSavedScene:async({more})=>{const rows=await more;assert.equal(rows[0].store.id,'retained');return rows[0];},
 });
 assert.deepEqual(imported,{store:'retained',name:'kiln.kaminos.json'});assert.equal(result.name,'copy.kaminos.json');assert.ok(calls.includes('/api/scene-library?metadata=1'));
});
