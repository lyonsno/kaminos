// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {resolveFlameLightingRoute} from '../scene-authoring.mjs';
const m=await import('../scene-radiance-resource-mount.mjs').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};});
const api=()=>{assert.equal(typeof m.mountSceneRadianceResources,'function','default hybrid radiance must mount from worker-local resources and source state');return m.mountSceneRadianceResources;};
function fixture(params){
 const calls=[],lighting={kind:'actual module mount result'},device={},renderer={},scene={},prototype={},surfaceLighting={},rebuild={hold(){},prepare(){}};
 let records=[{id:'first'}],controls={density:1};
 const options={params,device,renderer,scene,prototype,surfaceLighting,rebuild,shadowSettings:{shadowResolution:12,pointCount:4},
  readSourceRecords:()=>records,readControls:()=>controls,getSourceGuide:()=>({position:[1,2,3],radius:.1}),onStatus:()=>{},
  loadModule:async route=>{calls.push(['module',route]);return {
   mountDistributedSceneRadiance:input=>{calls.push(['distributed',input]);return lighting;},
   mountSceneRadiance:input=>{calls.push(['point',input]);return lighting;},
   authoredSourceRegions:(rows,input)=>{calls.push(['regions',rows,input]);return rows;},
  };}};
 return {options,calls,lighting,setSource(nextRows,nextControls){records=nextRows;controls=nextControls;}};
}
test('normalized default fire route mounts the actual hybrid surface/smoke provider',async()=>{
 const f=fixture(resolveFlameLightingRoute('volume_light_field=1')),r=await api()(f.options);
 assert.equal(r,f.lighting);assert.equal(f.calls[0][1],'hybrid');const input=f.calls[1][1];
 for(const key of ['device','renderer','scene','prototype','surfaceLighting','rebuild','getSourceGuide','onStatus'])assert.equal(input[key],f.options[key],key);
 assert.equal(input.shadowResolution,12);assert.equal(input.smokeRefinement,1);
 const rows=[{id:'replacement'}],controls={density:2};f.setSource(rows,controls);
 assert.equal(input.getSourceRegions('transform','domain'),rows);
 assert.deepEqual(f.calls.at(-1),['regions',rows,{transform:'transform',domain:'domain',controls}]);
});
test('explicit distributed and point comparisons retain their selected providers',async()=>{
 const d=fixture(new URLSearchParams('volume_light_field=1&volume_light_field_distributed=1&volume_light_field_hybrid=0'));
 await api()(d.options);assert.equal(d.calls[0][1],'distributed');assert.equal(d.calls[1][0],'distributed');assert.equal(Object.hasOwn(d.calls[1][1],'surfaceLighting'),false);
 const p=fixture(new URLSearchParams('volume_light_field=1&volume_light_field_distributed=0'));
 await api()(p.options);assert.equal(p.calls[0][1],'point');assert.deepEqual(p.calls[1],['point',{renderer:p.options.renderer,scene:p.options.scene,prototype:p.options.prototype}]);
});
test('an unrequested or unavailable selected lighting route cannot silently choose another mount',async()=>{
 const f=fixture(new URLSearchParams('volume_light_field=0'));
 await assert.rejects(()=>api()(f.options),/ordinary fire light-field route/);assert.deepEqual(f.calls,[]);
 const h=fixture(resolveFlameLightingRoute('volume_light_field=1'));h.options.loadModule=async()=>({mountSceneRadiance:()=>assert.fail('wrong provider')});
 await assert.rejects(()=>api()(h.options));
});
test('live resources are read after asynchronous module loading, preserving current scene ownership',async()=>{
 const f=fixture(resolveFlameLightingRoute('volume_light_field=1'));let finish;
 const loaded=new Promise(resolve=>{finish=resolve;});let current=f.options.surfaceLighting,reads=0;
 f.options.readResources=()=>{reads++;return {...f.options,surfaceLighting:current};};
 const moduleLoad=f.options.loadModule;f.options.loadModule=async route=>{await loaded;return moduleLoad(route);};
 const result=api()(f.options);assert.equal(reads,0);current={replacement:true};finish();await result;
 assert.equal(reads,1);assert.equal(f.calls[1][1].surfaceLighting,current);
});
