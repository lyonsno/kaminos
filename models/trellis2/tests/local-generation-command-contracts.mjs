// kaminos-test: node
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {test} from 'node:test';
import {validateLocalGenerationConfig,createGenerationCommandRunner,resolveGenerationFinishing} from '../generate-image.mjs';
const config={schema:'trellis2.local-generation-config.v0',repoRoot:'/source',checkpointBase:'/weights',python:'/python',
  memoryPython:'/memory-python',sourceRoot:'/cleanup',chrome:'/independent-chrome',greenroomBin:'/greenroom',queueDir:'/queue',
  expectedCommit:'a'.repeat(40),expectedSourceCommit:'b'.repeat(40),pipelineType:'512',decoderActivationStorage:'f16',
  steps:8,seed:42,targetFaces:200000,gpuBufferBudgetMiB:6144,processMemoryBudgetMiB:10240};
test('local config has explicit source, storage, budgets and settings without shadowing caller values',()=>{
  assert.equal(validateLocalGenerationConfig(config),config);
  assert.equal(validateLocalGenerationConfig({...config,steps:37,extraMetadata:{note:'additive'}}).steps,37);
  for(const changed of [{steps:0},{repoRoot:'relative'},{expectedCommit:'main'},{decoderActivationStorage:'silent-default'},
    {processMemoryBudgetMiB:undefined},{textureSize:2048},{seed:0x100000000}])
    assert.throws(()=>validateLocalGenerationConfig({...config,...changed}),/required|ignored/);
});
test('owned child receives a stop before report persistence can fail',async()=>{
  const events=[],record={commands:[]};let badWrite=false;
  const child=new EventEmitter();child.pid=12345;
  const runner=createGenerationCommandRunner({cwd:'/source',record,
    spawnCommand:()=>child,stopGroup:pid=>{events.push(['stop',pid]);queueMicrotask(()=>child.emit('close',null,'SIGTERM'));},
    persist:async()=>{if(badWrite){events.push(['write']);throw Error('disk failed');}}});
  const pending=runner.run(['/owned/child'],'synthetic safety boundary');
  await new Promise(resolve=>setImmediate(resolve));badWrite=true;
  await assert.rejects(runner.stop({reason:'process-footprint-budget'}),/disk failed/);
  await assert.rejects(pending,/disk failed/);
  assert.deepEqual(events[0],['stop',12345]);
  await assert.rejects(runner.run(['/next/child'],'next stage'),/halted by memory guard/);
});
test('finishing source is explicit and independent of image preparation',()=>{
  const selected={...config,cleanupMode:'mlx-surface-preserving',finishingSourceRoot:'/accepted-cleanup',
    expectedFinishingSourceCommit:'c'.repeat(40)};
  assert.equal(validateLocalGenerationConfig(selected).sourceRoot,config.sourceRoot);
  assert.equal(validateLocalGenerationConfig(selected).finishingSourceRoot,'/accepted-cleanup');
  assert.deepEqual(resolveGenerationFinishing(selected),{sourceRoot:'/accepted-cleanup',
    expectedSourceCommit:'c'.repeat(40),cleanupMode:'mlx-surface-preserving'});
  assert.deepEqual(resolveGenerationFinishing(config),{sourceRoot:config.sourceRoot,
    expectedSourceCommit:config.expectedSourceCommit,cleanupMode:'reference-cleanup'});
  for(const changed of [{cleanupMode:'silent-fallback'},{finishingSourceRoot:'relative'},
    {expectedFinishingSourceCommit:'main'},{expectedFinishingSourceCommit:undefined},
    {finishingSourceRoot:undefined}])
    assert.throws(()=>validateLocalGenerationConfig({...selected,...changed}),/finishing|cleanup/);
});
test('unsafe state during pre-spawn persistence prevents the next stage from launching',async()=>{
  const record={commands:[]};let launches=0;
  const runner=createGenerationCommandRunner({cwd:'/source',record,spawnCommand:()=>{launches++;},
    persist:async()=>{record.safety={reason:'process-footprint-budget'};}});
  await assert.rejects(runner.run(['/next/child'],'next stage'),/before spawn/);assert.equal(launches,0);
});
