// kaminos-test: node
import assert from 'node:assert/strict';
import {loadGenerationCheckpoints,validateGenerationCheckpoints} from '../models/trellis2/generation-inputs.js';
import {m} from '../models/trellis2/tests/generation-input-fixture.js';
for(const path of [undefined,'/ckpts/slat_flow_imgshape2tex_dit_1_3B_512_bf16.safetensors']){
  const bad=structuredClone(m);bad.models.textureFlow.identity.path=path;
  let fetches=0;
  assert.doesNotThrow(()=>validateGenerationCheckpoints(bad),'historical evidence remains inspectable');
  await assert.rejects(loadGenerationCheckpoints(bad,async()=>{fetches++;}),/texture checkpoint.*1024/);
  assert.equal(fetches,0,'reject before loading encoder or model');
}
for(const size of [512,1024]){
  const good=structuredClone(m);good.models.textureFlow.identity.path=`/ckpts/slat_flow_imgshape2tex_dit_1_3B_${size}_bf16.safetensors`;
  if(size===512){good.pipelineType='512';good.meshResolution=512;delete good.models.highResolutionShape;
    for(const role of ['shapeDecoder','textureDecoder'])good.models[role].config.resolution=32;}
  let calls=0;await loadGenerationCheckpoints(good,async()=>{calls++;return {};});assert.ok(calls>0);
  if(size===512){good.models.textureFlow.identity.path='/ckpts/slat_flow_imgshape2tex_dit_1_3B_1024_bf16.safetensors';
    await assert.rejects(loadGenerationCheckpoints(good,async()=>{throw Error('must not fetch');}),/texture checkpoint.*512/);}
}
console.log('pipeline-matched texture execution admission passes');
