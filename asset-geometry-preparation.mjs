import {Box3, BufferAttribute, BufferGeometry, InterleavedBuffer, InterleavedBufferAttribute, Mesh, Object3D, Sphere, Vector3} from './lib/three.core.js';
import {computeAssetArrivalPlacement, chooseAppendAnchor, appendArrivalPivot, computeAssetArrivalFraming} from './asset-arrival.mjs';
import {findRestingPlanes, chooseLevelingPlane, levelingWorldDelta} from './asset-resting-plane.mjs';

// Snapshot descriptors/typed arrays, not a per-vertex JSON conversion. postMessage
// clones their buffers; the displayed geometries keep ownership of their arrays.
export function snapshotAssetGeometry(root,{triangles=true}={}) {
  const geometries=[], originals=[], ids=new Map();let unsupported=false;
  const attribute=a=>a&&({array:a.isInterleavedBufferAttribute?a.data.array:a.array,itemSize:a.itemSize,normalized:a.normalized,
    ...(a.isInterleavedBufferAttribute?{stride:a.data.stride,offset:a.offset}:{}),count:a.count});
  const visit=node=>{
    if(node.isSkinnedMesh||node.isInstancedMesh||node.isBatchedMesh||node.sceneGeometry||node.matrixWorldAutoUpdate===false||node.geometry&&!node.isMesh||node.geometry?.morphAttributes?.position?.length||node.geometry?.getAttribute('position')?.isFloat16BufferAttribute||node.geometry?.getAttribute('position')?.isGLBufferAttribute)unsupported=true;
    let geometry=null;
    if(node.isMesh&&node.geometry){
      const g=node.geometry;
      if(!ids.has(g)){
        ids.set(g,geometries.length);originals.push(g);
        geometries.push({position:attribute(g.getAttribute('position')),index:triangles?attribute(g.index):null,
          boundingBox:g.boundingBox?{min:g.boundingBox.min.toArray(),max:g.boundingBox.max.toArray()}:null,
          boundingSphere:g.boundingSphere?{center:g.boundingSphere.center.toArray(),radius:g.boundingSphere.radius}:null});
      }
      geometry=ids.get(g);
    }
    return {geometry,position:node.position.toArray(),quaternion:node.quaternion.toArray(),scale:node.scale.toArray(),matrix:node.matrix.toArray(),matrixAutoUpdate:node.matrixAutoUpdate,children:node.children.map(visit)};
  };
  root.updateWorldMatrix(true,true);
  const tree=visit(root);
  return unsupported?null:{snapshot:{tree,geometries,parentWorld:root.parent?root.parent.matrixWorld.toArray():null},originals};
}

export function restoreAssetGeometry({tree,geometries,parentWorld=null}) {
  const attribute=a=>{
    if(!a)return null;
    return a.stride!==undefined?new InterleavedBufferAttribute(new InterleavedBuffer(a.array,a.stride),a.itemSize,a.offset,a.normalized)
      :new BufferAttribute(a.array,a.itemSize,a.normalized);
  };
  const prepared=geometries.map(g=>{
    const geometry=new BufferGeometry();
    if(g.position)geometry.setAttribute('position',attribute(g.position));
    if(g.index)geometry.setIndex(attribute(g.index));
    if(g.boundingBox)geometry.boundingBox=new Box3(new Vector3().fromArray(g.boundingBox.min),new Vector3().fromArray(g.boundingBox.max));
    if(g.boundingSphere)geometry.boundingSphere=new Sphere(new Vector3().fromArray(g.boundingSphere.center),g.boundingSphere.radius);
    if(g.position){if(!geometry.boundingBox)geometry.computeBoundingBox();if(!geometry.boundingSphere)geometry.computeBoundingSphere();}
    return geometry;
  });
  const visit=data=>{
    const node=data.geometry===null?new Object3D():new Mesh(prepared[data.geometry]);
    node.position.fromArray(data.position);node.quaternion.fromArray(data.quaternion);node.scale.fromArray(data.scale);
    node.matrix.fromArray(data.matrix);node.matrixAutoUpdate=data.matrixAutoUpdate;node.matrixWorldNeedsUpdate=true;
    for(const child of data.children)node.add(visit(child));return node;
  };
  const root=visit(tree);
  if(parentWorld){const parent=new Object3D();parent.matrixAutoUpdate=false;parent.matrix.fromArray(parentWorld);parent.matrixWorldNeedsUpdate=true;parent.add(root);}
  root.updateWorldMatrix(true,true);
  return {root,geometries:prepared};
}

