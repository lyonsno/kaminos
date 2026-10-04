import { DataUtils } from 'three/webgpu';
import { pass, mrt, output, normalView, positionViewDirection, diffuseColor, metalness, context, builtinAOContext, texture, screenUV, vec4, float, mix, uniform, convertToTexture } from 'three/tsl';
import { ssgi } from './lib/addons/tsl/display/SSGINode.js';
import { denoise } from './lib/addons/tsl/display/DenoiseNode.js';
import { resolveSceneGISettings, sceneGIReceives } from './scene-gi-settings.mjs';

export function createSceneGI(scene, camera, aoIntensity) {
  const source = pass(scene, camera);
  source.name = 'SSGI opaque linear source';
  source.transparent = false;
  const visibleNormal = normalView.dot(positionViewDirection).lessThan(0).select(normalView.negate(),normalView);
  source.setMRT(mrt({output, normal:visibleNormal}));
  const depth = source.getTextureNode('depth');
  const normal = source.getTextureNode('normal');
  const effect = ssgi(source.getTextureNode('output'),depth,normal,camera);
  effect.useTemporalFiltering = false;
  effect.useScreenSpaceSampling.value = false;
  effect.giIntensity.value = 1;
  const aoFilter = denoise(effect.getAONode(),depth,normal,camera);
  const giFilter = denoise(effect.getGINode(),depth,normal,camera);
  // Depth tolerance is in scene units; preserve kiln contact boundaries.
  aoFilter.depthPhi.value = giFilter.depthPhi.value = .1;
  const aoTexture = convertToTexture(aoFilter), giTexture = convertToTexture(giFilter);
  const rawAO = effect.getAONode(), rawGI = effect.getGINode();
  const gain = uniform(1), filtered = uniform(true,'bool'), viewMode = uniform(0,'int');
  const visibility = filtered.select(texture(aoTexture.value,screenUV).r,texture(rawAO.value,screenUV).r).clamp(0,1);
  const irradianceOverPi = filtered.select(texture(giTexture.value,screenUV).rgb,texture(rawGI.value,screenUV).rgb).mul(gain);
  const ao = mix(float(1),visibility,aoIntensity.min(1)).div(float(1).add(aoIntensity.sub(1).max(0).mul(float(1).sub(visibility))));
  const beauty = pass(scene,camera);
  beauty.name = 'SSGI material receiving';
  beauty.contextNode = context({
    ...builtinAOContext(ao).getFlowContextData(),
    getOutput(node,{material}) {
      // Match Three's diffuseContribution, including mapped/node metalness.
      const diffuseReceiver = diffuseColor.rgb.mul(metalness.oneMinus());
      return sceneGIReceives(material) ? vec4(node.rgb.add(irradianceOverPi.mul(diffuseReceiver)),node.a) : node;
    },
  });
  const setup = beauty.setup;
  beauty.setup = function(builder) {
    aoTexture.build(builder); giTexture.build(builder);
    return setup.call(this,builder);
  };
  // The receiving pass owns producer scheduling. Diagnostics read its resolved
  // textures without pulling the producer graph into isolated conditional scopes.
  const aoView = vec4(visibility,visibility,visibility,1);
  const giView = vec4(irradianceOverPi.mul(texture(depth.value,screenUV).r.lessThan(1)),1);
  const combinedOutput = mix(mix(beauty,aoView,float(viewMode.equal(1))),giView,float(viewMode.equal(2)));
  let settings = resolveSceneGISettings();
  let frames = 0;
  const update = effect.updateBefore;
  effect.updateBefore = function(frame) { update.call(this,frame); frames++; };
  return {
    depth, source, beauty,
    output() { return combinedOutput; },
    setSettings(value) {
      settings = resolveSceneGISettings(value);
      effect.radius.value = settings.radius; effect.thickness.value = settings.thickness;
      effect.sliceCount.value = settings.slices; effect.stepCount.value = settings.steps;
      gain.value = settings.gain; filtered.value = settings.denoise > 0;
      viewMode.value = ['scene','ao','gi'].indexOf(settings.view);
      aoFilter.radius.value = giFilter.radius.value = settings.denoise;
    },
    async readback(renderer) {
      const target=effect._ssgiRenderTarget;
      const data=await renderer.readRenderTargetPixelsAsync(target,0,0,target.width,target.height,1);
      let sum=0,max=0,nonzero=0,finite=true;
      for(let i=0;i<data.length;i++)if(i%4<3){const v=DataUtils.fromHalfFloat(data[i]);finite&&=Number.isFinite(v);sum+=v;max=Math.max(max,v);if(v>0)nonzero++;}
      const bytes=new Uint8Array(data.buffer,data.byteOffset,data.byteLength),chunks=[];
      // Chunk only the JS call arguments, not the evidence. Preserve every byte.
      for(let i=0;i<bytes.length;i+=16384)chunks.push(String.fromCharCode(...bytes.subarray(i,i+16384)));
      return {width:target.width,height:target.height,format:'rgba16f-little-endian',base64:btoa(chunks.join('')),stats:{sum,max,nonzero,finite}};
    },
    debugState:()=>({identity:'three-ssilvb-scene-gi-v1',...settings,frames,
      temporal:false,source:'opaque-linear-lit-surfaces',receiver:'opaque-physical-material-diffuse',
      resolution:[effect._ssgiRenderTarget.width,effect._ssgiRenderTarget.height],
      sourcePasses:1,receivingPasses:1,standaloneGTAO:false,format:'rgba16float',gainSemantics:'artistic-relative-estimator-gain'}),
  };
}
