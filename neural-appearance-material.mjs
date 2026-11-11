import {MeshStandardNodeMaterial,DataTexture,RGBAFormat,FloatType,NearestFilter,NoColorSpace,DoubleSide,TSL} from './lib/three.webgpu.js';
import {buildNeuralAppearanceWGSL} from './neural-appearance.mjs';
const {wgsl,wgslFn,texture,uv,uniform,positionViewDirection,TBNViewMatrix,dFdx,dFdy,vec2,If}=TSL;

export function createNeuralAppearanceMaterial(bundle,{uvScale=1,gain=1}={}){
 const model=bundle.decoder,blocks=Math.ceil(model.numLatents/4),width=Math.max(...bundle.levels.map(l=>l.width));
 let height=0;const levels=bundle.levels.map(l=>{const result={...l,y:height};height+=l.height*blocks;return result;});
 const packed=new Float32Array(width*height*4);
 for(const level of levels)for(let y=0;y<level.height;y++)for(let x=0;x<level.width;x++)for(let c=0;c<model.numLatents;c++)packed[((level.y+Math.floor(c/4)*level.height+y)*width+x)*4+c%4]=level.data[(y*level.width+x)*model.numLatents+c];
 const atlas=new DataTexture(packed,width,height,RGBAFormat,FloatType);atlas.colorSpace=NoColorSpace;atlas.minFilter=atlas.magFilter=NearestFilter;atlas.generateMipmaps=false;atlas.needsUpdate=true;
 const decoderCode=wgsl(buildNeuralAppearanceWGSL(model));
 const prepare=wgslFn(`fn appearancePrepareEntry(atlas:texture_2d<f32>,coords:vec2<f32>,level:f32)->NeuralAppearancePrepared {
  let widths=array<i32,${levels.length}>(${levels.map(l=>l.width).join(',')});
  let heights=array<i32,${levels.length}>(${levels.map(l=>l.height).join(',')});
  let offsets=array<i32,${levels.length}>(${levels.map(l=>l.y).join(',')});
  let mip=u32(clamp(floor(level+.5),0.,${levels.length-1}.));
  let extent=vec2<i32>(widths[mip],heights[mip]);
  let p=clamp(vec2<i32>(floor(fract(coords)*vec2<f32>(extent))),vec2<i32>(0),extent-1);
  var z:array<f32,${model.numLatents}>;
  for(var c=0u;c<${model.numLatents}u;c++){let sample=textureLoad(atlas,p+vec2<i32>(0,offsets[mip]+i32(c/4u)*heights[mip]),0);z[c]=sample[c%4u];}
  return neuralAppearancePrepare(z);
 }`,[decoderCode]);
 // Custom struct arguments use their own WGSL type; FunctionCallNode builds
 // their input without a scalar/vector conversion.
 const evaluate=wgslFn('fn appearanceEvaluateEntry(prepared:NeuralAppearancePrepared,wi:vec3<f32>,wo:vec3<f32>)->vec3<f32>{return neuralAppearanceEvaluatePrepared(prepared,wi,wo);}',[decoderCode]);
 const scale=uniform(uvScale),brightness=uniform(gain),coords=uv().mul(scale),view=positionViewDirection.mul(TBNViewMatrix).normalize();
 const dx=dFdx(coords).mul(vec2(levels[0].width,levels[0].height)),dy=dFdy(coords).mul(vec2(levels[0].width,levels[0].height));
 const lod=dx.dot(dx).add(dy.dot(dy)).sqrt().max(1).log2();
 class NeuralAppearanceMaterial extends MeshStandardNodeMaterial{
  customProgramCacheKey(){return `${super.customProgramCacheKey()}:nvidia-appearance:${this.uuid}`;}
  setupLightingModel(builder){
   const lighting=super.setupLightingModel(builder),prepared=prepare(texture(atlas),coords,lod).toVar('neuralAppearancePrepared');
   const start=lighting.start.bind(lighting);lighting.start=b=>{prepared.append();start(b);};
   lighting.direct=({lightDirection,lightColor,reflectedLight})=>{
    const incoming=lightDirection.mul(TBNViewMatrix).normalize();
    If(incoming.z.greaterThan(0).and(view.z.greaterThan(0)),()=>{
     // The trained response already includes the macro light cosine.
     reflectedLight.directDiffuse.addAssign(evaluate(prepared,view,incoming).mul(lightColor).mul(brightness));
    });
   };
   lighting.indirect=()=>{};
   lighting.directRectArea=()=>{throw Error('NVIDIA appearance area-light integration is not implemented');};
   return lighting;
  }
 }
 const material=new NeuralAppearanceMaterial();material.side=DoubleSide;material.name='NVIDIA compact neural appearance';material.isMeshStandardNodeMaterial=false;material.isNeuralAppearanceMaterial=true;
 material.userData.neuralAppearance={source:bundle.source,provenance:bundle.provenance,lighting:'native direct point/spot/directional',indirect:'not evaluated',response:bundle.response,filtering:bundle.filtering,latentLevels:levels.map(({width,height})=>({width,height}))};
 material.addEventListener('dispose',()=>atlas.dispose());
 return {material,settings:{scale,gain:brightness},dispose:()=>material.dispose()};
}