// Same Float32 world-coordinate and index order as sceneObjectWorldGeometry.
export function assetWorldGeometry(object,{triangles:withTriangles=false}={}) {
  object.updateWorldMatrix(true,true);
  const meshes=[];object.traverse(child=>{if(child.isMesh&&child.geometry.getAttribute('position'))meshes.push(child);});
  const total=meshes.reduce((sum,mesh)=>sum+mesh.geometry.getAttribute('position').count,0);
  const points=new Float32Array(total*3),triangles=withTriangles?[]:null,v=new Vector3();let base=0;
  for(const mesh of meshes){
    const position=mesh.geometry.getAttribute('position');
    for(let i=0;i<position.count;i++){v.fromBufferAttribute(position,i).applyMatrix4(mesh.matrixWorld);points[3*(base+i)]=v.x;points[3*(base+i)+1]=v.y;points[3*(base+i)+2]=v.z;}
    if(withTriangles){const index=mesh.geometry.index,count=index?index.count:position.count;for(let i=0;i<count;i++)triangles.push(base+(index?index.getX(i):i));}
    base+=position.count;
  }
  return {points,triangles};
}

function serializeObstacle(snapshot){const box=new Box3().setFromObject(restoreAssetGeometry(snapshot).root,true);return box.isEmpty()?null:{min:box.min.toArray(),max:box.max.toArray()};}

export function prepareAssetGeometryArrival(snapshot,options) {
  const {root,geometries}=restoreAssetGeometry(snapshot);
  const {mode,groundY,anchor:initialAnchor,viewDirection,framing}=options;
  const obstacleBounds=options.obstacleSources?.map(source=>source.snapshot?serializeObstacle(source.snapshot):source.bounds)??null;
  const obstacles=obstacleBounds?obstacleBounds.filter(Boolean):(options.obstacles??[]);
  const sourceBox=new Box3().setFromObject(root,true);
  const serializeBox=box=>box.isEmpty()?null:{min:box.min.toArray(),max:box.max.toArray()};
  let placement=null,arrivalData=null,leveling=null;
  if(mode&&!sourceBox.isEmpty()){
    const place=anchor=>computeAssetArrivalPlacement({bounds:serializeBox(sourceBox),rootPosition:root.position.toArray(),groundY,anchor});
    let anchor=initialAnchor,spot=null;placement=place(anchor);
    if(placement){
      if(mode==='append'){
        const footprint=[placement.bounds.max[0]-placement.bounds.min[0],placement.bounds.max[2]-placement.bounds.min[2]];
        spot=chooseAppendAnchor({footprint,pivot:appendArrivalPivot(obstacles,anchor),obstacles,viewDirection});
        if(spot.anchor[0]!==anchor[0]||spot.anchor[1]!==anchor[1]){anchor=spot.anchor;placement=place(anchor);}
      }
      root.scale.multiplyScalar(placement.scale);root.position.fromArray(placement.position);
      const {points,triangles}=assetWorldGeometry(root,{triangles:true});
      const analysis=findRestingPlanes(points,triangles),choice=chooseLevelingPlane(analysis);
      if(analysis&&choice.reason==='level'){
        const delta=levelingWorldDelta({plane:choice.plane,hullPoints:analysis.hullPoints,groundY});
        root.updateWorldMatrix(true,false);const storedQuaternion=root.getWorldQuaternion(root.quaternion.clone());
        root.matrixWorld.clone().premultiply(delta).decompose(root.position,root.quaternion,root.scale);
        root.updateWorldMatrix(true,true);const box=new Box3().setFromObject(root,true);
        root.position.x+=anchor[0]-(box.min.x+box.max.x)/2;root.position.z+=anchor[1]-(box.min.z+box.max.z)/2;
        root.updateWorldMatrix(true,true);
        leveling={storedQuaternion:storedQuaternion.toArray(),leveledQuaternion:root.getWorldQuaternion(root.quaternion.clone()).toArray(),tiltDeg:choice.plane.tiltDeg};
      }
      arrivalData={mode,scale:placement.scale,sourceDiagonal:placement.sourceDiagonal,leveledDeg:leveling?.tiltDeg??0,...(spot?{spot:spot.reason,anchor}:{})};
    }
  }
  const bounds=serializeBox(new Box3().setFromObject(root,true));
  const camera=mode==='fresh'&&placement&&framing?computeAssetArrivalFraming({...framing,points:assetWorldGeometry(root).points}):null;
  return {placement,arrivalData,leveling,bounds,obstacleBounds,framing:camera,pose:{position:root.position.toArray(),quaternion:root.quaternion.toArray(),scale:root.scale.toArray(),matrix:root.matrix.toArray()},
    geometryBounds:geometries.map(g=>({box:serializeBox(g.boundingBox??new Box3()),sphere:g.boundingSphere?{center:g.boundingSphere.center.toArray(),radius:g.boundingSphere.radius}:null})),
    effectiveRoute:'static-geometry-worker'};
}

