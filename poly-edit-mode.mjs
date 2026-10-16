// Polygon Edit Mode on one scene object: welded kernel, Blender-rule component
// selection, picking through the object's actual transform, box select with
// occlusion (or x-ray through), and an overlay that rides on the edited mesh.
// Keys and pointer wiring belong to the host; every operation here is callable
// the same way by a hand-driven handler or an agent.
import {BufferGeometry,DoubleSide,Float32BufferAttribute,Uint32BufferAttribute,Group,LineBasicMaterial,LineSegments,Matrix4,Mesh,MeshBasicMaterial,Points,PointsMaterial,Ray,Vector3} from './lib/three.core.js';
import {MeshBVH} from './node_modules/three-mesh-bvh/build/index.module.js';
import {buildPolyMesh,NO_EDGE} from './poly-mesh-core.mjs';
import {createComponentSelection,setSelectMode,clickComponent,selectAll,boxSelect,selectLinkedComponents,selectionCounts} from './poly-selection.mjs';

// Wire reads on dark baked textures as well as light ones; selection is Blender's orange.
const SELECTED=0xff9a1f,WIRE=0xb8c2d6;
function compact(attribute,width){
  if(!attribute)return null;
  // Plain float attributes copy as they lie; interleaved or normalized ones go through the accessors.
  if(!attribute.isInterleavedBufferAttribute&&!attribute.normalized&&attribute.itemSize===width&&attribute.array instanceof Float32Array)return attribute.array.slice(0,attribute.count*width);
  const out=new Float32Array(attribute.count*width),get=['getX','getY','getZ'];
  for(let i=0;i<attribute.count;i++)for(let k=0;k<width;k++)out[i*width+k]=attribute[get[k]](i);
  return out;
}
// Edges where the material changes: Select Linked stops there, so a cut cap selects on its own.
function materialBarrier(kernel,faceMaterial){
  const barrier=new Uint8Array(kernel.edgeCount);
  for(let e=0;e<kernel.edgeCount;e++){
    const first=faceMaterial[kernel.edgeCorners[kernel.edgeFaceOffsets[e]]/3|0];
    for(let i=kernel.edgeFaceOffsets[e]+1;i<kernel.edgeFaceOffsets[e+1];i++)if(faceMaterial[kernel.edgeCorners[i]/3|0]!==first){barrier[e]=1;break;}
  }
  return barrier;
}
function triangleMeshes(root){const found=[];root.traverse(o=>{if(o.isMesh&&o.geometry?.attributes?.position)found.push(o);});return found;}
// Every primitive of the object edits as one face set, in order, each with its own block of
// vertices: the same order the GLB side merges primitives in, so face indices agree.
function mergedArrays(meshes){
  const materials=[...new Set(meshes.map(m=>m.material))];
  const parts=meshes.map(m=>{const g=m.geometry,count=g.attributes.position.count;return {positions:compact(g.attributes.position,3),normals:compact(g.attributes.normal,3),uvs:compact(g.attributes.uv,2),indices:g.index?Uint32Array.from(g.index.array):Uint32Array.from({length:count},(_,i)=>i),count};});
  const join=key=>{if(!parts.every(p=>p[key]))return null;if(parts.length===1)return parts[0][key];const out=new Float32Array(parts.reduce((n,p)=>n+p[key].length,0));let at=0;for(const p of parts){out.set(p[key],at);at+=p[key].length;}return out;};
  const indices=new Uint32Array(parts.reduce((n,p)=>n+p.indices.length,0)),faceMaterial=new Uint8Array(indices.length/3);
  for(let i=0,at=0,base=0;i<parts.length;i++){const p=parts[i];for(let k=0;k<p.indices.length;k++)indices[at+k]=p.indices[k]+base;faceMaterial.fill(materials.indexOf(meshes[i].material),at/3,(at+p.indices.length)/3);at+=p.indices.length;base+=p.count;}
  return {positions:join('positions'),normals:join('normals'),uvs:join('uvs'),indices,faceMaterial,materialCount:materials.length};
}

