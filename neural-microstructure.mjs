import {TSL,Group,InstancedMesh,BufferGeometry,BufferAttribute,Box3,Sphere,Matrix4,Ray,Vector3,IntType,BoxGeometry,PlaneGeometry,InstancedBufferGeometry,InstancedBufferAttribute,InstancedInterleavedBuffer,InterleavedBufferAttribute,StorageBufferAttribute,BackSide,DoubleSide,MeshPhysicalNodeMaterial,MeshBasicNodeMaterial} from './lib/three.webgpu.js';
const {wgslFn,storage,attribute,varying,vec3,vec4,float,uv,positionGeometry,positionView,positionViewDirection,modelWorldMatrix,modelWorldMatrixInverse,cameraViewMatrix,cameraWorldMatrix,cameraProjectionMatrix,cameraProjectionMatrixInverse,screenUV,getViewPosition,transformNormalToView,faceDirection}=TSL;
import {MICRO_DISC_WGSL,MICRO_NEAREST_WGSL,traceMicrostructure} from './neural-microstructure-core.mjs';

const disc=wgslFn(MICRO_DISC_WGSL),nearest=wgslFn(MICRO_NEAREST_WGSL,[disc]);
const linear=v=>{v=Math.max(0,Math.min(1,v));return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;};
class MicroSurfaceMaterial extends MeshPhysicalNodeMaterial {
  copy(other){super.copy(other);this.microPosition=other.microPosition;this.microWorld=other.microWorld;return this;}
  setupLighting(builder){
    positionView.assign(this.microPosition).toStack();
    positionViewDirection.assign(builder.camera.isOrthographicCamera?vec3(0,0,1):this.microPosition.negate().normalize()).toStack();
    return super.setupLighting(builder).context({positionView:this.microPosition,positionWorld:this.microWorld,shadowPositionWorld:this.microWorld});
  }
}
const instanced=base=>{
  const geometry=new InstancedBufferGeometry();geometry.index=base.index.clone();
  for(const key of ['position','normal','uv'])geometry.setAttribute(key,base.attributes[key].clone());
  base.dispose();return geometry;
};
function surfaceProxy(rows,radius){
  // An inscribed polygon per actual disc supplies native grounding/geometry
  // consumers with surface, not the shader's unit template or filled boxes.
  const count=rows.length/12,positions=new Float32Array(count*18),indices=new Uint32Array(count*12);
  for(let i=0;i<count;i++){
    const o=i*12,n=new Vector3(...rows.subarray(o+3,o+6)).normalize(),u=new Vector3().crossVectors(n,Math.abs(n.z)<.9?new Vector3(0,0,1):new Vector3(0,1,0)).normalize(),v=new Vector3().crossVectors(n,u),points=[];
    for(let axis=0;axis<3;axis++)for(const sign of [-1,1]){
      const p=new Vector3().setComponent(axis,sign).addScaledVector(n,-sign*n.getComponent(axis));if(p.lengthSq()<1e-12)p.copy(u).multiplyScalar(sign);else p.normalize();
      points.push({p,angle:Math.atan2(p.dot(v),p.dot(u))});
    }
    points.sort((a,b)=>a.angle-b.angle);
    for(let j=0;j<6;j++)for(let a=0;a<3;a++)positions[i*18+j*3+a]=rows[o+a]+radius*points[j].p.getComponent(a);
    for(let j=0;j<4;j++)indices.set([i*6,i*6+j+1,i*6+j+2],i*12+j*3);
  }
  const geometry=new BufferGeometry();geometry.setAttribute('position',new BufferAttribute(positions,3));geometry.setIndex(new BufferAttribute(indices,1));geometry.computeBoundingBox();return geometry;
}
function fineDiscs(rows,radius,label){
  const geometry=instanced(new PlaneGeometry(2,2)),count=rows.length/12;
  geometry.instanceCount=count;
  const centers=new Float32Array(count*3),normals=new Float32Array(count*3),axisU=new Float32Array(count*3),axisV=new Float32Array(count*3),colors=new Float32Array(count*3),parameters=new Float32Array(count*2),opacity=new Float32Array(count);
  for(let i=0;i<count;i++){
    const o=i*12,p=i*3;centers.set(rows.subarray(o,o+3),p);
    let [nx,ny,nz]=rows.subarray(o+3,o+6);const length=Math.hypot(nx,ny,nz);nx/=length;ny/=length;nz/=length;normals.set([nx,ny,nz],p);
    const ref=Math.abs(nz)<.9?[0,0,1]:[0,1,0];
    let ux=ny*ref[2]-nz*ref[1],uy=nz*ref[0]-nx*ref[2],uz=nx*ref[1]-ny*ref[0];
    const ul=Math.hypot(ux,uy,uz);ux/=ul;uy/=ul;uz/=ul;
    axisU.set([ux,uy,uz],p);axisV.set([ny*uz-nz*uy,nz*ux-nx*uz,nx*uy-ny*ux],p);
    colors.set([linear(rows[o+6]),linear(rows[o+7]),linear(rows[o+8])],p);parameters.set([Math.max(0,Math.min(1,rows[o+9])),Math.max(.04,Math.min(1,rows[o+10]))],i*2);opacity[i]=rows[o+11];
  }
  const interleaved=new Float32Array(count*18),buffer=new InstancedInterleavedBuffer(interleaved,18);let offset=0;
  for(const [name,array,size]of [['microCenter',centers,3],['microNormal',normals,3],['microU',axisU,3],['microV',axisV,3],['microColor',colors,3],['microParams',parameters,2],['microOpacity',opacity,1]]){
    for(let i=0;i<count;i++)interleaved.set(array.subarray(i*size,i*size+size),i*18+offset);
    geometry.setAttribute(name,new InterleavedBufferAttribute(buffer,size,offset));offset+=size;
  }
  const material=new MeshPhysicalNodeMaterial({side:DoubleSide});
  material.positionNode=attribute('microCenter','vec3').add(attribute('microU','vec3').mul(positionGeometry.x.mul(radius))).add(attribute('microV','vec3').mul(positionGeometry.y.mul(radius)));
  material.normalNode=varying(transformNormalToView(attribute('microNormal','vec3'))).normalize().mul(faceDirection);
  material.colorNode=attribute('microColor','vec3');material.metalnessNode=attribute('microParams','vec2').x;material.roughnessNode=attribute('microParams','vec2').y;
  const d=uv().mul(2).sub(1);material.maskNode=d.dot(d).lessThanEqual(1).and(attribute('microOpacity','float').greaterThan(0));
  const mesh=new InstancedMesh(geometry,material,count);mesh.name=label;mesh.frustumCulled=false;return mesh;
}

