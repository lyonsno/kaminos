import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {validateGenerationInputs,loadGenerationInputs} from '../generation-inputs.js';
import {generationModelCallCounts,generationPhases} from '../sparse-generation-witness-checks.js';
const path=process.argv[2];assert.ok(path,'explicit complete observed base package required');
const original=JSON.parse(await fs.readFile(path,'utf8'));
const preview=structuredClone(original);preview.pipelineType='512';preview.meshResolution=512;preview.samplingSteps=8;
delete preview.models.highResolutionShape;
for(const role of ['sparseFlow','lowResolutionShape','textureFlow'])preview.models[role].config.steps=8;
for(const role of ['shapeDecoder','textureDecoder'])preview.models[role].config.resolution=32;
assert.doesNotThrow(()=>validateGenerationInputs(preview),'source512 no-cascade preview must be admitted without the HR model or cascade execution');
const requested=[];
const loaded=await loadGenerationInputs(preview,async name=>{requested.push(name);return new Float32Array(1);});
assert.equal(loaded.pipelineType,'512');assert.equal(loaded.meshResolution,512);
assert.equal(loaded.modelInputs.highResolutionShape,undefined);
assert.ok(requested.every(name=>!name.startsWith('highResolutionShape.')));
assert.equal(generationModelCallCounts(preview)['high-resolution-shape-sampling'],undefined);
assert.ok(generationPhases(preview).every(phase=>!['learned-cascade-support','high-resolution-shape-sampling'].includes(phase)));
for(const change of [m=>m.meshResolution=1024,m=>m.models.lowResolutionShape.config.steps=6,
  m=>m.pipelineType='unknown',m=>m.samplingSteps=0,m=>m.models.shapeDecoder.config.resolution=64,
  m=>m.models.textureDecoder.config.resolution=64]){
  const bad=structuredClone(preview);change(bad);assert.throws(()=>validateGenerationInputs(bad));
}
assert.doesNotThrow(()=>validateGenerationInputs(original),'the existing full12step1024cascade package stays compatible');
console.log('Explicit512/8step preview admits only its active checkpoint roles; mismatched settings reject and the old full package remains compatible.');