// Prepared editing data per geometry, so Tab back into an object is immediate. Keyed by the
// first primitive's geometry and checked against every primitive's attribute versions, so an
// in-place geometry change (winding, normals, debris tools) prepares it afresh.
const prepared=new WeakMap();
const geometryVersions=meshes=>meshes.map(m=>{const g=m.geometry;return [g.id,...Object.values(g.attributes).map(a=>a.version),g.index?.version??-1].join(':');}).join('|')+'|'+meshes.map(m=>[m.material].flat().map(x=>x.id).join(',')).join('|');
function prepare(meshes){
  const key=meshes[0].geometry,versions=geometryVersions(meshes),cached=prepared.get(key);
  if(cached?.versions===versions)return cached;
  const arrays=mergedArrays(meshes),kernel=buildPolyMesh(arrays),q=kernel.vertexPositions,wirePositions=new Float32Array(kernel.edgeCount*6);
  for(let e=0;e<kernel.edgeCount;e++){const a=3*kernel.edgeVertices[2*e],b=3*kernel.edgeVertices[2*e+1];wirePositions[6*e]=q[a];wirePositions[6*e+1]=q[a+1];wirePositions[6*e+2]=q[a+2];wirePositions[6*e+3]=q[b];wirePositions[6*e+4]=q[b+1];wirePositions[6*e+5]=q[b+2];}
  const entry={versions,arrays,kernel,wirePositions,barrier:arrays.materialCount>1?materialBarrier(kernel,arrays.faceMaterial):null,bvh:null};
  // Picking structure on first use, not on Tab: the first click, box or L pays for it once.
  entry.picking=()=>{if(!entry.bvh){const picking=new BufferGeometry();picking.setAttribute('position',new Float32BufferAttribute(arrays.positions,3));picking.setIndex(new Uint32BufferAttribute(arrays.indices,1));entry.bvh=new MeshBVH(picking,{indirect:true});}return entry.bvh;};
  prepared.set(key,entry);return entry;
}

