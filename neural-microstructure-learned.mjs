import {TSL,Box3,Sphere,Vector3,InstancedMesh,InstancedBufferGeometry,BoxGeometry,InstancedBufferAttribute,InstancedInterleavedBuffer,InterleavedBufferAttribute,IntType,StorageBufferAttribute,MeshPhysicalNodeMaterial,MeshBasicNodeMaterial,BackSide} from './lib/three.webgpu.js';
import {microFieldWGSL,assertMicroFieldSource} from './neural-microstructure-field.mjs';
const {wgslFn,storage,attribute,varying,vec3,vec4,float,uniform,positionGeometry,positionView,positionViewDirection,modelWorldMatrix,modelWorldMatrixInverse,cameraViewMatrix,cameraWorldMatrix,cameraProjectionMatrix,cameraProjectionMatrixInverse,screenUV,getViewPosition,transformNormalToView}=TSL;

export const MICRO_FIELD_RAY_WGSL=`fn micro_field_ray(ro:vec3<f32>,rd:vec3<f32>,lo:vec3<f32>,hi:vec3<f32>,id:u32,r:f32,grid:ptr<storage,array<f32>,read>,parameters:ptr<storage,array<f32>,read>)->f32{
 var near=0.0;var far=1e20;
 for(var axis=0u;axis<3u;axis++){
  if(abs(rd[axis])<1e-10){if(ro[axis]<lo[axis]||ro[axis]>hi[axis]){return -1.0;}}
  else{let a=(lo[axis]-ro[axis])/rd[axis];let b=(hi[axis]-ro[axis])/rd[axis];near=max(near,min(a,b));far=min(far,max(a,b));}
 }
 if(far<near){return -1.0;}
 // Visit the entire box interval, including its far endpoint. This is a
 // sampled UDF shell, not certified sphere tracing or a zero-thickness disc.
 let steps=max(1u,u32(ceil((far-near)/(r*.25))));
 for(var i=0u;i<=steps;i++){
  let t=mix(near,far,f32(i)/f32(steps));let p=(ro+rd*t-lo)/(hi-lo);
  if(micro_field_decode(id,p,grid,parameters)[0].x<=.2){return t;}
 }
 return -1.0;
}`;

class FieldMaterial extends MeshPhysicalNodeMaterial{
  copy(other){super.copy(other);this.microPosition=other.microPosition;this.microWorld=other.microWorld;return this;}
  setupLighting(builder){
    positionView.assign(this.microPosition).toStack();
    positionViewDirection.assign(builder.camera.isOrthographicCamera?vec3(0,0,1):this.microPosition.negate().normalize()).toStack();
    return super.setupLighting(builder).context({positionView:this.microPosition,positionWorld:this.microWorld,shadowPositionWorld:this.microWorld});
  }
}

