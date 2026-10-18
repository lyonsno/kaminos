import {Vector3,Euler,Quaternion} from './lib/three.core.js';
import {checkedGeometry} from './scene-geometry.mjs';
export const SCENE_LIQUID_SUPPORT_ROUTE='kaminos/fluid/authored-primitive-support-v0';
export function sceneLiquidCollider(record) {
 if(record?.type!=='procedural-mesh'||record.waterCollision===false||!['plane','sphere','bowl'].includes(record.geometry?.kind))return null;
 const {kind,parameters:p}=checkedGeometry(record.geometry);
 let position,scale,rotation;
 if(record.object){record.object.updateWorldMatrix(true,false);for(let node=record.object;node;node=node.parent)if(!node.visible)return null;
  position=new Vector3();scale=new Vector3();rotation=new Quaternion();record.object.matrixWorld.decompose(position,rotation,scale);
 }else{position=new Vector3(...record.transform.position);scale=new Vector3(...record.transform.scale);rotation=new Quaternion().setFromEuler(new Euler(...record.transform.rotation));}
 if(!(scale.x>0)||[scale.y,scale.z].some(v=>Math.abs(v-scale.x)>1e-6*scale.x))throw Error(`Water collider ${record.id} requires positive uniform scale`);
 const axes=[[1,0,0],[0,1,0],[0,0,1]].map(a=>new Vector3(...a).applyQuaternion(rotation).toArray());
 return {id:record.id,kind,parameters:p,position:position.toArray(),scale:scale.x,axes};
}
export function sceneLiquidDistance(c,world) {
 const v=world.map((x,i)=>(x-c.position[i])/c.scale),q=c.axes.map(a=>a.reduce((s,x,i)=>s+x*v[i],0));
 const r=Math.hypot(...q),radial=r>1e-10?q.map(v=>v/r):[0,1,0];let distance,normal;
 if(c.kind==='sphere'){distance=r-c.parameters.radius;normal=radial;}
 else if(c.kind==='bowl'){
  const wall=Math.abs(r-c.parameters.radius)-c.parameters.thickness/2;
  if(q[1]>wall){distance=q[1];normal=[0,1,0];}else{distance=wall;normal=radial.map(v=>v*(r>=c.parameters.radius?1:-1));}
 }else{
  const dx=Math.max(Math.abs(q[0])-c.parameters.width/2,0),dz=Math.max(Math.abs(q[2])-c.parameters.depth/2,0);
  if(dx===0&&dz===0){distance=q[1];normal=[0,1,0];}
  else{distance=Math.hypot(dx,q[1],dz);normal=[Math.sign(q[0])*dx,q[1],Math.sign(q[2])*dz].map(v=>v/distance);}
 }
 return {distance:distance*c.scale,normal:[0,1,2].map(i=>c.axes.reduce((s,a,j)=>s+a[i]*normal[j],0))};
}
export function packSceneLiquidColliders(colliders) {
 const result=new Float32Array(colliders.length*20);
 colliders.forEach((c,i)=>result.set([
  ['sphere','plane','bowl'].indexOf(c.kind),c.parameters.radius??0,c.parameters.width??0,c.parameters.depth??0,
  ...c.position,c.scale,...c.axes[0],c.parameters.thickness??0,...c.axes[1],0,...c.axes[2],0,
 ],i*20));return result;
}
export function createSceneLiquidSupport(device,records=[]) {
 let texture=null,view=null,key=null,ids=[],generation=0,disposed=false;
 const paramsBuffer=device.createBuffer({label:SCENE_LIQUID_SUPPORT_ROUTE,size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
 function update(records){
  if(disposed)throw Error('Scene water support disposed');
  const colliders=records.map(sceneLiquidCollider).filter(Boolean),next=JSON.stringify(colliders);if(next===key)return false;
  const height=Math.max(1,colliders.length);if(height>device.limits.maxTextureDimension2D)throw Error('Scene water colliders exceed the device texture extent');
  const data=packSceneLiquidColliders(colliders);
  if(!texture||texture.height!==height){const previous=texture;texture=device.createTexture({label:SCENE_LIQUID_SUPPORT_ROUTE,size:[5,height,1],format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});view=texture.createView({dimension:'2d-array'});previous?.destroy();}
  device.queue.writeTexture({texture},colliders.length?data:new Float32Array(20),{bytesPerRow:80,rowsPerImage:height},[5,height,1]);
  device.queue.writeBuffer(paramsBuffer,0,new Uint32Array([colliders.length,0,0,0]));
  ids=colliders.map(c=>c.id);key=next;generation++;return true;
 }
 try{update(records);}catch(error){texture?.destroy();paramsBuffer.destroy();throw error;}
 return {update,get sampleTextureView(){return view;},paramsBuffer,read:()=>({route:SCENE_LIQUID_SUPPORT_ROUTE,owner:'authored_scene',memberIds:[...ids],generation,fallbackRoute:null}),dispose(){if(disposed)return;disposed=true;texture?.destroy();paramsBuffer.destroy();}};
}
export const SCENE_LIQUID_SUPPORT_BINDINGS_WGSL=`
@group(0) @binding(12) var sceneSupportSamples: texture_2d_array<f32>;
@group(0) @binding(13) var<uniform> sceneSupportParams: vec4<u32>;
`;
export const SCENE_LIQUID_SUPPORT_WGSL=`
const analyticObstacleSupportEnabled: bool = false;
fn sceneColliderFrame(p:vec3<f32>,i:u32)->vec4<f32>{
 let kind=textureLoad(sceneSupportSamples,vec2<i32>(0,i32(i)),0,0);
 let pose=textureLoad(sceneSupportSamples,vec2<i32>(1,i32(i)),0,0);
 let ax=textureLoad(sceneSupportSamples,vec2<i32>(2,i32(i)),0,0);
 let ay=textureLoad(sceneSupportSamples,vec2<i32>(3,i32(i)),0,0).xyz;
 let az=textureLoad(sceneSupportSamples,vec2<i32>(4,i32(i)),0,0).xyz;
 let v=(p-pose.xyz)/pose.w;let q=vec3<f32>(dot(v,ax.xyz),dot(v,ay),dot(v,az));
 let r=length(q);var n=vec3<f32>(0,1,0);if(r>1e-10){n=q/r;}
 var d=r-kind.y;
 if(kind.x>1.5){d=abs(r-kind.y)-ax.w*.5;n*=select(-1.0,1.0,r>=kind.y);if(q.y>d){d=q.y;n=vec3<f32>(0,1,0);}}
 else if(kind.x>.5){let outside=max(abs(q.xz)-kind.zw*.5,vec2<f32>(0));d=q.y;n=vec3<f32>(0,1,0);if(any(outside>vec2<f32>(0))){let delta=vec3<f32>(sign(q.x)*outside.x,q.y,sign(q.z)*outside.y);d=length(delta);n=delta/max(d,1e-10);}}
 return vec4<f32>(ax.xyz*n.x+ay*n.y+az*n.z,d*pose.w);
}
fn sceneSupportFrame(p:vec3<f32>)->vec4<f32>{var result=vec4<f32>(0,1,0,1e6);for(var i=0u;i<sceneSupportParams.x;i++){let f=sceneColliderFrame(p,i);if(f.w<result.w){result=f;}}return result;}
fn floorHeight(p:vec3<f32>)->f32{_ = p;return params.boundsMin.y;}
fn floorNormal(p:vec3<f32>)->vec3<f32>{return sceneSupportFrame(p).xyz;}
fn supportVelocityAt(p:vec3<f32>)->vec3<f32>{_ = p;return vec3<f32>(0);}
fn supportSignedDistanceFrame(p:vec3<f32>,radius:f32)->vec4<f32>{let f=sceneSupportFrame(p);return vec4<f32>(f.xyz,f.w-radius);}
fn resolveSupportPenetration(inputPosition:vec3<f32>,radius:f32)->vec3<f32>{var p=inputPosition;for(var i=0u;i<sceneSupportParams.x;i++){let f=sceneColliderFrame(p,i);if(f.w<radius){p+=f.xyz*(radius-f.w);}}return p;}
fn resolveSupportVelocity(inputVelocity:vec3<f32>,p:vec3<f32>,radius:f32)->vec3<f32>{var v=inputVelocity;for(var i=0u;i<sceneSupportParams.x;i++){let f=sceneColliderFrame(p,i);let speed=dot(v,f.xyz);if(f.w<=radius+.01&&speed<0){v-=f.xyz*speed;}}return v;}
fn supportContactFrame(p:vec3<f32>)->vec4<f32>{let f=supportSignedDistanceFrame(p,params.fluid.x*.22);return vec4<f32>(f.xyz,1.0-smoothstep(.012,.09,max(0.0,f.w)));}
`;
