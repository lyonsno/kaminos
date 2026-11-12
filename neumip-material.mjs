import {buildHandoffMath,STONE_HANDOFF_ARCHITECTURE} from './stone-handoff-model.mjs';
import {MeshStandardNodeMaterial,DataTexture,RGBAFormat,FloatType,NearestFilter,NearestMipmapNearestFilter,RepeatWrapping,NoColorSpace,DoubleSide} from './lib/three.webgpu.js';
import {Fn,uniform,texture,wgslFn,uv,positionViewDirection,TBNViewMatrix,normalView,dFdx,dFdy,sqrt,log2,max,If,vec3} from './lib/three.tsl.js';
import {buildNeumipWGSL} from './neumip-shader.mjs';

function pack(level,block) {
  const data=new Float32Array(level.width*level.height*4);
  for(let i=0;i<level.width*level.height;i++)for(let c=0;c<4;c++)data[i*4+c]=block*4+c<level.channels?level.data[i*level.channels+block*4+c]:0;
  return {width:level.width,height:level.height,data};
}
function latentTexture(levels,block,name) {
  const mips=levels.map(level=>pack(level,block)),first=mips[0];
  const t=new DataTexture(first.data,first.width,first.height,RGBAFormat,FloatType);
  t.name=name;t.colorSpace=NoColorSpace;t.wrapS=t.wrapT=RepeatWrapping;
  t.magFilter=NearestFilter;t.minFilter=levels.length>1?NearestMipmapNearestFilter:NearestFilter;
  t.generateMipmaps=false;t.flipY=false;if(levels.length>1)t.mipmaps=mips;t.needsUpdate=true;return t;
}

export function createNeumipMaterial(model,{uvScale=3,gain=4,richEnabled=true,display='composed',residualGain=1}={}) {
  if(!['composed','residual','weighted-residual','routing'].includes(display))throw Error('Unknown residual display');
  if(display!=='composed'&&!model.handoff)throw Error('Residual displays require a paired model');
  if(!Number.isFinite(residualGain)||residualGain<0)throw Error('Residual gain must be finite and nonnegative');
  if(model.architecture===STONE_HANDOFF_ARCHITECTURE&&!model.handoff)throw Error('Paired residual requires its cheap endpoint and routing');
  const diagnosticGain=uniform(residualGain);
  const scale=uniform(uvScale),brightness=uniform(gain),shaders=buildNeumipWGSL(model);
  const textures=[latentTexture([model.offset],0,'NeuMIP offset0'),latentTexture([model.offset],1,'NeuMIP offset1'),latentTexture(model.mips,0,'NeuMIP appearance0'),latentTexture(model.mips,1,'NeuMIP appearance1')];
  const bilinear=wgslFn(shaders.bilinear),offset=wgslFn(shaders.offset),featuresFn=wgslFn(shaders.features,[bilinear,offset]),mainFn=wgslFn(shaders.main);
  const paired=!!model.handoff,richSwitch=uniform(richEnabled?1:0);
  const math=paired?buildHandoffMath(model.handoff,model.offset.width):null;
  if(paired)textures.push(latentTexture(model.handoff.cheap,0,'Stone cheap correction'));
  const tex=textures.map(t=>texture(t));
  const coords=uv().mul(scale),view=positionViewDirection.mul(TBNViewMatrix).negate().toVar('neumipView');
  const lod=Fn(()=>{const dx=dFdx(coords).mul(model.mips[0].width),dy=dFdy(coords).mul(model.mips[0].height);return max(0,log2(sqrt(dx.dot(dx).add(dy.dot(dy))).div(1.2)));})().toVar('neumipLOD');
  const support=paired?wgslFn(math.weight)(coords,lod).mul(richSwitch).toVar('stoneRichSupport'):null;
  const features=featuresFn(coords,view,lod,...(paired?[display==='residual'?uniform(1):support]:[]),...tex.slice(0,4)).toVar('neumipFeaturesShared');
  const cheapFn=paired?wgslFn(`fn stoneCheapResponse(uv:vec2<f32>,view:vec2<f32>,light:vec2<f32>,lod:f32,map:texture_2d<f32>)->vec3<f32>{let l=clamp(lod+${Math.log2(model.handoff.cheap[0].width/model.offset.width).toFixed(1)},0.0,f32(textureNumLevels(map)-1u));let lo=i32(floor(l));let hi=min(lo+1,i32(textureNumLevels(map)-1u));let logScale=mix(nmBilinear(map,uv,lo).rgb,nmBilinear(map,uv,hi).rgb,fract(l));return stoneFlatResponse(view,light)*exp(logScale);}`,[bilinear,wgslFn(math.flat)]):null;

  class NeumipMaterial extends MeshStandardNodeMaterial {
    customProgramCacheKey() {
      // setupLightingModel closes over this instance's weights, latent textures
      // and uniforms. They are not material Node properties, so Three cannot
      // discover them when constructing its shared NodeBuilderState cache key.
      return `${super.customProgramCacheKey()}:neumip:${this.uuid}`;
    }
    setupLighting(builder) {
      // Encode once after summing actual scene lights, before NodeMaterial clamps
      // outgoing radiance to zero. Encoding per light would add neutral repeatedly.
      if(display==='routing')return vec3(support);
      const light=super.setupLighting(builder);
      return display==='composed'?light:light.mul(diagnosticGain).mul(.5).add(.5).clamp(0,1);
    }
    setupLightingModel(builder) {
      const lighting=super.setupLightingModel(builder);
      lighting.direct=({lightDirection,lightColor,reflectedLight})=>{
        const dir=lightDirection.mul(TBNViewMatrix).negate();
        const response=paired?Fn(()=>{if(display==='residual')return mainFn(features.element(0),features.element(1),view.xy,dir.xy);
          const result=(display==='weighted-residual'?vec3(0):cheapFn(coords,view.xy,dir.xy,lod,tex[4])).toVar();If(support.greaterThan(0),()=>{result.addAssign(mainFn(features.element(0),features.element(1),view.xy,dir.xy).mul(support));});return result;})():mainFn(features.element(0),features.element(1),view.xy,dir.xy);
        reflectedLight.directDiffuse.addAssign(response.mul(lightColor).mul(normalView.dot(lightDirection).max(0)).mul(brightness));
      };
      // The checkpoint supplies a directional BTF, not a diffuse environment proxy.
      lighting.indirect=()=>{};
      lighting.directRectArea=()=>{throw Error('NeuMIP rectangular area-light integration is not implemented');};
      return lighting;
    }
  }
  const material=new NeumipMaterial();material.name='NeuMIP author material';material.side=DoubleSide;
  // Workbench applies its global display transform after material evaluation.
  if(display!=='composed')material.fog=false;
  // Reuse standard node-material setup, but this is not a standard diffuse/GGX
  // receiver. The scene's diffuse SSGI adapter must not invent white bounce here.
  material.isMeshStandardNodeMaterial=false;material.isNeumipMaterial=true;
  material.userData.neumip={source:model.source??null,lighting:'native direct point/spot/directional lights',indirect:'not evaluated',model:paired?'authored-cheap-plus-signed-residual':'author-web-export',display,precision:'source float32; manual bilinear and authored mip interpolation'};
  let disposed=false;material.addEventListener('dispose',()=>{if(disposed)return;disposed=true;for(const t of textures)t.dispose();});
  return {material,settings:{scale,gain:brightness,richEnabled:richSwitch,residualGain:diagnosticGain},textures,read:()=>({...material.userData.neumip,uvScale:scale.value,gain:brightness.value,residualGain:diagnosticGain.value})};
}