export function createLearnedMicrostructure(field,model){
  assertMicroFieldSource(field,model.meta);
  const decode=wgslFn(microFieldWGSL(model)),ray=wgslFn(MICRO_FIELD_RAY_WGSL,[decode]);
  const base=new BoxGeometry(2,2,2),geometry=new InstancedBufferGeometry();geometry.index=base.index.clone();geometry.setAttribute('position',base.attributes.position.clone());geometry.setAttribute('normal',base.attributes.normal.clone());base.dispose();
  geometry.instanceCount=field.carrierCount;
  const lo=new Float32Array(field.carrierCount*3),hi=lo.slice(),ids=Uint32Array.from({length:field.carrierCount},(_,i)=>i);
  for(let i=0;i<field.carrierCount;i++){lo.set(field.carriers.subarray(i*8,i*8+3),i*3);hi.set(field.carriers.subarray(i*8+3,i*8+6),i*3);}
  for(const [name,data,size]of [['fieldLo',lo,3],['fieldHi',hi,3],['fieldId',ids,1]]){const a=new InstancedBufferAttribute(data,size);if(data instanceof Uint32Array)a.gpuType=IntType;geometry.setAttribute(name,a);}
  if(!(field.rows instanceof Float32Array))throw Error('Source rows required for the explicit constant-appearance control');
  const appearanceData=new Float32Array(field.carrierCount*8);
  for(let i=0;i<field.carrierCount;i++){
    const start=field.carriers[i*8+6],count=field.carriers[i*8+7];let visible=0;
    for(let j=start;j<start+count;j++){if(field.rows[j*12+11]<=0)continue;visible++;const length=Math.hypot(...field.rows.subarray(j*12+3,j*12+6));for(let k=0;k<8;k++)appearanceData[i*8+k]+=field.rows[j*12+3+k]/(k<3?length:1);}
    if(visible)for(let k=0;k<8;k++)appearanceData[i*8+k]/=visible;
  }
  const appearanceBuffer=new InstancedInterleavedBuffer(appearanceData,8);
  for(const [name,size,offset]of [['fieldConstantNormal',3,0],['fieldConstantColor',3,3],['fieldConstantParams',2,6]])geometry.setAttribute(name,new InterleavedBufferAttribute(appearanceBuffer,size,offset));
  const learnedAppearance=uniform(1),useLearned=learnedAppearance.greaterThan(.5);
  const low=varying(attribute('fieldLo','vec3')).setInterpolation('flat'),high=varying(attribute('fieldHi','vec3')).setInterpolation('flat'),id=varying(attribute('fieldId','uint')).setInterpolation('flat');
  const buffers=[new StorageBufferAttribute(model.grid,1),new StorageBufferAttribute(model.parameters,1)];
  const grid=storage(buffers[0],'float',model.grid.length).toReadOnly(),parameters=storage(buffers[1],'float',model.parameters.length).toReadOnly();
  const localAt=depth=>modelWorldMatrixInverse.mul(cameraWorldMatrix.mul(vec4(getViewPosition(screenUV,depth,cameraProjectionMatrixInverse),1))).xyz;
  const ro=localAt(float(0)),rd=localAt(float(1)).sub(ro).normalize();
  const t=ray({ro,rd,lo:low,hi:high,id,r:float(field.radius),grid,parameters}).toVar();
  const point=ro.add(rd.mul(t)),normalized=point.sub(low).div(high.sub(low));
  const decoded=decode({id,position:normalized,grid,parameters}).toVar();
  const world=modelWorldMatrix.mul(vec4(point,1)).xyz,view=cameraViewMatrix.mul(vec4(world,1)).xyz,clip=cameraProjectionMatrix.mul(vec4(view,1));
  const material=new FieldMaterial({side:BackSide});material.positionNode=attribute('fieldLo','vec3').add(attribute('fieldHi','vec3')).mul(.5).add(positionGeometry.mul(attribute('fieldHi','vec3').sub(attribute('fieldLo','vec3')).mul(.5)));
  material.maskNode=t.greaterThanEqual(0);material.depthNode=clip.z.div(clip.w);material.microPosition=view;material.microWorld=world;
  const rawNormal=useLearned.select(vec3(decoded.element(0).yz,decoded.element(1).x),varying(attribute('fieldConstantNormal','vec3')).setInterpolation('flat')),normal=transformNormalToView(rawNormal.add(vec3(0,0,1e-8))).normalize(),viewRay=cameraViewMatrix.mul(modelWorldMatrix.mul(vec4(rd,0))).xyz;
  material.normalNode=normal.mul(normal.dot(viewRay).lessThanEqual(0).select(1,-1));
  const srgb=useLearned.select(vec3(decoded.element(1).yz,decoded.element(2).x),varying(attribute('fieldConstantColor','vec3')).setInterpolation('flat')).clamp(0,1);
  material.colorNode=srgb.lessThanEqual(.04045).select(srgb.div(12.92),srgb.add(.055).div(1.055).pow(2.4));
  const constantParams=varying(attribute('fieldConstantParams','vec2')).setInterpolation('flat');material.metalnessNode=useLearned.select(decoded.element(2).y,constantParams.x).clamp(0,1);material.roughnessNode=useLearned.select(decoded.element(2).z,constantParams.y).clamp(.04,1);
  const mesh=new InstancedMesh(geometry,material,field.carrierCount);mesh.name='Learned intrinsic microstructure';mesh.frustumCulled=false;mesh.raycast=()=>{};
  const bounds=new Box3();for(let i=0;i<field.carrierCount;i++){bounds.expandByPoint(new Vector3().fromArray(lo,i*3));bounds.expandByPoint(new Vector3().fromArray(hi,i*3));}
  mesh.boundingBox=bounds.clone();mesh.boundingSphere=bounds.getBoundingSphere(new Sphere());geometry.boundingBox=bounds.clone();geometry.boundingSphere=mesh.boundingSphere.clone();
  const ao=new MeshBasicNodeMaterial({side:BackSide});ao.positionNode=material.positionNode;ao.maskNode=material.maskNode;ao.depthNode=material.depthNode;ao.colorNode=vec4(view.z.negate(),0,0,1);ao.toneMapped=false;mesh.userData.kaminosAODepthMaterial=ao;
  let renderer,disposed=false;mesh.onBeforeRender=r=>{renderer=r;};
  return {mesh,setAppearance(value){if(!['learned','constant'].includes(value))throw Error('Appearance must be learned or constant');learnedAppearance.value=value==='learned'?1:0;},read:()=>({neural:true,representation:'intrinsic-udf-shell',carrierBounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},coveragePolicy:'sampled-udf-shell',opacityPolicy:'opaque learned shell; continuous optical alpha not modeled',appearance:learnedAppearance.value?'learned':'coarse-source-average',appearanceControlBytes:appearanceData.byteLength,shellRadiusUnits:.2,rayStepRadiusUnits:.25,parameterBytes:model.grid.byteLength+model.parameters.byteLength,carrierCount:field.carrierCount,pickingProxy:'exact fine source; not learned-surface evidence'}),dispose(){if(disposed)return;disposed=true;mesh.dispose();geometry.dispose();material.dispose();ao.dispose();for(const b of buffers)renderer?._attributes?.delete(b);}};
}
