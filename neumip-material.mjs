import {MeshStandardNodeMaterial,DataTexture,RGBAFormat,FloatType,NearestFilter,NearestMipmapNearestFilter,RepeatWrapping,NoColorSpace,DoubleSide} from './lib/three.webgpu.js';
import {Fn,uniform,texture,wgslFn,uv,positionViewDirection,TBNViewMatrix,normalView,dFdx,dFdy,sqrt,log2,max} from './lib/three.tsl.js';
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

export function createNeumipMaterial(model,{uvScale=3,gain=4}={}) {
  const scale=uniform(uvScale),brightness=uniform(gain),shaders=buildNeumipWGSL(model);
  const textures=[latentTexture([model.offset],0,'NeuMIP offset0'),latentTexture([model.offset],1,'NeuMIP offset1'),latentTexture(model.mips,0,'NeuMIP appearance0'),latentTexture(model.mips,1,'NeuMIP appearance1')];
  const bilinear=wgslFn(shaders.bilinear),offset=wgslFn(shaders.offset),featuresFn=wgslFn(shaders.features,[bilinear,offset]),mainFn=wgslFn(shaders.main);
  const tex=textures.map(t=>texture(t));
  const coords=uv().mul(scale),view=positionViewDirection.mul(TBNViewMatrix).negate().toVar('neumipView');
  const features=Fn(()=>{
    const dx=dFdx(coords).mul(model.mips[0].width),dy=dFdy(coords).mul(model.mips[0].height);
    const lod=max(0,log2(sqrt(dx.dot(dx).add(dy.dot(dy))).div(1.2)));
    return featuresFn(coords,view,lod,...tex);
  })().toVar('neumipFeaturesShared');
  class NeumipMaterial extends MeshStandardNodeMaterial {
    setupLightingModel(builder) {
      const lighting=super.setupLightingModel(builder);
      lighting.direct=({lightDirection,lightColor,reflectedLight})=>{
        const dir=lightDirection.mul(TBNViewMatrix).negate();
        const response=mainFn(features.element(0),features.element(1),view.xy,dir.xy);
        reflectedLight.directDiffuse.addAssign(response.mul(lightColor).mul(normalView.dot(lightDirection).max(0)).mul(brightness));
      };
      // The checkpoint supplies a directional BTF, not a diffuse environment proxy.
      lighting.indirect=()=>{};
      lighting.directRectArea=()=>{throw Error('NeuMIP rectangular area-light integration is not implemented');};
      return lighting;
    }
  }
  const material=new NeumipMaterial();material.name='NeuMIP author material';material.side=DoubleSide;
  // Reuse standard node-material setup, but this is not a standard diffuse/GGX
  // receiver. The scene's diffuse SSGI adapter must not invent white bounce here.
  material.isMeshStandardNodeMaterial=false;material.isNeumipMaterial=true;
  material.userData.neumip={source:model.source??null,lighting:'native direct point/spot/directional lights',indirect:'not evaluated',model:'author-web-export',precision:'source float32; manual bilinear and authored mip interpolation'};
  let disposed=false;material.addEventListener('dispose',()=>{if(disposed)return;disposed=true;for(const t of textures)t.dispose();});
  return {material,settings:{scale,gain:brightness},textures,read:()=>({...material.userData.neumip,uvScale:scale.value,gain:brightness.value})};
}
