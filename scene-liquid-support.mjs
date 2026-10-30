import {Vector3,Euler,Quaternion,Matrix4} from './lib/three.core.js';
import {checkedGeometry} from './scene-geometry.mjs';
import {STAGE_MOLD_SOURCE,checkedStageMold,stageMoldField,stageMoldDistance,stageMoldNormal} from './stage-mold.mjs';
export const SCENE_LIQUID_SUPPORT_ROUTE='kaminos/fluid/authored-primitive-support-v0';
export function sceneLiquidCollider(record) {
 if(record?.waterCollision===false)return null;
 const mold=record?.source===STAGE_MOLD_SOURCE;
 if(!mold&&(record?.type!=='procedural-mesh'||!['plane','sphere','bowl'].includes(record.geometry?.kind)))return null;
 const {kind,parameters:p}=mold?{kind:'stage-mold',parameters:checkedStageMold(record.stageMold??record.object?.userData.kaminosStageMold)}:checkedGeometry(record.geometry);
 let world;
 if(record.object){record.object.updateWorldMatrix(true,false);world=record.object.matrixWorld;}
 else world=new Matrix4().compose(new Vector3(...record.transform.position),new Quaternion().setFromEuler(new Euler(...record.transform.rotation)),new Vector3(...record.transform.scale));
 const e=world.elements,scale=[0,4,8].map(i=>Math.hypot(e[i],e[i+1],e[i+2]));
 if(!(scale[0]>0)||scale.some(v=>Math.abs(v-scale[0])>1e-6*scale[0]))throw Error(`Water collider ${record.id} requires nonzero uniform scale`);
 const position=new Vector3().setFromMatrixPosition(world),axes=[0,4,8].map((start,i)=>[e[start]/scale[i],e[start+1]/scale[i],e[start+2]/scale[i]]);
 if(Math.abs(new Vector3(...axes[0]).dot(new Vector3(...axes[1])))>1e-6||Math.abs(new Vector3(...axes[0]).dot(new Vector3(...axes[2])))>1e-6||Math.abs(new Vector3(...axes[1]).dot(new Vector3(...axes[2])))>1e-6)throw Error(`Water collider ${record.id} has a sheared frame`);
 return {id:record.id,kind,parameters:p,position:position.toArray(),scale:scale[0],axes};
}
export function sceneLiquidDistance(c,world) {
 const v=world.map((x,i)=>(x-c.position[i])/c.scale),q=c.axes.map(a=>a.reduce((s,x,i)=>s+x*v[i],0));
 const r=Math.hypot(...q),radial=r>1e-10?q.map(v=>v/r):[0,1,0];let distance,normal;
 if(c.kind==='stage-mold'){distance=stageMoldDistance(c.parameters,q);normal=stageMoldNormal(c.parameters,q);}
 else if(c.kind==='sphere'){distance=r-c.parameters.radius;normal=radial;}
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
  ['sphere','plane','bowl','stage-mold'].indexOf(c.kind),c.parameters.wallHeight??c.parameters.radius??0,c.parameters.rows?c.parameters.rows[0].length*c.parameters.pitch:c.parameters.width??0,c.parameters.rows?c.parameters.rows.length*c.parameters.pitch:c.parameters.depth??0,
  ...c.position,c.scale,...c.axes[0],c.parameters.baseThickness??c.parameters.thickness??0,...c.axes[1],c.rasterOffset??0,...c.axes[2],c.parameters.pitch??0,
 ],i*20));return result;
}
export function packSceneLiquidTexture(colliders){
 const molds=colliders.filter(c=>c.kind==='stage-mold');
 const width=Math.max(5,...molds.map(c=>c.parameters.rows[0].length));
 let height=Math.max(1,colliders.length);
 const packed=colliders.map(c=>{if(c.kind!=='stage-mold')return c;const row={...c,rasterOffset:height};height+=c.parameters.rows.length;return row;});
 const data=new Float32Array(width*height*4),headers=packSceneLiquidColliders(packed);
 packed.forEach((c,i)=>{data.set(headers.subarray(i*20,i*20+20),i*width*4);if(c.kind==='stage-mold'){
  const field=stageMoldField(c.parameters);for(let z=0;z<field.height;z++)for(let x=0;x<field.width;x++)data[((c.rasterOffset+z)*width+x)*4]=field.data[z*field.width+x];
 }});return {width,height,data};
}
export function createSceneLiquidSupport(device,records=[]) {
 let texture=null,view=null,key=null,ids=[],generation=0,disposed=false;
 const paramsBuffer=device.createBuffer({label:SCENE_LIQUID_SUPPORT_ROUTE,size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
 function update(records){
  if(disposed)throw Error('Scene water support disposed');
  const colliders=records.flatMap(record=>[record,...(record.object?.children??[]).filter(object=>object.userData.kaminosRepetitionCopy).map((object,i)=>({...record,id:record.id+'@repetition:'+i,object}))]).map(sceneLiquidCollider).filter(Boolean),next=JSON.stringify(colliders);if(next===key)return false;
  const {width,height,data}=packSceneLiquidTexture(colliders);if(Math.max(width,height)>device.limits.maxTextureDimension2D)throw Error('Scene water colliders exceed the device texture extent');
  if(!texture||texture.width!==width||texture.height!==height){const previous=texture;texture=device.createTexture({label:SCENE_LIQUID_SUPPORT_ROUTE,size:[width,height,1],format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});view=texture.createView({dimension:'2d-array'});previous?.destroy();}
  device.queue.writeTexture({texture},data,{bytesPerRow:width*16,rowsPerImage:height},[width,height,1]);
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
fn moldBox2(p:vec2<f32>,half:vec2<f32>)->f32{let a=abs(p)-half;return min(max(a.x,a.y),0.0)+length(max(a,vec2<f32>(0)));}
fn moldExtrude(d:f32,y:f32,lo:f32,hi:f32)->f32{let b=abs(y-(hi+lo)*.5)-(hi-lo)*.5;return min(max(d,b),0.0)+length(max(vec2<f32>(d,b),vec2<f32>(0)));}
fn moldDistance(q:vec3<f32>,kind:vec4<f32>,base:f32,offset:i32,pitch:f32)->f32{
 let dims=vec2<i32>(round(kind.zw/pitch));
 let uv=clamp((q.xz+kind.zw*.5)/pitch-.5,vec2<f32>(0),vec2<f32>(dims-vec2<i32>(1)));
 let a=vec2<i32>(floor(uv));let b=min(a+vec2<i32>(1),dims-vec2<i32>(1));let t=fract(uv);
 let d00=textureLoad(sceneSupportSamples,vec2<i32>(a.x,a.y+offset),0,0).x;
 let d10=textureLoad(sceneSupportSamples,vec2<i32>(b.x,a.y+offset),0,0).x;
 let d01=textureLoad(sceneSupportSamples,vec2<i32>(a.x,b.y+offset),0,0).x;
 let d11=textureLoad(sceneSupportSamples,vec2<i32>(b.x,b.y+offset),0,0).x;
 let sd=mix(mix(d00,d10,t.x),mix(d01,d11,t.x),t.y);
 let edge=moldBox2(q.xz,kind.zw*.5);
 return min(moldExtrude(max(sd,edge),q.y,0.0,kind.y),moldExtrude(edge,q.y,-base,0.0));
}

fn sceneColliderFrame(p:vec3<f32>,i:u32)->vec4<f32>{
 let kind=textureLoad(sceneSupportSamples,vec2<i32>(0,i32(i)),0,0);
 let pose=textureLoad(sceneSupportSamples,vec2<i32>(1,i32(i)),0,0);
 let ax=textureLoad(sceneSupportSamples,vec2<i32>(2,i32(i)),0,0);
 let ayData=textureLoad(sceneSupportSamples,vec2<i32>(3,i32(i)),0,0);let ay=ayData.xyz;
 let azData=textureLoad(sceneSupportSamples,vec2<i32>(4,i32(i)),0,0);let az=azData.xyz;
 let v=(p-pose.xyz)/pose.w;let q=vec3<f32>(dot(v,ax.xyz),dot(v,ay),dot(v,az));
 let r=length(q);var n=vec3<f32>(0,1,0);if(r>1e-10){n=q/r;}
 var d=r-kind.y;
 if(kind.x>2.5){
  let extent=abs(q-vec3<f32>(0,(kind.y-ax.w)*.5,0))-vec3<f32>(kind.z*.5,(kind.y+ax.w)*.5,kind.w*.5);
  if(any(extent>vec3<f32>(azData.w))){
   let delta=max(extent,vec3<f32>(0));d=length(delta);n=normalize(delta*sign(q-vec3<f32>(0,(kind.y-ax.w)*.5,0)));
  }else{
   let e=azData.w*.25;let off=i32(ayData.w);d=moldDistance(q,kind,ax.w,off,azData.w);
   let ex=vec3<f32>(e,0,0);let ey=vec3<f32>(0,e,0);let ez=vec3<f32>(0,0,e);
   let g=vec3<f32>(moldDistance(q+ex,kind,ax.w,off,azData.w)-moldDistance(q-ex,kind,ax.w,off,azData.w),moldDistance(q+ey,kind,ax.w,off,azData.w)-moldDistance(q-ey,kind,ax.w,off,azData.w),moldDistance(q+ez,kind,ax.w,off,azData.w)-moldDistance(q-ez,kind,ax.w,off,azData.w));
   n=vec3<f32>(0,1,0);if(length(g)>1e-10){n=normalize(g);}
  }
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