export function createMicrostructureControl(field){
  if(!(field.rows instanceof Float32Array)||field.rows.length!==field.count*12||!(field.carriers instanceof Float32Array)||field.carriers.length!==field.carrierCount*8||!(field.radius>0))throw Error('Invalid microstructure field');
  if(!(field.sourceIds instanceof Uint32Array)||field.sourceIds.length!==field.count)throw Error('Matching source IDs required for scene picking');
  if(field.count>=2**24)throw Error('Float-carried row address exceeds exact integer capacity');
  const root=new Group();root.name='TRELLIS microstructure control';
  const fine=fineDiscs(field.rows,field.radius,'Fine source discs');
  const coarseRows=new Float32Array(field.carrierCount*12);
  const geometry=instanced(new BoxGeometry(2,2,2)),centers=new Float32Array(field.carrierCount*3),extents=new Float32Array(field.carrierCount*3),ranges=new Uint32Array(field.carrierCount*2);
  geometry.instanceCount=field.carrierCount;
  for(let i=0;i<field.carrierCount;i++){
    const h=i*8,start=field.carriers[h+6],count=field.carriers[h+7];
    for(let a=0;a<3;a++){centers[i*3+a]=(field.carriers[h+a]+field.carriers[h+3+a])*.5;extents[i*3+a]=(field.carriers[h+3+a]-field.carriers[h+a])*.5;}
    ranges.set([start,count],i*2);
    for(let j=start;j<start+count;j++)for(let a=0;a<12;a++)coarseRows[i*12+a]+=field.rows[j*12+a]/count;
    if(Math.hypot(...coarseRows.subarray(i*12+3,i*12+6))<1e-8)coarseRows[i*12+5]=1;
  }
  for(const [name,array,size]of [['microCenter',centers,3],['microExtent',extents,3],['microRange',ranges,2]]){const attribute=new InstancedBufferAttribute(array,size);if(array instanceof Uint32Array)attribute.gpuType=IntType;geometry.setAttribute(name,attribute);}
  const coarse=fineDiscs(coarseRows,field.cellSize*.8,'Averaged coarse discs');
  const data=field.rows.slice();for(let i=0;i<field.count;i++)for(let a=6;a<9;a++)data[i*12+a]=linear(data[i*12+a]);
  const buffer=new StorageBufferAttribute(data,4),rows=storage(buffer,'vec4',data.length/4).toReadOnly();
  const range=varying(attribute('microRange','uvec2')).setInterpolation('flat');
  const localAt=depth=>modelWorldMatrixInverse.mul(cameraWorldMatrix.mul(vec4(getViewPosition(screenUV,depth,cameraProjectionMatrixInverse),1))).xyz;
  const ro=localAt(float(0)),rd=localAt(float(1)).sub(ro).normalize();
  const hit=nearest({ro,rd,r:float(field.radius),start:range.x,count:range.y,rows}).toVar();
  const index=hit.y.max(0).toUint(),a=rows.element(index.mul(3)),b=rows.element(index.mul(3).add(1)),c=rows.element(index.mul(3).add(2));
  const world=modelWorldMatrix.mul(vec4(ro.add(rd.mul(hit.x)),1)).xyz,view=cameraViewMatrix.mul(vec4(world,1)).xyz;
  const clip=cameraProjectionMatrix.mul(vec4(view,1)),valid=hit.x.greaterThanEqual(0);
  const normal=transformNormalToView(vec3(a.w,b.xy)).normalize();
  const material=new MicroSurfaceMaterial({side:BackSide});
  material.positionNode=attribute('microCenter','vec3').add(positionGeometry.mul(attribute('microExtent','vec3')));
  material.microWorld=world;material.microPosition=view;material.maskNode=valid;material.depthNode=clip.z.div(clip.w);
  // Disc normals face the viewing ray, not the arbitrary carrier box face.
  const viewRay=cameraViewMatrix.mul(modelWorldMatrix.mul(vec4(rd,0))).xyz;
  material.normalNode=normal.mul(normal.dot(viewRay).lessThanEqual(0).select(1,-1));
  material.colorNode=vec3(b.zw,c.x);material.metalnessNode=c.y.clamp(0,1);material.roughnessNode=c.z.clamp(.04,1);
  const carrier=new InstancedMesh(geometry,material,field.carrierCount);carrier.name='Coarse carriers with exact fine depth';carrier.frustumCulled=false;
  const aoMaterial=new MeshBasicNodeMaterial({side:BackSide});aoMaterial.positionNode=material.positionNode;aoMaterial.maskNode=valid;aoMaterial.depthNode=material.depthNode;aoMaterial.colorNode=vec4(view.z.negate(),0,0,1);aoMaterial.toneMapped=false;carrier.userData.kaminosAODepthMaterial=aoMaterial;
  root.add(fine,coarse,carrier);let mode='carrier',disposed=false,lastRenderer=null;
  carrier.onBeforeRender=renderer=>{lastRenderer=renderer;};
  const fineProxy=surfaceProxy(field.rows,field.radius),coarseProxy=surfaceProxy(coarseRows,field.cellSize*.8);
  for(const mesh of [fine,coarse,carrier])mesh.raycast=()=>{};
  root.userData.raycastsAsWhole=true;
  const coarseIds=Uint32Array.from({length:field.carrierCount},(_,i)=>i);
  root.raycast=(raycaster,hits)=>{
    root.updateWorldMatrix(true,false);const inverse=new Matrix4().copy(root.matrixWorld).invert(),ray=new Ray().copy(raycaster.ray).applyMatrix4(inverse);
    const source=mode==='coarse'?{rows:coarseRows,count:field.carrierCount,radius:field.cellSize*.8,sourceIds:coarseIds}:field;
    const hit=traceMicrostructure(source,ray.origin.toArray(),ray.direction.toArray());if(!hit)return;
    const point=ray.at(hit.t,new Vector3()).applyMatrix4(root.matrixWorld),distance=point.distanceTo(raycaster.ray.origin);
    if(distance>=raycaster.near&&distance<=raycaster.far)hits.push({object:root,point,distance,index:hit.sourceId});
  };
  const setMode=value=>{if(!['fine','coarse','carrier'].includes(value))throw Error('Mode must be fine, coarse or carrier');mode=value;fine.visible=mode==='fine';coarse.visible=mode==='coarse';carrier.visible=mode==='carrier';root.sceneGeometry=mode==='coarse'?coarseProxy:fineProxy;const bounds=root.sceneGeometry.boundingBox;for(const mesh of [fine,coarse,carrier]){mesh.boundingBox=bounds.clone();mesh.boundingSphere=bounds.getBoundingSphere(new Sphere());mesh.geometry.boundingBox=bounds.clone();mesh.geometry.boundingSphere=mesh.boundingSphere.clone();}};
  setMode(mode);
  return {root,setMode,read:()=>({mode,localBounds:{min:root.sceneGeometry.boundingBox.min.toArray(),max:root.sceneGeometry.boundingBox.max.toArray()},sourceDiscs:field.count,carriers:field.carrierCount,maxChildren:field.maxChildren,radius:field.radius,cellSize:field.cellSize,neural:false,coveragePolicy:'binary-disc-support',sourceAlpha:field.alpha,opacityPolicy:'raw-preserved; binary geometry control, not optical alpha parity',sourcePayloadBytes:field.rows.byteLength,carrierBytes:field.carriers.byteLength}),dispose(){if(disposed)return;disposed=true;for(const mesh of [fine,coarse,carrier]){mesh.dispose();mesh.geometry.dispose();mesh.material.dispose();}fineProxy.dispose();coarseProxy.dispose();aoMaterial.dispose();lastRenderer?._attributes?.delete(buffer);root.clear();}};
}
