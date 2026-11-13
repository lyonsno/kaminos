import {BufferAttribute,MeshStandardNodeMaterial,DataTexture,RGBAFormat,FloatType,NearestFilter,NoColorSpace,DoubleSide,TSL} from './lib/three.webgpu.js';
import {FITTED_REFLECTANCE_WGSL} from './fitted-reflectance.mjs';
const {wgsl, wgslFn, texture, uv, uniform, positionViewDirection, TBNViewMatrix, dFdx, dFdy, vec2, vec3}=TSL;

export function createLocalResponseMaterial(name, response, {uvScale=1}={}) {
 const scale=uniform(uvScale),coords=uv().mul(scale),view=positionViewDirection.mul(TBNViewMatrix).normalize();
 const dx=dFdx(coords).toVar(),dy=dFdy(coords).toVar();
 class LocalResponse extends MeshStandardNodeMaterial {
  customProgramCacheKey(){return super.customProgramCacheKey()+':local-response:'+this.uuid;}
  setupEnvironment(){return null;}
  setupLightingModel(builder) {
   const model=super.setupLightingModel(builder),start=model.start.bind(model);
   model.start=b=>{dx.append();dy.append();start(b);};
   model.indirect=()=>{};
   model.direct=({lightDirection,lightColor,reflectedLight})=>{
    const incoming=lightDirection.mul(TBNViewMatrix).normalize();
    reflectedLight.directDiffuse.addAssign(response(coords,dx,dy,view,incoming).mul(lightColor));
   };
   model.directRectArea=()=>{throw Error('Local response comparison requires directional, point, or spot lights');};
   return model;
  }
 }
 const material=new LocalResponse();material.name=name;material.side=DoubleSide;
 material.isMeshStandardNodeMaterial=false;material.isMeshStandardMaterial=false;
 return {material,scale,dispose:()=>material.dispose()};
}

// Keep the geometry and depth of UV-degenerate faces; exclude only their
// undefined directional finish from all three sides of the comparison.
export function splitCarrierTangentFaces(geometry, invalid) {
 const index=geometry.index,uv=geometry.getAttribute('uv');
 const count=index?.count??uv?.count??0,valid=[],unresolved=[];
 for(let i=0;i<count;i+=3){
  const a=index?index.getX(i):i,b=index?index.getX(i+1):i+1,c=index?index.getX(i+2):i+2;
  const det=uv?(uv.getX(b)-uv.getX(a))*(uv.getY(c)-uv.getY(a))-(uv.getY(b)-uv.getY(a))*(uv.getX(c)-uv.getX(a)):1;
  (invalid.has(a)||invalid.has(b)||invalid.has(c)||!Number.isFinite(det)||det===0?unresolved:valid).push(a,b,c);
 }
 if(!valid.length)throw Error('Carrier has no faces with a coherent UV frame');
 if(!unresolved.length)return null;
 const result=geometry.clone();
 // Avoid spread-argument limits on real TRELLIS index buffers.
 const IndexType=geometry.getAttribute('position')?.count>65536?Uint32Array:Uint16Array;
 const packed=new IndexType(valid.length+unresolved.length);
 packed.set(valid);packed.set(unresolved,valid.length);
 result.setIndex(new BufferAttribute(packed,1));result.clearGroups();
 result.addGroup(0,valid.length,0);result.addGroup(valid.length,unresolved.length,1);
 return {geometry:result,validFaces:valid.length/3,unresolvedFaces:unresolved.length/3};
}

export function createFittedReflectanceMaterial(bundle,options) {
 const width=bundle.levels[0].size;
 let height=0;
 const levels=bundle.levels.map(level=>{const row=height;height+=level.size*3;return {...level,row};});
 const data=new Float32Array(width*height*4);
 for(const {size,row,data:values} of levels)for(let y=0;y<size;y++)for(let x=0;x<size;x++)for(let c=0;c<11;c++){
  data[((row+y+Math.floor(c/4)*size)*width+x)*4+c%4]=values[(y*size+x)*11+c];
 }
 const atlas=new DataTexture(data,width,height,RGBAFormat,FloatType);
 atlas.colorSpace=NoColorSpace;atlas.minFilter=atlas.magFilter=NearestFilter;atlas.generateMipmaps=false;atlas.needsUpdate=true;
 const evaluate=wgslFn(`fn fitTexture(atlas:texture_2d<f32>,coords:vec2<f32>,rho:f32,v:vec3<f32>,l:vec3<f32>)->vec3<f32>{
  let sizes=array<i32,${levels.length}>(${levels.map(l=>l.size)});
  let rows=array<i32,${levels.length}>(${levels.map(l=>l.row)});
  var level=0u;var error=abs(log2(max(rho,1e-8)*f32(sizes[0])));
  for(var i=1u;i<${levels.length}u;i++){
   let e=abs(log2(max(rho,1e-8)*f32(sizes[i])));
   if(e<error){level=i;error=e;}
  }
  let n=sizes[level];
  let p=clamp(vec2<i32>(floor(fract(coords)*f32(n))),vec2<i32>(0),vec2<i32>(n-1))+vec2<i32>(0,rows[level]);
  let a=textureLoad(atlas,p,0);let b=textureLoad(atlas,p+vec2<i32>(0,n),0);
  let c=textureLoad(atlas,p+vec2<i32>(0,2*n),0);
  return fittedReflectance(a.rgb,vec3(a.a,b.rg),b.ba,c.rg,c.b,v,l);
 }`,[wgsl(FITTED_REFLECTANCE_WGSL)]);
 const fitted=createLocalResponseMaterial('Fitted anisotropic reflectance',(uv,dx,dy,v,l)=>
  evaluate(texture(atlas),uv,dx.length().max(dy.length()),v,l),options);
 fitted.material.addEventListener('dispose',()=>atlas.dispose());
 return fitted;
}
