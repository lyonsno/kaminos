// kaminos-test: node — the queued TRELLIS route in Generate reads its streamed result and mesh URL
import test from 'node:test';import assert from 'node:assert/strict';
import {readPipelineRunStream,pipelineRunOutputArtifacts,pipelineArtifactIsLoadableMesh,pipelineRunReadUrlForPath} from '../authoring-pipeline-result.mjs';

test('the streamed run reports progress and returns its final result',async()=>{
  const lines=[{schema:'kaminos.pipeline-progress.v0',phase:'queued',jobId:'j'},{schema:'kaminos.pipeline-run-result.v0',ok:true,runId:'r'}].map(x=>JSON.stringify(x)).join('\n');
  const body=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(lines.slice(0,30)));c.enqueue(new TextEncoder().encode(lines.slice(30)));c.close();}});
  const seen=[];const result=await readPipelineRunStream(new Response(body,{headers:{'Content-Type':'application/x-ndjson'}}),e=>seen.push(e.phase));
  assert.deepEqual(seen,['queued']);assert.equal(result.runId,'r');
  await assert.rejects(readPipelineRunStream(new Response('{"schema":"kaminos.pipeline-progress.v0"}\n',{headers:{'Content-Type':'application/x-ndjson'}})),/without a run result/);
  assert.deepEqual(await readPipelineRunStream(new Response('{"ok":false}',{headers:{'Content-Type':'application/json'}})),{ok:false});
});

test('the mesh artifact is found and read through the pipeline-runs root',()=>{
  const result={bundle:{document:{outputRoot:'/x/runs/run-1',artifacts:{input:{path:'/x/runs/run-1/in.png'},mesh:{path:'/x/runs/run-1/artifacts/trellis-output.glb',role:'textured-mesh'}}}},
    report:{document:{artifacts:[{id:'sidecar',path:'/x/runs/run-1/s.json'}]}}};
  const artifact=pipelineRunOutputArtifacts(result).find(pipelineArtifactIsLoadableMesh);
  assert.equal(artifact.id,'mesh');
  assert.equal(pipelineRunReadUrlForPath(result,artifact.path),'/api/read?root=pipeline-runs&path='+encodeURIComponent('run-1/artifacts/trellis-output.glb'));
  assert.equal(pipelineRunReadUrlForPath(result,'/elsewhere/a.glb'),null);
});