export function createPolyEditMode({camera,canvas,onChange=()=>{}}) {
  let edit=null;
  const need=()=>{if(!edit)throw Error('Not in Edit Mode: select a mesh and press Tab');return edit;};
  // `editing` says whether Edit Mode is on; `active` is the active component, as in Blender.
  const state=()=>edit?{editing:true,objectId:edit.objectId,mode:edit.selection.mode,counts:selectionCounts(edit.selection),active:edit.selection.active,through:edit.through}:{editing:false};
  const result=state;

  function rebuildOverlay(){
    const {mesh,overlay,selection,kernel}=edit,q=kernel.vertexPositions;
    for(const child of [...overlay.children])if(child.userData.polySelection){overlay.remove(child);child.geometry.dispose();child.material.dispose();}
    const add=object=>{object.userData.polySelection=true;object.renderOrder=3;overlay.add(object);};
    // Typed arrays sized by count: this runs on every selection change.
    const count=flags=>{let n=0;for(let i=0;i<flags.length;i++)if(flags[i])n++;return n;};
    const put=(out,at,v)=>{out[at]=q[3*v];out[at+1]=q[3*v+1];out[at+2]=q[3*v+2];};
    const faces=new Float32Array(count(selection.faces)*9);
    for(let f=0,at=0;f<kernel.faceCount;f++)if(selection.faces[f])for(let c=3*f;c<3*f+3;c++,at+=3)put(faces,at,kernel.cornerVertex[c]);
    if(faces.length){const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(faces,3));add(new Mesh(g,new MeshBasicMaterial({color:SELECTED,transparent:true,opacity:.35,side:DoubleSide,depthTest:!edit.through,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1})));}
    const edges=new Float32Array(count(selection.edges)*6);
    for(let e=0,at=0;e<kernel.edgeCount;e++)if(selection.edges[e]){put(edges,at,kernel.edgeVertices[2*e]);put(edges,at+3,kernel.edgeVertices[2*e+1]);at+=6;}
    if(edges.length){const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(edges,3));add(new LineSegments(g,new LineBasicMaterial({color:SELECTED,depthTest:!edit.through})));}
    const points=new Float32Array(count(selection.vertices)*3);
    for(let v=0,at=0;v<kernel.vertexCount;v++)if(selection.vertices[v]){put(points,at,v);at+=3;}
    if(points.length&&selection.mode==='vertex'){const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(points,3));add(new Points(g,new PointsMaterial({color:SELECTED,size:5,sizeAttenuation:false,depthTest:!edit.through})));}
    edit.wire.material.depthTest=!edit.through;edit.wire.material.needsUpdate=true;
    for(const {material,transparent,opacity,depthWrite} of edit.materialStates){material.transparent=edit.through||transparent;material.opacity=edit.through?.3:opacity;material.depthWrite=edit.through?false:depthWrite;material.needsUpdate=true;}
    onChange(state());
  }
  const commit=selection=>{edit.selection=selection;rebuildOverlay();return result();};

  // A world-space ray from a client point, expressed in the mesh's own frame.
  function localRay(x,y){
    const rect=canvas.getBoundingClientRect(),ndc=new Vector3((x-rect.left)/rect.width*2-1,-((y-rect.top)/rect.height)*2+1,.5);
    const origin=new Vector3().setFromMatrixPosition(camera.matrixWorld),toward=ndc.unproject(camera),direction=toward.sub(origin).normalize();
    if(camera.isOrthographicCamera){origin.set(ndc.x,ndc.y,-1).unproject(camera);direction.set(0,0,-1).transformDirection(camera.matrixWorld);}
    const inverse=new Matrix4().copy(edit.mesh.matrixWorld).invert();
    return new Ray(origin,direction).applyMatrix4(inverse);
  }
  function hitAt(x,y){const ray=localRay(x,y),hit=edit.bvh.raycastFirst(ray,DoubleSide);return hit?{face:hit.faceIndex,point:hit.point}:null;}
  function componentAt(x,y){
    const hit=hitAt(x,y);if(!hit)return null;
    const {kernel}=edit,mode=edit.selection.mode,q=kernel.vertexPositions,f=hit.face,p=hit.point;
    if(mode==='face')return {kind:'face',index:f};
    const at=v=>new Vector3(q[3*v],q[3*v+1],q[3*v+2]);
    if(mode==='vertex'){let best=null,bd=Infinity;for(let c=3*f;c<3*f+3;c++){const v=kernel.cornerVertex[c],d=at(v).distanceToSquared(p);if(d<bd){bd=d;best=v;}}return {kind:'vertex',index:best};}
    let best=null,bd=Infinity;
    for(let c=3*f;c<3*f+3;c++){const e=kernel.cornerEdge[c];if(e===NO_EDGE)continue;const a=at(kernel.edgeVertices[2*e]),b=at(kernel.edgeVertices[2*e+1]),ab=b.clone().sub(a),t=Math.max(0,Math.min(1,p.clone().sub(a).dot(ab)/ab.lengthSq())),d=a.add(ab.multiplyScalar(t)).distanceToSquared(p);if(d<bd){bd=d;best=e;}}
    return best===null?null:{kind:'edge',index:best};
  }
  function projection(){
    const {kernel,mesh}=edit,rect=canvas.getBoundingClientRect(),q=kernel.vertexPositions,projected=new Float32Array(kernel.vertexCount*2),v=new Vector3();
    for(let i=0;i<kernel.vertexCount;i++){
      v.set(q[3*i],q[3*i+1],q[3*i+2]).applyMatrix4(mesh.matrixWorld).project(camera);
      const behind=v.z<-1||v.z>1;projected[2*i]=behind?NaN:rect.left+(v.x+1)/2*rect.width;projected[2*i+1]=behind?NaN:rect.top+(1-v.y)/2*rect.height;
    }
    return projected;
  }
  // A vertex is visible when the first surface along the view ray is the vertex itself.
  function visibility(projected,rect){
    const {kernel,mesh}=edit,q=kernel.vertexPositions,visible=new Uint8Array(kernel.vertexCount);
    const inverse=new Matrix4().copy(mesh.matrixWorld).invert(),eye=new Vector3().setFromMatrixPosition(camera.matrixWorld).applyMatrix4(inverse);
    const x0=Math.min(rect.x0,rect.x1),x1=Math.max(rect.x0,rect.x1),y0=Math.min(rect.y0,rect.y1),y1=Math.max(rect.y0,rect.y1);
    for(let i=0;i<kernel.vertexCount;i++){
      const x=projected[2*i],y=projected[2*i+1];if(!(x>=x0&&x<=x1&&y>=y0&&y<=y1))continue;
      const target=new Vector3(q[3*i],q[3*i+1],q[3*i+2]),direction=target.clone().sub(eye),distance=direction.length();direction.normalize();
      const hit=edit.bvh.raycastFirst(new Ray(eye.clone(),direction),DoubleSide);
      visible[i]=!hit||hit.distance>=distance*(1-1e-4)?1:0;
    }
    return visible;
  }

  return {
    active:()=>!!edit,
    read:()=>result(),
    enter(object,{objectId=null}={}){
      if(edit)this.exit();
      const meshes=triangleMeshes(object);if(!meshes.length)throw Error('Edit Mode needs an object with a triangle mesh');
      const mesh=meshes[0];object.updateMatrixWorld(true);
      if(meshes.some(m=>!m.matrixWorld.equals(mesh.matrixWorld)))throw Error('Edit Mode needs every primitive of the mesh to share one placement');
      const ready=prepare(meshes),{arrays,kernel,wirePositions}=ready,overlay=new Group();overlay.name='Edit Mode';overlay.userData.kaminosEditorHelper=true;
      const wireGeometry=new BufferGeometry();wireGeometry.setAttribute('position',new Float32BufferAttribute(wirePositions,3));
      const wire=new LineSegments(wireGeometry,new LineBasicMaterial({color:WIRE,transparent:true,opacity:.28}));wire.renderOrder=2;overlay.add(wire);mesh.add(overlay);
      const materialStates=meshes.flatMap(m=>[m.material].flat()).map(material=>({material,transparent:material.transparent,opacity:material.opacity,depthWrite:material.depthWrite}));
      edit={object,mesh,objectId,arrays,kernel,barrier:ready.barrier,get bvh(){return ready.picking();},overlay,wire,through:false,selection:createComponentSelection(kernel),materialStates};
      rebuildOverlay();return result();
    },
    exit(){
      if(!edit)return {editing:false};
      const {mesh,overlay,materialStates}=edit;mesh.remove(overlay);
      overlay.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
      for(const {material,...state} of materialStates){Object.assign(material,state);material.needsUpdate=true;}
      edit=null;onChange({editing:false});return {editing:false};
    },
    setMode(mode){need();return commit(setSelectMode(edit.selection,edit.kernel,mode));},
    pickAt(x,y){need();return componentAt(x,y);},
    click(x,y,{extend=false}={}){
      need();const component=componentAt(x,y);
      if(!component)return extend?result():commit(selectAll(edit.selection,edit.kernel,'deselect'));
      return commit(clickComponent(edit.selection,edit.kernel,component,{extend}));
    },
    selectAll(action='toggle'){need();return commit(selectAll(edit.selection,edit.kernel,action));},
    box(rect,{mode='set'}={}){
      need();const projected=projection(),visible=edit.through?new Uint8Array(edit.kernel.vertexCount).fill(1):visibility(projected,rect);
      return commit(boxSelect(edit.selection,edit.kernel,{projected,visible,rect,through:edit.through,mode}));
    },
    linked({at=null}={}){
      need();
      if(at){
        // L adds what is under the cursor and grows from it; it never toggles that component off.
        const component=componentAt(at.x,at.y);if(!component)return result();
        const field={vertex:'vertices',edge:'edges',face:'faces'}[component.kind];
        const seed=edit.selection[field][component.index]?edit.selection:clickComponent(edit.selection,edit.kernel,component,{extend:true});
        return commit(selectLinkedComponents(seed,edit.kernel,{barrier:edit.barrier}));
      }
      return commit(selectLinkedComponents(edit.selection,edit.kernel,{barrier:edit.barrier}));
    },
    setThrough(on){need();if(typeof on!=='boolean')throw Error('X-ray must be true or false');edit.through=on;rebuildOverlay();return result();},
    selection:()=>need().selection,
    kernel:()=>need().kernel,
    // Slice's plane: through the drawn line and along the view, in the mesh's own frame.
    planeFromLine(x0,y0,x1,y1){
      need();if(Math.hypot(x1-x0,y1-y0)<8)throw Error('Draw a longer line to slice along');
      const a=localRay(x0,y0),b=localRay(x1,y1),p1=a.origin.clone().add(a.direction),p2=b.origin.clone().add(b.direction);
      const normal=p1.sub(a.origin).cross(p2.sub(a.origin)).normalize();
      return {point:a.origin.toArray(),normal:normal.toArray()};
    },
    // Where Origin to Selection puts the pivot: the median of the selected vertices, in the mesh frame.
    selectionMedian(){
      const {selection,kernel}=need(),q=kernel.vertexPositions,sum=[0,0,0];let n=0;
      for(let v=0;v<kernel.vertexCount;v++)if(selection.vertices[v]){for(let k=0;k<3;k++)sum[k]+=q[3*v+k];n++;}
      if(!n)throw Error('Select something to put the origin on');
      return sum.map(x=>x/n);
    },
    // What Separate needs: the selected faces, and the triangles they were selected on.
    selectedFaceMask:()=>Uint8Array.from(need().selection.faces),
    geometry(){const {positions,indices}=need().arrays;return {positions,indices};},
    selectedVertices(){const s=need().selection.vertices;return [...s.keys()].filter(i=>s[i]);},
    vertexPosition(v){const q=need().kernel.vertexPositions;return [q[3*v],q[3*v+1],q[3*v+2]];},
    screenOf(point){
      need();const rect=canvas.getBoundingClientRect(),v=new Vector3(...point).applyMatrix4(edit.mesh.matrixWorld).project(camera);
      return {x:rect.left+(v.x+1)/2*rect.width,y:rect.top+(1-v.y)/2*rect.height,inView:v.z>=-1&&v.z<=1};
    },
  };
}
