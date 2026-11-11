// kaminos-test: node
import assert from 'node:assert/strict';
import {readNeuralAppearanceDecoder, buildNeuralAppearanceWGSL} from '../neural-appearance.mjs';
import {withKaminosGpu, evalWgslBatch} from '../tools/shader-herder.mjs';

// The observed author checkpoint schema is model/mlp.py::save_checkpoint_params
// at NVlabs/neuralappearance@305b4b9c12e679398c487603dd8245c3f348526c.
// These deterministic weights test decoding conventions, not trained quality.
function layer(input,output,bias=0) {
  return {num_inputs:input,num_outputs:output,weights:Array(input*output).fill(0),biases:Array(output).fill(bias)};
}
function fixture() {
  const frame=layer(8,12), a=layer(24,2), b=layer(2,3);
  // Frame 0 has n = normalize(1,0,1), t = (1,0,0). It is deliberately
  // nonorthogonal, exactly as allowed by the author's learned frame model.
  frame.weights[0]=1;
  // wh.x and wi.z projected into frame 0, and latent 0.
  a.weights[0]=1; a.weights[12]=.25; a.weights[16]=.5;
  a.weights[24+6]=1; // wd.x projected into frame 0.
  b.weights[0]=1; b.weights[3]=1; b.biases[2]=-2;
  return {latents:{num_channels:8},decoder:{hidden_layers:[2],hidden_activations:'SmeLU',output_activation:{type:'ScaledSigmoid',scale:1e5},half_diff_parameterization:'StableRusinkiewicz',num_shading_frames:2,direction_inputs:'WhWdZiZo',_params:{rotation:{rotation_decoder:{mlp_layers:[frame]}},network:{mlp_layers:[a,b]}}}};
}
const raw=fixture(), model=readNeuralAppearanceDecoder(raw);
assert.equal(model.mac.shared,96);assert.equal(model.mac.directional,54);
assert.equal(model.layers.length,2);
const bad=structuredClone(raw);bad.decoder._params.network.mlp_layers[0].weights.pop();
assert.throws(()=>readNeuralAppearanceDecoder(bad),/weights.*48/);
const nonfinite=structuredClone(raw);nonfinite.decoder._params.network.mlp_layers[1].biases[0]=NaN;
assert.throws(()=>readNeuralAppearanceDecoder(nonfinite),/finite/);
const unsupported=structuredClone(raw);unsupported.decoder.half_diff_parameterization='unknown';
assert.throws(()=>readNeuralAppearanceDecoder(unsupported),/parameterization/);

// Hand-calculated author convention for wi=wo=Z, latent0=1:
// original wh=wd=Z, projected wh.x=wd.x=0; projected wi.z=1/sqrt(2).
// Hidden SmeLU(.5+.25/sqrt(2)) is linear; SmeLU(0)=.12375.
const hidden=.5+.25/Math.sqrt(2);
const sigmoid=x=>1e5/(1+1e5*Math.exp(-x));
const expected=[sigmoid(hidden),sigmoid(.12375),sigmoid(-2)];
const preamble=buildNeuralAppearanceWGSL(model);
const body=`return neuralAppearanceEvaluate(array<f32,8>(1.,0.,0.,0.,0.,0.,0.,0.),vec3<f32>(0.,0.,arg0),vec3<f32>(0.,0.,arg1));`;
function near(actual,reference) {for(let j=0;j<3;j++)assert.ok(Math.abs(actual[j]-reference[j])<=3e-5+Math.abs(reference[j])*3e-5,`decoder mismatch ${j}: ${actual[j]} versus ${reference[j]}`);}
await withKaminosGpu(async ctx=>{
 const options={preamble,argTypes:['f32','f32'],returnType:'vec3<f32>',body,inputs:[[1,1],[-1,1],[1,-1],[0,1]]};
 const out=await evalWgslBatch(ctx,options);
 near(out[0],expected);for(const row of out.slice(1))near(row,[0,0,0]);
 // A valid, transposed angular layout must be rejected by the same oracle.
 const fault=structuredClone(raw);const w=fault.decoder._params.network.mlp_layers[0].weights;w[0]=0;w[2]=1;
 const wrong=await evalWgslBatch(ctx,{...options,preamble:buildNeuralAppearanceWGSL(readNeuralAppearanceDecoder(fault))});
 assert.throws(()=>near(wrong[0],expected),/decoder mismatch/);
},{wgslSources:[{label:'neural-appearance-decoder',code:`${preamble}\n@compute @workgroup_size(1) fn main() { _ = neuralAppearanceEvaluate(array<f32,8>(1.,0.,0.,0.,0.,0.,0.,0.),vec3<f32>(0.,0.,1.),vec3<f32>(0.,0.,1.)); }`,entryPoint:'main'}]});
console.log('NVIDIA decoder: checkpoint shapes, learned nonorthogonal frames, feature order, activations and hemisphere rejection passed');

