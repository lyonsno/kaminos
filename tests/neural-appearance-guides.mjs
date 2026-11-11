// kaminos-test: node
import assert from 'node:assert/strict';
import {readNeuralAppearanceGuides,buildNeuralAppearanceGuidesWGSL} from '../neural-appearance-guides.mjs';
import {withKaminosGpu,evalWgslBatch} from '../tools/shader-herder.mjs';
const layer=(i,o)=>({num_inputs:i,num_outputs:o,weights:Array(i*o).fill(0),biases:Array(o).fill(0)});
const aux=[layer(11,16),layer(16,16),layer(16,10)];aux[0].weights[0]=1;aux[0].weights[3]=2;aux[1].weights[0]=1;aux[2].weights[0]=1;aux[2].biases=[.1,.2,.3,.4,.5,.6,.7,0,0,1];
const sampler=[layer(11,16),layer(16,16),layer(16,9)];sampler[2].biases=[0,1,-2,.5,-.5,2,-2,1000,999];
const raw={latents:{num_channels:8},aux:{targets:'ref_diffuse_specular_roughness_normal',hidden_layers:[16,16],hidden_activations:'SmeLU',_params:{network:{mlp_layers:aux}}},sampler:{num_specular_lobes:1,hidden_layers:[16,16],hidden_activations:'LeakyReLU',_params:{network:{mlp_layers:sampler}}}};
const model=readNeuralAppearanceGuides(raw);assert.equal(model.aux.mac,592);assert.equal(model.sampler.mac,576);assert.equal(model.aux.outputs,10);
assert.throws(()=>readNeuralAppearanceGuides({latents:{num_channels:8}}),/trained.*guide/);
const untrained=structuredClone(raw);delete untrained.aux._params;delete untrained.sampler._params;assert.throws(()=>readNeuralAppearanceGuides(untrained),/trained.*guide/);
const unknown=structuredClone(raw);unknown.aux.targets='unknown';assert.throws(()=>readNeuralAppearanceGuides(unknown),/target/);
const missing=structuredClone(raw);missing.aux._params.network.mlp_layers[0].weights.pop();assert.throws(()=>readNeuralAppearanceGuides(missing),/weights/);
const bad=structuredClone(raw);bad.sampler._params.network.mlp_layers[2].biases[0]=NaN;assert.throws(()=>readNeuralAppearanceGuides(bad),/finite/);
const code=buildNeuralAppearanceGuidesWGSL(model),input='array<f32,8>(.25,0.,0.,0.,0.,0.,0.,0.)',wi='vec3<f32>(.36,.48,.8)';
const near=(actual,expected)=>actual.forEach((x,i)=>assert(Math.abs(x-expected[i])<.00003,`${x} differs from ${expected[i]}`));
await withKaminosGpu(async ctx=>{
 const evaluate=body=>evalWgslBatch(ctx,{preamble:code,argTypes:['f32'],returnType:'vec4<f32>',body,inputs:[[0]]});
 near((await evaluate(`let a=neuralAppearanceAuxiliary(${input},${wi});return vec4<f32>(a[0],a[6],a[7],a[9]);`))[0],[.96,.7,0,1]);
 near((await evaluate(`let s=neuralAppearanceSampler(${input},${wi});return vec4<f32>(s.specular[0].alpha,s.specular[0].rho,s.specular[0].weight);`))[0],[.5001,.0001+.5*(1+1/Math.sqrt(2)),-2/Math.sqrt(5),1/(1+Math.exp(-1))]);
 near((await evaluate(`let s=neuralAppearanceSampler(${input},${wi});return vec4<f32>(s.diffuseMu,s.specular[0].mu);`))[0],[2*Math.sqrt(5),-2*Math.sqrt(5),.5*Math.sqrt(1.25),-.5*Math.sqrt(1.25)]);
 // All-negative logits retain the same softmax; no all-zero exponent sum.
 const negative=structuredClone(raw);negative.sampler._params.network.mlp_layers[2].biases.splice(7,2,-999,-1000);
 const negativeResult=await evalWgslBatch(ctx,{preamble:buildNeuralAppearanceGuidesWGSL(readNeuralAppearanceGuides(negative)),argTypes:['f32'],returnType:'vec2<f32>',body:`let s=neuralAppearanceSampler(${input},${wi});return vec2<f32>(s.specular[0].weight,s.diffuseWeight);`,inputs:[[0]]});near(negativeResult[0],[1/(1+Math.exp(-1)),1/(1+Math.exp(1))]);
 for(const count of [0,2]){
  const l=layer(11,3+6*count);l.biases[5*count]=.5;l.biases[5*count+1]=-.5;
  const variant={latents:{num_channels:8},sampler:{num_specular_lobes:count,hidden_layers:[],hidden_activations:[],_params:{network:{mlp_layers:[l]}}}};
  const result=await evalWgslBatch(ctx,{preamble:buildNeuralAppearanceGuidesWGSL(readNeuralAppearanceGuides(variant)),argTypes:['f32'],returnType:'vec3<f32>',body:`let s=neuralAppearanceSampler(${input},${wi});return vec3<f32>(s.diffuseWeight,s.diffuseMu);`,inputs:[[0]]});
  near(result[0],[1/(count+1),.5*Math.sqrt(1.25),-.5*Math.sqrt(1.25)]);
 }
},{wgslSources:[{label:'neural-appearance-guides',code:code+'\n@compute @workgroup_size(1) fn main(){_ = neuralAppearanceAuxiliary(array<f32,8>(),vec3<f32>(0,0,1));}',entryPoint:'main'}]});
console.log('NVIDIA guides: learned normal/albedo/roughness outputs, direction-first inputs, sampler slopes/roughness and stable weights passed');