export async function prepareAssetGeometryOffThread(root,options,{Worker:WorkerClass=globalThis.Worker}={}) {
  if(!WorkerClass)return null;
  const captured=snapshotAssetGeometry(root);if(!captured)return null;
  const worker=new WorkerClass(new URL('./asset-geometry.worker.mjs',import.meta.url),{type:'module'});
  try{
    const result=await new Promise((resolve,reject)=>{
      worker.onmessage=({data})=>data.error?reject(Error(data.error)):resolve(data.result);
      worker.onerror=event=>reject(Error(event.message||'Asset geometry worker failed'));
      worker.onmessageerror=()=>reject(Error('Asset geometry worker response could not be read'));
      worker.postMessage({snapshot:captured.snapshot,options});
    });
    const vector=(value,size)=>Array.isArray(value)&&value.length===size&&value.every(Number.isFinite);
    const box=value=>value===null||(vector(value?.min,3)&&vector(value?.max,3));
    if(result?.effectiveRoute!=='static-geometry-worker'||!vector(result.pose?.position,3)||!vector(result.pose?.quaternion,4)||!vector(result.pose?.scale,3)||!vector(result.pose?.matrix,16)
      ||!box(result.bounds)||!Array.isArray(result.geometryBounds)||result.geometryBounds.length!==captured.originals.length
      ||!result.geometryBounds.every(b=>box(b.box)&&(b.sphere===null||(vector(b.sphere?.center,3)&&Number.isFinite(b.sphere?.radius)))))throw Error('Incomplete asset geometry preparation');
    for(let i=0;i<captured.originals.length;i++){
      const g=captured.originals[i],b=result.geometryBounds[i];
      if(!g.boundingBox&&b.box)g.boundingBox=new Box3(new Vector3().fromArray(b.box.min),new Vector3().fromArray(b.box.max));
      if(!g.boundingSphere&&b.sphere)g.boundingSphere=new Sphere(new Vector3().fromArray(b.sphere.center),b.sphere.radius);
    }
    return result;
  }finally{await worker.terminate();}
}


// Precise world bounds may be reused only for the same hierarchy, transforms
// and uploaded position attributes. No vertex values are visited by this check.
export function captureAssetBoundsState(root){
 root.updateWorldMatrix(true,true);const state=[];let supported=true;
 root.traverse(node=>{
  const g=node.geometry,p=g?.getAttribute('position');
  if(node.isSkinnedMesh||node.isInstancedMesh||node.isBatchedMesh||node.sceneGeometry||node.matrixWorldAutoUpdate===false||g&&!node.isMesh||g?.morphAttributes?.position?.length||p?.isFloat16BufferAttribute||p?.isGLBufferAttribute)supported=false;
  state.push(node,g,p,p?.array,p?.data,p?.data?.array,p?.version,p?.data?.version,p?.count,p?.itemSize,p?.normalized,p?.offset,p?.data?.stride,p?.array?.byteLength,p?.data?.array?.byteLength,...node.matrixWorld.elements);
 });
 return supported?state:null;
}
export const assetBoundsStateMatches=(a,b)=>!!a&&!!b&&a.length===b.length&&a.every((value,index)=>value===b[index]);
export function createAssetBoundsCache(){
 const entries=new WeakMap();
 return{
  remember(root,bounds,state=captureAssetBoundsState(root)){
   if(!bounds||!assetBoundsStateMatches(state,captureAssetBoundsState(root)))return false;
   entries.set(root,{state,bounds:{min:[...bounds.min],max:[...bounds.max]}});return true;
  },
  read(root){const entry=entries.get(root);if(!entry||!assetBoundsStateMatches(entry.state,captureAssetBoundsState(root))){entries.delete(root);return null;}return{min:[...entry.bounds.min],max:[...entry.bounds.max]};},
 };
}

