// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES.
// SPDX-License-Identifier: Apache-2.0
// Auxiliary and sampler parameter decoding adapted from the pinned release.
import {readNeuralAppearanceMLP,buildNeuralAppearanceMLPWGSL} from './neural-appearance.mjs';
const targets={mc_albedo:3,ref_diffuse_specular_roughness:7,ref_diffuse_specular_roughness_normal:10};
export function readNeuralAppearanceGuides(source){
 if(typeof source==='string')source=JSON.parse(source);
 const numLatents=source?.latents?.num_channels;
 if(!Number.isSafeInteger(numLatents)||numLatents<1)throw Error('Positive latent channel count required');
 const trained=record=>record?._params!=null||record?._type_name!=null;
 let aux=null,sampler=null;
 if(trained(source.aux)){
  if(!Object.hasOwn(targets,source.aux.targets))throw Error('Unsupported auxiliary target');
  aux={...readNeuralAppearanceMLP(source.aux,numLatents+3,targets[source.aux.targets],'auxiliary'),target:source.aux.targets};
 }
 if(trained(source.sampler)){
  const specularLobes=source.sampler.num_specular_lobes;
  if(!Number.isSafeInteger(specularLobes)||specularLobes<0)throw Error('Nonnegative specular lobe count required');
  sampler={...readNeuralAppearanceMLP(source.sampler,numLatents+3,3+6*specularLobes,'sampler'),specularLobes};
 }
 if(!aux&&!sampler)throw Error('No trained auxiliary or sampler guide payload is present');
 return {numLatents,aux,sampler};
}

/** Raw auxiliary targets retain their units; sampler weights are sampling
 * probabilities, not energy/albedo. No GGX/diffuse lighting proxy is implied. */
export function buildNeuralAppearanceGuidesWGSL(model){
 const n=model.numLatents;
 const input=`var x:array<f32,${n+3}>;x[0]=wi.x;x[1]=wi.y;x[2]=wi.z;for(var i=0u;i<${n}u;i++){x[i+3u]=latents[i];}`;
 const parts=[`fn neuralAppearanceGuideSmeLU(x:f32)->f32 {let left=max(.01*x,x+.495);return min(left,min(.495*x*x+.505*x+.12375,max(x,.5)));}`];
 if(model.aux){
  parts.push(buildNeuralAppearanceMLPWGSL('neuralAppearanceAuxNetwork',model.aux,'neuralAppearanceGuideSmeLU'));
  parts.push(`fn neuralAppearanceAuxiliary(latents:array<f32,${n}>,wi:vec3<f32>)->array<f32,${model.aux.outputs}>{${input}return neuralAppearanceAuxNetwork(x);}`);
 }
 if(model.sampler){
  const s=model.sampler,count=s.specularLobes,base=count*5;
  parts.push(buildNeuralAppearanceMLPWGSL('neuralAppearanceSamplerNetwork',s,'neuralAppearanceGuideSmeLU'));
  parts.push(`
   struct NeuralAppearanceSamplerLobe {alpha:vec2<f32>,rho:f32,mu:vec2<f32>,weight:f32}
   struct NeuralAppearanceSamplerParams {diffuseWeight:f32,diffuseMu:vec2<f32>,specular:array<NeuralAppearanceSamplerLobe,${Math.max(1,count)}>}
   fn neuralAppearanceSlopeTanh(x:f32)->f32{return x/sqrt(1.+x*x);}
   fn neuralAppearanceSlopeSinh(x:f32)->f32{return x*sqrt(1.+x*x);}
   fn neuralAppearanceSampler(latents:array<f32,${n}>,wi:vec3<f32>)->NeuralAppearanceSamplerParams{
    ${input}let raw=neuralAppearanceSamplerNetwork(x);var p:NeuralAppearanceSamplerParams;
    for(var i=0u;i<${count}u;i++){
     p.specular[i].alpha=vec2<f32>(.0001)+.5*(vec2<f32>(1.)+vec2<f32>(neuralAppearanceSlopeTanh(raw[5u*i]),neuralAppearanceSlopeTanh(raw[5u*i+1u])));
     p.specular[i].rho=neuralAppearanceSlopeTanh(raw[5u*i+2u]);
     p.specular[i].mu=vec2<f32>(neuralAppearanceSlopeSinh(raw[5u*i+3u]),neuralAppearanceSlopeSinh(raw[5u*i+4u]));
    }
    p.diffuseMu=vec2<f32>(neuralAppearanceSlopeSinh(raw[${base}]),neuralAppearanceSlopeSinh(raw[${base+1}]));
    // Use the actual maximum, including when every logit is negative. This
    // is algebraically identical softmax and avoids all-exponent underflow.
    var largest=raw[${base+2+count}];for(var i=0u;i<${count}u;i++){largest=max(largest,raw[${base+2}u+i]);}
    var total=exp(raw[${base+2+count}]-largest);p.diffuseWeight=total;
    for(var i=0u;i<${count}u;i++){p.specular[i].weight=exp(raw[${base+2}u+i]-largest);total+=p.specular[i].weight;}
    p.diffuseWeight/=total;for(var i=0u;i<${count}u;i++){p.specular[i].weight/=total;}
    return p;
   }`);
 }
 return parts.join('\n');
}
