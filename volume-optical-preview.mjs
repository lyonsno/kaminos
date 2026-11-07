import {Mesh,BoxGeometry,Data3DTexture,FloatType,RGBAFormat,NearestFilter,MeshBasicNodeMaterial,BackSide,CustomBlending,OneFactor,OneMinusSrcAlphaFactor,Vector3,TSL} from './lib/three.webgpu.js';
import {XYZ_TO_RGB} from './volume-optical-color.mjs';
const {wgslFn,texture3D,uniform,vec4,cameraPosition,modelWorldMatrixInverse,positionGeometry}=TSL;

// Same emission/extinction transfer as the material renderer, exposed as a
// camera-only comparison mesh in the ordinary shared scene. No light fitting.
export const OPTICAL_SAMPLE_WGSL=/* wgsl */`
fn sampleOptics(field:texture_3d<f32>,uv:vec3<f32>)->vec4<f32>{
 let dims=vec3<i32>(textureDimensions(field));let q=uv*vec3<f32>(dims)-.5;let b=vec3<i32>(floor(q));let f=fract(q);var value=vec4<f32>(0);
 for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){
  let off=vec3<i32>(x,y,z);let w=select(1.0-f,f,off==vec3<i32>(1));value+=textureLoad(field,clamp(b+off,vec3<i32>(0),dims-1),0)*w.x*w.y*w.z;
 }}}return max(value,vec4<f32>(0));
}`;
export const OPTICAL_PREVIEW_WGSL=/* wgsl */`
fn opticalPreview(field:texture_3d<f32>,origin:vec3<f32>,direction:vec3<f32>,size:vec3<f32>,gain:f32,view:f32,steps:f32)->vec4<f32>{
 let d=normalize(direction);let half=size*.5;var near=0.0;var far=1e20;
 for(var a=0;a<3;a++){
  if(abs(d[a])<1e-12){if(origin[a]<-half[a]||origin[a]>half[a]){return vec4<f32>(0);}}
  else{let a0=(-half[a]-origin[a])/d[a];let a1=(half[a]-origin[a])/d[a];near=max(near,min(a0,a1));far=min(far,max(a0,a1));}
 }if(far<=near){return vec4<f32>(0);}
 let count=u32(max(1.0,steps));let ds=(far-near)/f32(count);var color=vec3<f32>(0);var transmission=1.0;
 for(var i=0u;i<count;i++){
  let p=origin+d*(near+(f32(i)+.5)*ds);let q=sampleOptics(field,(p+half)/size);var sigma=q.a;var emission=q.rgb*gain;
  if(view>1.5){emission=vec3<f32>(.55,.7,.9)*sigma;}
  else if(view>.5){sigma=0.0;}
  var weight=ds;if(sigma>1e-6){weight=(1.0-exp(-sigma*ds))/sigma;}
  color+=transmission*emission*weight;transmission*=exp(-sigma*ds);
 }
 // Reconstruct in a positive radiometric basis; gamut conversion follows
 // integration, preserving the signed RGB produced by low-temperature soot.
 if(view<1.5){color=vec3<f32>(${XYZ_TO_RGB.map(row=>'dot(color,vec3<f32>('+row.join(',')+'))').join(',')});}
 return vec4<f32>(color,1.0-transmission);
}`;
export function createOpticalPreview(frame){
 const size=frame.bounds[1].map((x,a)=>x-frame.bounds[0][a]),texture=new Data3DTexture(frame.optical,...frame.dimensions);
 texture.format=RGBAFormat;texture.type=FloatType;texture.minFilter=NearestFilter;texture.magFilter=NearestFilter;texture.unpackAlignment=1;texture.needsUpdate=true;
 const gain=uniform(1),view=uniform(0),steps=uniform(128),extent=uniform(new Vector3(...size));
 const origin=modelWorldMatrixInverse.mul(vec4(cameraPosition,1)).xyz;
 const shader=wgslFn(OPTICAL_PREVIEW_WGSL,[wgslFn(OPTICAL_SAMPLE_WGSL)]);
 const material=new MeshBasicNodeMaterial({side:BackSide,transparent:true,depthWrite:false,blending:CustomBlending,blendSrc:OneFactor,blendDst:OneMinusSrcAlphaFactor});
 material.fragmentNode=shader({field:texture3D(texture),origin,direction:positionGeometry.sub(origin),size:extent,gain,view,steps});
 const mesh=new Mesh(new BoxGeometry(...size),material);mesh.name='Recorded flame material';mesh.position.y=size[1]/2;
 return {mesh,setFrame(frame){if(frame.dimensions.some((n,a)=>n!==texture.image[['width','height','depth'][a]]))throw Error('Preview field dimensions changed');texture.image.data=frame.optical;texture.needsUpdate=true;},setView(value){if(!['beauty','emission','extinction'].includes(value))throw Error('Unknown optical view');view.value=['beauty','emission','extinction'].indexOf(value);},setGain(value){if(!Number.isFinite(value)||value<0)throw Error('Nonnegative finite optical gain required');gain.value=value;},setSteps(value){if(!Number.isSafeInteger(value)||value<1||Math.fround(value)>=2**32)throw Error('Positive preview step count representable by the GPU counter required');steps.value=value;},dispose(){mesh.geometry.dispose();material.dispose();texture.dispose();}};
}