// Exercise released default dimensions with independently calculated angular inputs.
const variants=[];
for(const parameterization of ['StableRusinkiewicz','Rusinkiewicz'])for(const layout of ['WiWo','WhWd','WhWdZiZo','WhWdWiWo']) {
 const v=fixture();v.decoder.half_diff_parameterization=parameterization;v.decoder.direction_inputs=layout;
 const width=8+({WiWo:6,WhWd:6,WhWdZiZo:8,WhWdWiWo:12}[layout])*2;
 v.decoder.hidden_layers=[16,16];v.decoder.hidden_activations=['SmeLU','LeakyReLU'];v.decoder.output_activation={type:'Exp'};
 const a=layer(width,16),b=layer(16,16),c=layer(16,3);
 a.weights[layout==='WiWo'?0:6]=1;b.weights[0]=1;c.weights[0]=1;c.biases[1]=-2;c.biases[2]=2;
 v.decoder._params.network.mlp_layers=[a,b,c];
 variants.push({model:readNeuralAppearanceDecoder(v),layout,parameterization});
}
await withKaminosGpu(async ctx=>{
 for(const {model,layout,parameterization} of variants) {
  // wi=(.36,.48,.8), wo=Z: wi azimuth has cos(phi)=.6.
  // Shortest-arc wd keeps that azimuth; classical wd rotates it to zero.
  const differenceX=.6/Math.hypot(.6,1.8);
  const x=layout==='WiWo'?.36:differenceX*(parameterization==='StableRusinkiewicz'?.6:1);
  const smelu=t=>t<-.5?.01*t:t>.5?t:.495*t*t+.505*t+.12375;
  const result=await evalWgslBatch(ctx,{preamble:buildNeuralAppearanceWGSL(model),argTypes:['f32'],returnType:'vec3<f32>',body:'return neuralAppearanceEvaluate(array<f32,8>(1.,0.,0.,0.,0.,0.,0.,0.),vec3<f32>(.36,.48,.8),vec3<f32>(0.,0.,1.));',inputs:[[0]]});
  near(result[0],[Math.exp(smelu(x)),Math.exp(-2),Math.exp(2)]);
  if(layout==='WhWdZiZo')assert.equal(model.mac.shared+model.mac.directional,784);
 }
},{wgslSources:variants.map(({model,layout,parameterization})=>({
 label:`neural-appearance-${layout}-${parameterization}`,
 code:`${buildNeuralAppearanceWGSL(model)}\n@compute @workgroup_size(1) fn main() { _ = neuralAppearanceEvaluate(array<f32,8>(1.,0.,0.,0.,0.,0.,0.,0.),vec3<f32>(.36,.48,.8),vec3<f32>(0.,0.,1.)); }`,
 entryPoint:'main',
}))});
console.log('Released 8-latent / 2-frame / 16x16 shape, both parameterizations and all four feature layouts passed');
