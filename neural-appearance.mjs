// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES.
// SPDX-License-Identifier: Apache-2.0
// Portable adaptation of NVlabs/neuralappearance@305b4b9. See docs/neural-appearance.md.

const directionWidths={WiWo:6,WhWd:6,WhWdZiZo:8,WhWdWiWo:12};
const activations=new Set(['SmeLU','LeakyReLU','ReLU','Tanh','ELU','Identity']);
function integer(n,label,{zero=false}={}) {
  if(!Number.isSafeInteger(n)||n<(zero?0:1))throw Error(`${label} must be a ${zero?'nonnegative':'positive'} integer`);
  return n;
}
function floats(values,count,label) {
  if(!Array.isArray(values)||values.length!==count)throw Error(`${label} must contain ${count} values`);
  if(values.some(x=>typeof x!=='number'||!Number.isFinite(x)||!Number.isFinite(Math.fround(x))))throw Error(`${label} must contain finite float32 values`);
  return values.map(Math.fround);
}
function layers(records,widths,label) {
  if(!Array.isArray(records)||records.length!==widths.length-1)throw Error(`${label} must contain ${widths.length-1} layers`);
  return records.map((v,i)=>{
    const input=widths[i],output=widths[i+1];
    if(v.num_inputs!==input||v.num_outputs!==output)throw Error(`${label} layer ${i} must have shape ${output} by ${input}`);
    return {input,output,weights:floats(v.weights,input*output,`${label} layer ${i} weights`),biases:floats(v.biases,output,`${label} layer ${i} biases`)};
  });
}

/** Read the author's model.json decoder parameters. Textures remain separate;
 * no missing architecture or weights are silently filled with default values. */
export function readNeuralAppearanceDecoder(source) {
  if(typeof source==='string')source=JSON.parse(source);
  const d=source?.decoder, numLatents=integer(source?.latents?.num_channels,'latent channel count');
  if(!d||typeof d!=='object')throw Error('decoder metadata is required');
  if(!['StableRusinkiewicz','Rusinkiewicz'].includes(d.half_diff_parameterization))throw Error('unsupported half/difference parameterization');
  if(!Object.hasOwn(directionWidths,d.direction_inputs))throw Error('unsupported decoder direction inputs');
  const numFrames=integer(d.num_shading_frames,'shading frame count',{zero:true});
  if(!Array.isArray(d.hidden_layers))throw Error('decoder hidden_layers must be an array');
  const hidden=d.hidden_layers.map((x,i)=>integer(x,`hidden layer ${i} width`));
  const acts=typeof d.hidden_activations==='string'?hidden.map(()=>d.hidden_activations):d.hidden_activations;
  if(!Array.isArray(acts)||acts.length!==hidden.length||acts.some(x=>!activations.has(x)))throw Error('unsupported decoder hidden activations');
  const output=d.output_activation;
  if(!output||!['Exp','ScaledSigmoid'].includes(output.type))throw Error('unsupported decoder output activation');
  const scale=output.type==='ScaledSigmoid'?output.scale??1:1;
  if(!Number.isFinite(scale)||scale<=0||!Number.isFinite(Math.fround(scale)))throw Error('decoder output scale must be a positive finite float32');
  const widths=[numLatents+directionWidths[d.direction_inputs]*Math.max(1,numFrames),...hidden,3];
  const network=layers(d._params?.network?.mlp_layers,widths,'decoder network');
  const frame=numFrames?layers(d._params?.rotation?.rotation_decoder?.mlp_layers,[numLatents,numFrames*6],'rotation network')[0]:null;
  if(frame?.biases.some(x=>x!==0))throw Error('author rotation network has no biases');
  return {
    numLatents,numFrames,parameterization:d.half_diff_parameterization,directionInputs:d.direction_inputs,
    activations:[...acts],outputActivation:output.type,outputScale:Math.fround(scale),layers:network,frame,
    mac:{shared:numLatents*numFrames*6,directional:network.reduce((n,l)=>n+l.input*l.output,0)},
  };
}

function number(n) {return `${Math.fround(n).toExponential(9)}`;}
function networkWGSL(name,ls,acts) {
  const declarations=[],code=[`var x0 = input;`];
  ls.forEach((l,k)=>{
    declarations.push(`const ${name}W${k} = array<f32,${l.weights.length}>(${l.weights.map(number).join(',')});`, `const ${name}B${k} = array<f32,${l.biases.length}>(${l.biases.map(number).join(',')});`);
    const act=acts[k];
    const expr=!act||act==='Identity'?'value':act==='SmeLU'?'neuralAppearanceSmeLU(value)':act==='LeakyReLU'?'max(value,0.01*value)':act==='ReLU'?'max(value,0.0)':act==='Tanh'?'tanh(value)':`select(exp(value)-1.0,value,value>=0.0)`;
    code.push(`var x${k+1}: array<f32,${l.output}>;
    for(var j=0u;j<${l.output}u;j++) {
      var value=${name}B${k}[j];
      for(var i=0u;i<${l.input}u;i++) { value += ${name}W${k}[j*${l.input}u+i]*x${k}[i]; }
      x${k+1}[j]=${expr};
    }`);
  });
  return `${declarations.join('\n')}
  fn ${name}(input:array<f32,${ls[0].input}>) -> array<f32,${ls.at(-1).output}> {
    ${code.join('\n')} return x${ls.length};
  }`;
}

