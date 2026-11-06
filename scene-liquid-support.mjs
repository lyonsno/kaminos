import {Vector3,Euler,Quaternion,Matrix4} from './lib/three.core.js';
import {checkedGeometry} from './scene-geometry.mjs';
export const SCENE_LIQUID_SUPPORT_ROUTE='kaminos/fluid/authored-primitive-support-v0';
export const canCollideWithWater=record=>record?.type==='procedural-mesh'&&['plane','sphere','bowl','box','funnel'].includes(record.geometry?.kind);
export function sceneLiquidCollider(record) {
 if(!canCollideWithWater(record)||record.waterCollision===false)return null;
 const {kind,parameters:p}=checkedGeometry(record.geometry);
 let world;
 if(record.object){record.object.updateWorldMatrix(true,false);world=record.object.matrixWorld;}
 else world=new Matrix4().compose(new Vector3(...record.transform.position),new Quaternion().setFromEuler(new Euler(...record.transform.rotation)),new Vector3(...record.transform.scale));
 const e=world.elements,scale=[0,4,8].map(i=>Math.hypot(e[i],e[i+1],e[i+2]));
 if(!scale.every(v=>Number.isFinite(v)&&v>0)||kind!=='box'&&scale.some(v=>Math.abs(v-scale[0])>1e-6*scale[0]))throw Error(`Water collider ${record.id} requires nonzero uniform scale`);
 const position=new Vector3().setFromMatrixPosition(world),axes=[0,4,8].map((start,i)=>[e[start]/scale[i],e[start+1]/scale[i],e[start+2]/scale[i]]);
 if(Math.abs(new Vector3(...axes[0]).dot(new Vector3(...axes[1])))>1e-6||Math.abs(new Vector3(...axes[0]).dot(new Vector3(...axes[2])))>1e-6||Math.abs(new Vector3(...axes[1]).dot(new Vector3(...axes[2])))>1e-6)throw Error(`Water collider ${record.id} has a sheared frame`);
 // Orthogonal box extents absorb nonuniform scale; the distance stays in world metres.
 return {id:record.id,kind,parameters:kind==='box'?{...p,width:p.width*scale[0],height:p.height*scale[1],depth:p.depth*scale[2]}:p,position:position.toArray(),scale:kind==='box'?1:scale[0],axes};
}
export function sceneLiquidDistance(c,world) {
 const v=world.map((x,i)=>(x-c.position[i])/c.scale),q=c.axes.map(a=>a.reduce((s,x,i)=>s+x*v[i],0));
 const r=Math.hypot(...q),radial=r>1e-10?q.map(v=>v/r):[0,1,0];let distance,normal;
 if(c.kind==='box'){
  const delta=q.map((v,i)=>Math.abs(v)-[c.parameters.width,c.parameters.height,c.parameters.depth][i]/2),outside=delta.map(v=>Math.max(0,v)),length=Math.hypot(...outside);
  distance=length+Math.min(Math.max(...delta),0);
  if(length>0)normal=outside.map((v,i)=>v/length*(q[i]<0?-1:1));
  else{const axis=delta.indexOf(Math.max(...delta));normal=q.map((v,i)=>i===axis?(v<0?-1:1):0);}
 }else if(c.kind==='funnel'){
  const radial=Math.hypot(q[0],q[2]),dr=c.parameters.topRadius-c.parameters.bottomRadius,h=c.parameters.height;
  const x=radial-c.parameters.bottomRadius,y=q[1]+h/2,t=Math.max(0,Math.min(1,(x*dr+y*h)/(dr*dr+h*h)));
  const dx=x-t*dr,dy=y-t*h,len=Math.hypot(dx,dy),nx=len>1e-10?dx/len:h/Math.hypot(dr,h),ny=len>1e-10?dy/len:-dr/Math.hypot(dr,h);
  distance=len-c.parameters.thickness/2;normal=[nx*(radial>1e-10?q[0]/radial:1),ny,nx*(radial>1e-10?q[2]/radial:0)];
 }else if(c.kind==='sphere'){distance=r-c.parameters.radius;normal=radial;}
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
  ['sphere','plane','bowl','box','funnel'].indexOf(c.kind),c.parameters.radius??c.parameters.bottomRadius??0,c.parameters.width??c.parameters.topRadius??0,c.parameters.depth??c.parameters.height??0,
  ...c.position,c.scale,...c.axes[0],c.parameters.thickness??0,...c.axes[1],c.parameters.height??0,...c.axes[2],0,
 ],i*20));return result;
}
export function createSceneLiquidSupport(device,records=[]) {
 let texture=null,view=null,key=null,ids=[],generation=0,disposed=false;
 const paramsBuffer=device.createBuffer({label:SCENE_LIQUID_SUPPORT_ROUTE,size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
 function update(records){
  if(disposed)throw Error('Scene water support disposed');
  const colliders=records.flatMap(record=>[record,...(record.object?.children??[]).filter(object=>object.userData.kaminosRepetitionCopy).map((object,i)=>({...record,id:record.id+'@repetition:'+i,object}))]).map(sceneLiquidCollider).filter(Boolean),next=JSON.stringify(colliders);if(next===key)return false;
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
export const SCENE_LIQUID_COLLIDER_WGSL=`
const analyticObstacleSupportEnabled: bool = false;
fn sceneColliderFrame(p:vec3<f32>,i:u32)->vec4<f32>{
 let kind=textureLoad(sceneSupportSamples,vec2<i32>(0,i32(i)),0,0);
 let pose=textureLoad(sceneSupportSamples,vec2<i32>(1,i32(i)),0,0);
 let ax=textureLoad(sceneSupportSamples,vec2<i32>(2,i32(i)),0,0);
 let heightAxis=textureLoad(sceneSupportSamples,vec2<i32>(3,i32(i)),0,0);let ay=heightAxis.xyz;
 let az=textureLoad(sceneSupportSamples,vec2<i32>(4,i32(i)),0,0).xyz;
 let v=(p-pose.xyz)/pose.w;let q=vec3<f32>(dot(v,ax.xyz),dot(v,ay),dot(v,az));
 let r=length(q);var n=vec3<f32>(0,1,0);if(r>1e-10){n=q/r;}
 var d=r-kind.y;
 if(kind.x>3.5){
  let radial=length(q.xz);let segment=vec2<f32>(kind.z-kind.y,kind.w);let offset=vec2<f32>(radial-kind.y,q.y+kind.w*.5);
  let t=clamp(dot(offset,segment)/dot(segment,segment),0.,1.);let delta=offset-t*segment;let len=length(delta);
  var normal2=vec2<f32>(segment.y,-segment.x)/length(segment);if(len>1e-10){normal2=delta/len;}
  var direction=vec2<f32>(1,0);if(radial>1e-10){direction=q.xz/radial;}
  d=len-ax.w*.5;n=vec3<f32>(normal2.x*direction.x,normal2.y,normal2.x*direction.y);
 }else if(kind.x>2.5){
  let delta=abs(q)-vec3<f32>(kind.z,heightAxis.w,kind.w)*.5;let outside=max(delta,vec3<f32>(0));let len=length(outside);
  d=len+min(max(max(delta.x,delta.y),delta.z),0.0);
  let direction=select(vec3<f32>(1),vec3<f32>(-1),q<vec3<f32>(0));
  if(len>0.0){n=direction*outside/len;}
  else if(delta.x>=delta.y&&delta.x>=delta.z){n=vec3<f32>(direction.x,0,0);}
  else if(delta.y>=delta.z){n=vec3<f32>(0,direction.y,0);}else{n=vec3<f32>(0,0,direction.z);}
 }
 else if(kind.x>1.5){d=abs(r-kind.y)-ax.w*.5;n*=select(-1.0,1.0,r>=kind.y);if(q.y>d){d=q.y;n=vec3<f32>(0,1,0);}}
 else if(kind.x>.5){let outside=max(abs(q.xz)-kind.zw*.5,vec2<f32>(0));d=q.y;n=vec3<f32>(0,1,0);if(any(outside>vec2<f32>(0))){let delta=vec3<f32>(sign(q.x)*outside.x,q.y,sign(q.z)*outside.y);d=length(delta);n=delta/max(d,1e-10);}}
 return vec4<f32>(ax.xyz*n.x+ay*n.y+az*n.z,d*pose.w);
}
fn sceneSupportFrame(p:vec3<f32>)->vec4<f32>{var result=vec4<f32>(0,1,0,1e6);for(var i=0u;i<sceneSupportParams.x;i++){let f=sceneColliderFrame(p,i);if(f.w<result.w){result=f;}}return result;}
`;
export const SCENE_LIQUID_SUPPORT_WGSL=SCENE_LIQUID_COLLIDER_WGSL+`
fn floorHeight(p:vec3<f32>)->f32{_ = p;return params.boundsMin.y;}
fn floorNormal(p:vec3<f32>)->vec3<f32>{return sceneSupportFrame(p).xyz;}
fn supportVelocityAt(p:vec3<f32>)->vec3<f32>{_ = p;return vec3<f32>(0);}
fn supportSignedDistanceFrame(p:vec3<f32>,radius:f32)->vec4<f32>{let f=sceneSupportFrame(p);return vec4<f32>(f.xyz,f.w-radius);}
fn resolveSupportPenetration(inputPosition:vec3<f32>,radius:f32)->vec3<f32>{var p=inputPosition;for(var i=0u;i<sceneSupportParams.x;i++){let f=sceneColliderFrame(p,i);if(f.w<radius){p+=f.xyz*(radius-f.w);}}return p;}
fn resolveSupportVelocity(inputVelocity:vec3<f32>,p:vec3<f32>,radius:f32)->vec3<f32>{var v=inputVelocity;for(var i=0u;i<sceneSupportParams.x;i++){let f=sceneColliderFrame(p,i);let speed=dot(v,f.xyz);if(f.w<=radius+.01&&speed<0){v-=f.xyz*speed;}}return v;}
fn supportContactFrame(p:vec3<f32>)->vec4<f32>{let f=supportSignedDistanceFrame(p,params.fluid.x*.22);return vec4<f32>(f.xyz,1.0-smoothstep(.012,.09,max(0.0,f.w)));}
`;
