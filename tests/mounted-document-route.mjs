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
