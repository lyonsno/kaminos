// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const page=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function fixture(search='',hash=''){
 const location={search,hash};
 const ctx=vm.createContext({URLSearchParams,window:{location},location,mountedFlameState:{route:{volume_light_field:'1'}},activeSceneComposition:null,resolveFlameLightingRoute:p=>p,sceneLoadRequests:{},sceneRecords:{},createSceneDocumentSession:options=>options});
 for(const [begin,end] of [['function fireLightFieldRouteParams(', '\nfunction isAuthoredKilnCollisionRoute('],['function isCompositionAuthoring()', '\nfunction compositionStatus('],['function createPageSceneDocumentSession(', '\nconst sceneDocument =']]){
  const start=page.indexOf(begin),stop=page.indexOf(end,start);assert.ok(start>=0&&stop>start);vm.runInContext(page.slice(start,stop),ctx);
 }
 return ctx;
}
test('temporary workshop fire leaves ordinary document reload in the same page',()=>{
 const f=fixture('?workspace=workbench&authoring=1');
 assert.equal(f.isFireLightFieldRoute(),true,'rendering consumes the borrowed flame route');
 assert.equal(f.isCompositionAuthoring(),false,'temporary runtime cannot reclassify the document');
 assert.equal(f.createPageSceneDocumentSession().requiresNavigation({composition:null},{mounted:false}),false);
});
for(const [search,hash]of [['?volume_light_field=1',''],['','#volume_light_field=1'],['','#authoring=1']])test('authored composition still requires its restore route: '+search+hash,()=>{
 const f=fixture(search,hash);f.mountedFlameState=null;
 assert.equal(f.isCompositionAuthoring(),true);
 assert.equal(f.createPageSceneDocumentSession().requiresNavigation({composition:null},{mounted:false}),true);
 assert.equal(f.createPageSceneDocumentSession().requiresNavigation({composition:null},{mounted:true}),false);
});
test('authored recovery and preview snapshots exclude the temporary flame route',()=>{
 const f=fixture('?workspace=workbench&authoring=1');
 f.fireShadowSceneRoute=()=>({});f.window.__kaminosSceneRadiance={debugState:()=>({})};
 for(const marker of ['recoverySimulation??=','capturePreview:()=>']){
  const start=page.indexOf(marker),at=page.indexOf('flameRoute:',start),end=page.indexOf('])',at)+2;
  assert.ok(start>0&&at>start&&end>at);
  const route=vm.runInContext(page.slice(at+'flameRoute:'.length,end),f);
  assert.equal(route.volume_light_field,undefined,marker+' must retain authored route identity');
 }
});

// Execute the Workbench host's actual add callback. Reading before the async
// withdrawal must still preserve the ordinary authored lighting choices.
test('Workbench Add Flame does not inherit the temporary workshop recipe',async()=>{
 const f=fixture('?workspace=workbench&volume_light_field_grid=64&volume_collision=off','#volume_light_field_shadows=0');
 f.mountedFlameState.route={volume_light_field:'1',volume_light_field_grid:'16',volume_light_field_shadows:'1',volume_collision:'kiln'};
 let received;
 f.window.kaminosSceneAuthoring={addFlameEmitter:async(id,options)=>{received={id,options};return 'authored-source';}};
 const begin=page.indexOf('fire:{add:')+'fire:{add:'.length,end=page.indexOf(',\n    setEnabled:',begin);
 assert.ok(begin>0&&end>begin);
 const add=vm.runInContext('('+page.slice(begin,end)+')',f);
 assert.equal(await add('saved-basin'),'authored-source');
 assert.equal(received.id,'saved-basin');
 assert.deepEqual({...received.options.lightingRoute},{volume_light_field_grid:'64',volume_light_field_shadows:'0',volume_collision:'off'});
});
test('saved composition route excludes a borrowed workshop and retains authored lighting',()=>{
 const f=fixture('?volume_light_field_grid=64','#volume_light_field_shadows=0');
 f.mountedFlameState.route={volume_light_field:'1',volume_light_field_grid:'16',volume_light_field_shadows:'1'};
 const begin=page.indexOf('async function collectSceneComposition()'),start=page.indexOf('  const route = {};',begin),end=page.indexOf('  Object.assign(route,',start);
 assert.ok(begin>0&&start>begin&&end>start);
 const route=vm.runInContext('(()=>{'+page.slice(start,end)+'return route;})()',f);
 assert.deepEqual({...route},{volume_light_field_grid:'64',volume_light_field_shadows:'0'});
});
