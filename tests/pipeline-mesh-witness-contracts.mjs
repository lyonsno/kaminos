import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
const source=fs.readFileSync(new URL('../pipeline-ui-witness.mjs',import.meta.url),'utf8');
test('mesh output must take the Load Output witness branch, not Open Artifact',()=>{
  const start=source.indexOf('const expectedArtifactRole ='),end=source.indexOf('const expectsFixture =',start);
  const context={args:new Map([['artifact-role','textured-mesh']]),pipelineId:'trellis-image-to-mesh-webgpu-v0'};
  vm.createContext(context);vm.runInContext(source.slice(start,end)+'\nglobalThis.observedLoadable=expectsLoadableArtifact;',context);
  assert.equal(context.observedLoadable,true,'the actual UI witness still treats a generated GLB as a non-loadable report');
});
test('mesh source witness matches the actual run-root URL mapping, not an absolute filesystem URL',()=>{
  const index=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  function fn(text,name) {const start=text.indexOf('function '+name+'('),end=text.indexOf('\n}',start)+2;return text.slice(start,end);}
  const c={encodeURIComponent};vm.createContext(c);
  vm.runInContext(fn(source,'meshWitnessSource')+'\n'+fn(index,'pipelineRunReadUrlForPath'),c);
  const root='/caller-owned/pipeline-runs/run one',artifact=root+'/artifacts/trellis-output.glb';
  assert.equal(c.meshWitnessSource(root,artifact),c.pipelineRunReadUrlForPath({bundle:{document:{outputRoot:root}}},artifact));
  assert.equal(c.meshWitnessSource(root,'/unrelated/cached.glb'),null);
});
test('a completed failed GUI run terminates the unbounded observer instead of waiting for success',async()=>{
  const start=source.indexOf('async function waitFor(cdp,'),end=source.indexOf('\n}',start)+2;
  let queries=0;
  const c={Date:{now:()=>0},evalJson:async()=>{if(++queries>1)throw Error('observer retried a terminal failure');
      return {terminalFailure:true,error:'Greenroom rejected command'};},wait:async()=>{throw Error('observer waited after terminal failure');}};
  vm.createContext(c);vm.runInContext(source.slice(start,end),c);
  await assert.rejects(c.waitFor({},'unused','GUI run',Infinity),/Greenroom rejected command/);
  assert.equal(queries,1);
});
function observePhase(change=()=>{}){
  // Observed phase-only event from the actual TRELLIS GUI attempt, Oct13.
  const observed=JSON.parse(fs.readFileSync(new URL('./fixtures/trellis-phase-progress-observed.json',import.meta.url)));
  const start=source.indexOf('const nativeProgressObserved = await waitFor(cdp, `')+'const nativeProgressObserved = await waitFor(cdp, `'.length;
  const end=source.indexOf("`, 'Native adapter progress reached route node'",start);
  assert.ok(start>0&&end>start);
  const record={id:'current-output',runTimeline:[observed.timelineProgress],progressEvent:observed.lastNativeProgress};
  const context={pendingGeneratedOutput:{pendingRecord:{id:record.id}},routeNode:{routeNodeId:'current-route'},
    mockSharpProgressEnv:'unused',expectsMeshArtifact:true,pipelineId:'trellis-image-to-mesh-webgpu-v0',JSON,
    window:{kaminosPipelineDockDebugState:()=>({generatedOutputNodes:[record]}),kaminosPipelineLastNativeProgress:observed.lastNativeProgress},
    document:{querySelector:()=>({dataset:{pipelineRouteProgress:'',pipelineRouteLivePhase:'image-preparation',pipelineRouteLiveStatus:'running'},innerText:observed.routeText})}};
  vm.createContext(context);
  change(context,record);
  const expression=vm.runInContext('`'+source.slice(start,end)+'`',context);
  return vm.runInContext(expression,context);
}
test('the actual TRELLIS progress predicate accepts observed phase events without fabricating a percentage',()=>{
  const result=observePhase();
  assert.equal(result.ok,true,'identified real phase progress is incorrectly conditional on a numeric percentage');
  assert.equal(result.routeProgress,'');assert.equal(result.phaseProgress,true);
});
test('stale, missing or different native phase identity cannot supply current progress',()=>{
  for(const change of [c=>{c.window.kaminosPipelineLastNativeProgress=null;},
    (_c,r)=>{r.progressEvent={...r.progressEvent,jobId:'another-job'};},
    c=>{c.window.kaminosPipelineLastNativeProgress={...c.window.kaminosPipelineLastNativeProgress,adapterRouteId:'another-route'};},
    c=>{c.document.querySelector=()=>({dataset:{pipelineRouteProgress:'99',pipelineRouteLivePhase:'wrong-phase'}});}])
    assert.equal(observePhase(change).ok,false);
});
test('TRELLIS has no implicit observer deadline while a caller-selected deadline is retained',()=>{
  const start=source.indexOf('const graphExecuteTimeoutMs ='),end=source.indexOf('\nconst mockSharpProgressEnv',start);
  for(const [requested,expected] of [[null,Infinity],['123456',123456]]){
    const c={args:new Map(requested?[['graph-execute-timeout-ms',requested]]:[]),pipelineId:'trellis-image-to-mesh-webgpu-v0',Number};
    vm.createContext(c);vm.runInContext(source.slice(start,end)+'\nglobalThis.observed=graphExecuteTimeoutMs;',c);
    assert.equal(c.observed,expected);
  }
});