/** Production WGSL for directional decoding. Prepared frames can be shared
 * across lighting queries at one spatial latent lookup. No CoopVec required. */
export function buildNeuralAppearanceWGSL(model) {
  const n=model.numLatents, f=Math.max(1,model.numFrames), input=model.layers[0].input;
  const projection=model.numFrames?`
    let values=neuralAppearanceFrames(latents);
    for(var i=0u;i<${f}u;i++) {
      let ni=3u*i; let ti=3u*(i+${f}u);
      let normal=normalize(vec3<f32>(values[ni],values[ni+1u],values[ni+2u])+vec3<f32>(0.,0.,1.));
      let tangent=normalize(vec3<f32>(values[ti],values[ti+1u],values[ti+2u])+vec3<f32>(1.,0.,0.));
      p.frames[i]=NeuralAppearanceFrame(tangent,cross(normal,tangent),normal);
    }`:`p.frames[0]=NeuralAppearanceFrame(vec3<f32>(1.,0.,0.),vec3<f32>(0.,1.,0.),vec3<f32>(0.,0.,1.));`;
  const fields=model.directionInputs==='WiWo'?['wi','wo']:model.directionInputs==='WhWdWiWo'?['wh','wd','wi','wo']:['wh','wd'];
  const flatten=fields.map(field=>`for(var i=0u;i<${f}u;i++) { let v=neuralAppearanceProject(p.frames[i],${field}); x[k]=v.x;x[k+1u]=v.y;x[k+2u]=v.z;k+=3u; }`).join('\n');
  const z=model.directionInputs==='WhWdZiZo'?`for(var i=0u;i<${f}u;i++) { x[k]=dot(wi,p.frames[i].n);k++; }
    for(var i=0u;i<${f}u;i++) { x[k]=dot(wo,p.frames[i].n);k++; }`:'';
  const diff=model.parameterization==='StableRusinkiewicz'?`
    let v=vec3<f32>(wh.y,-wh.x,0.);
    let wd=wi*wh.z+cross(v,wi)+dot(v,wi)*v/(1.+wh.z);`:`
    let phi=atan2(wh.y,wh.x); let theta=acos(clamp(wh.z,-1.,1.));
    let a=vec3<f32>(cos(phi)*wi.x+sin(phi)*wi.y,-sin(phi)*wi.x+cos(phi)*wi.y,wi.z);
    let wd=vec3<f32>(cos(theta)*a.x-sin(theta)*a.z,a.y,sin(theta)*a.x+cos(theta)*a.z);`;
  const out=model.outputActivation==='Exp'?'exp(value)':`neuralAppearanceScaledSigmoid(value,${number(model.outputScale)})`;
  return `
  fn neuralAppearanceSmeLU(x:f32)->f32 {
    let left=max(.01*x,x+.495);
    return min(left,min(.495*x*x+.505*x+.12375,max(x,.5)));
  }
  fn neuralAppearanceScaledSigmoid(x:f32,scale:f32)->f32 {
    let e=exp(-abs(x));
    if(x>0.) { return scale/(scale*e+1.); }
    return scale*e/(e+scale);
  }
  ${model.frame?networkWGSL('neuralAppearanceFrames',[model.frame],[]):''}
  ${networkWGSL('neuralAppearanceNetwork',model.layers,model.activations)}
  struct NeuralAppearanceFrame { t:vec3<f32>,b:vec3<f32>,n:vec3<f32> }
  struct NeuralAppearancePrepared { latents:array<f32,${n}>,frames:array<NeuralAppearanceFrame,${f}> }
  fn neuralAppearancePrepare(latents:array<f32,${n}>)->NeuralAppearancePrepared {
    var p:NeuralAppearancePrepared;p.latents=latents;${projection}return p;
  }
  fn neuralAppearanceProject(frame:NeuralAppearanceFrame,w:vec3<f32>)->vec3<f32> {
    return vec3<f32>(dot(w,frame.t),dot(w,frame.b),dot(w,frame.n));
  }
  fn neuralAppearanceEvaluatePrepared(p:NeuralAppearancePrepared,wi:vec3<f32>,wo:vec3<f32>)->vec3<f32> {
    if(wi.z<=0.||wo.z<=0.) { return vec3<f32>(0.); }
    let wh=normalize(wi+wo);${diff}
    var x:array<f32,${input}>;var k=0u;
    ${flatten}${z}
    for(var i=0u;i<${n}u;i++) { x[k]=p.latents[i];k++; }
    let raw=neuralAppearanceNetwork(x);var result:vec3<f32>;
    for(var i=0u;i<3u;i++) {let value=raw[i];result[i]=${out};}
    if(any(result!=result)||any(abs(result)>vec3<f32>(3.402823e38))) { return vec3<f32>(0.); }
    return max(result,vec3<f32>(0.));
  }
  fn neuralAppearanceEvaluate(latents:array<f32,${n}>,wi:vec3<f32>,wo:vec3<f32>)->vec3<f32> {
    return neuralAppearanceEvaluatePrepared(neuralAppearancePrepare(latents),wi,wo);
  }`;
}