export function prepareAssetGeometryBounds(snapshots,{localOnly=false}={}){
 return {effectiveRoute:localOnly?'static-local-bounds-worker':'static-world-bounds-worker',rows:snapshots.map(snapshot=>{
  const {root,geometries}=restoreAssetGeometry(snapshot);const box=localOnly?null:new Box3().setFromObject(root,true);
  return{bounds:box&&!box.isEmpty()?{min:box.min.toArray(),max:box.max.toArray()}:null,
   geometryBounds:geometries.map(g=>({box:g.boundingBox&&!g.boundingBox.isEmpty()?{min:g.boundingBox.min.toArray(),max:g.boundingBox.max.toArray()}:null,sphere:g.boundingSphere?{center:g.boundingSphere.center.toArray(),radius:g.boundingSphere.radius}:null}))};
 })};
}
export async function prepareAssetBoundsOffThread(roots,{localOnly=false,Worker:WorkerClass=globalThis.Worker}={}){
 if(!WorkerClass)return[];
 const captured=roots.map(root=>({root,state:captureAssetBoundsState(root),...snapshotAssetGeometry(root,{triangles:false})})).filter(row=>row.snapshot);
 if(!captured.length)return[];
 const worker=new WorkerClass(new URL('./asset-geometry.worker.mjs',import.meta.url),{type:'module'});
 try{
  const result=await new Promise((resolve,reject)=>{
   worker.onmessage=({data})=>data.error?reject(Error(data.error)):resolve(data.result);
   worker.onerror=event=>reject(Error(event.message||'Asset bounds worker failed'));worker.onmessageerror=()=>reject(Error('Asset bounds worker response could not be read'));
   worker.postMessage({task:'bounds',snapshots:captured.map(row=>row.snapshot),options:{localOnly}});
  });
  const vector=(value,size)=>Array.isArray(value)&&value.length===size&&value.every(Number.isFinite),box=value=>value===null||(vector(value?.min,3)&&vector(value?.max,3));
  if(result?.effectiveRoute!==(localOnly?'static-local-bounds-worker':'static-world-bounds-worker')||!Array.isArray(result.rows)||result.rows.length!==captured.length)throw Error('Incomplete asset bounds preparation');
  return result.rows.map((row,index)=>{
   const capture=captured[index];
   if(!box(row.bounds)||!Array.isArray(row.geometryBounds)||row.geometryBounds.length!==capture.originals.length)throw Error('Incomplete asset bounds preparation');
   if(!assetBoundsStateMatches(capture.state,captureAssetBoundsState(capture.root)))return{root:capture.root,state:capture.state,bounds:null,stale:true,effectiveRoute:result.effectiveRoute};
   for(let k=0;k<capture.originals.length;k++){
    const g=capture.originals[k],b=row.geometryBounds[k];
    if(!box(b.box)||!(b.sphere===null||(vector(b.sphere?.center,3)&&Number.isFinite(b.sphere?.radius))))throw Error('Incomplete asset bounds preparation');
    if(!g.boundingBox&&b.box)g.boundingBox=new Box3(new Vector3().fromArray(b.box.min),new Vector3().fromArray(b.box.max));
    if(!g.boundingSphere&&b.sphere)g.boundingSphere=new Sphere(new Vector3().fromArray(b.sphere.center),b.sphere.radius);
   }
   return{root:capture.root,state:capture.state,bounds:row.bounds,effectiveRoute:result.effectiveRoute};
  });
 }finally{await worker.terminate();}
}
