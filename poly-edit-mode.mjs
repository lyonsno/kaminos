// Polygon Edit Mode on one scene object: welded kernel, Blender-rule component
// selection, picking through the object's actual transform, box select with
// occlusion (or x-ray through), and an overlay that rides on the edited mesh.
// Keys and pointer wiring belong to the host; every operation here is callable
// the same way by a hand-driven handler or an agent.
import {BufferGeometry,DoubleSide,Float32BufferAttribute,Group,LineBasicMaterial,LineSegments,Matrix4,Mesh,MeshBasicMaterial,Points,PointsMaterial,Ray,Vector3} from './lib/three.core.js';
import {MeshBVH} from './node_modules/three-mesh-bvh/build/index.module.js';
import {buildPolyMesh,NO_EDGE} from './poly-mesh-core.mjs';
import {createComponentSelection,setSelectMode,clickComponent,selectAll,boxSelect,selectLinkedComponents,selectionCounts} from './poly-selection.mjs';

// Wire reads on dark baked textures as well as light ones; selection is Blender's orange.
const SELECTED=0xff9a1f,WIRE=0xb8c2d6;
function compact(attribute,width){
  if(!attribute)return null;
  const out=new Float32Array(attribute.count*width),get=['getX','getY','getZ'];
  for(let i=0;i<attribute.count;i++)for(let k=0;k<width;k++)out[i*width+k]=attribute[get[k]](i);
  return out;
}
function triangleMesh(root){let found=null;root.traverse(o=>{if(!found&&o.isMesh&&o.geometry?.attributes?.position)found=o;});return found;}

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
    const faces=[];for(let f=0;f<kernel.faceCount;f++)if(selection.faces[f])for(let c=3*f;c<3*f+3;c++)faces.push(...q.subarray(3*kernel.cornerVertex[c],3*kernel.cornerVertex[c]+3));
    if(faces.length){const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(faces,3));add(new Mesh(g,new MeshBasicMaterial({color:SELECTED,transparent:true,opacity:.35,side:DoubleSide,depthTest:!edit.through,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1})));}
    const edges=[];for(let e=0;e<kernel.edgeCount;e++)if(selection.edges[e])edges.push(...q.subarray(3*kernel.edgeVertices[2*e],3*kernel.edgeVertices[2*e]+3),...q.subarray(3*kernel.edgeVertices[2*e+1],3*kernel.edgeVertices[2*e+1]+3));
    if(edges.length){const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(edges,3));add(new LineSegments(g,new LineBasicMaterial({color:SELECTED,depthTest:!edit.through})));}
    const points=[];for(let v=0;v<kernel.vertexCount;v++)if(selection.vertices[v])points.push(...q.subarray(3*v,3*v+3));
    if(points.length&&selection.mode==='vertex'){const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(points,3));add(new Points(g,new PointsMaterial({color:SELECTED,size:5,sizeAttenuation:false,depthTest:!edit.through})));}
    edit.wire.material.depthTest=!edit.through;edit.wire.material.needsUpdate=true;
    mesh.material.transparent=edit.through||edit.materialState.transparent;mesh.material.opacity=edit.through?.3:edit.materialState.opacity;mesh.material.depthWrite=edit.through?false:edit.materialState.depthWrite;mesh.material.needsUpdate=true;
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
      const mesh=triangleMesh(object);if(!mesh)throw Error('Edit Mode needs an object with a triangle mesh');
      const g=mesh.geometry,kernel=buildPolyMesh({positions:compact(g.attributes.position,3),normals:compact(g.attributes.normal,3),uvs:compact(g.attributes.uv,2),indices:g.index?Uint32Array.from(g.index.array):null});
      const bvh=new MeshBVH(g,{indirect:true}),overlay=new Group();overlay.name='Edit Mode';overlay.userData.kaminosEditorHelper=true;
      const wirePositions=new Float32Array(kernel.edgeCount*6),q=kernel.vertexPositions;
      for(let e=0;e<kernel.edgeCount;e++){wirePositions.set(q.subarray(3*kernel.edgeVertices[2*e],3*kernel.edgeVertices[2*e]+3),6*e);wirePositions.set(q.subarray(3*kernel.edgeVertices[2*e+1],3*kernel.edgeVertices[2*e+1]+3),6*e+3);}
      const wireGeometry=new BufferGeometry();wireGeometry.setAttribute('position',new Float32BufferAttribute(wirePositions,3));
      const wire=new LineSegments(wireGeometry,new LineBasicMaterial({color:WIRE,transparent:true,opacity:.28}));wire.renderOrder=2;overlay.add(wire);mesh.add(overlay);
      const m=mesh.material;
      edit={object,mesh,objectId,kernel,bvh,overlay,wire,through:false,selection:createComponentSelection(kernel),materialState:{transparent:m.transparent,opacity:m.opacity,depthWrite:m.depthWrite}};
      rebuildOverlay();return result();
    },
    exit(){
      if(!edit)return {editing:false};
      const {mesh,overlay,materialState}=edit;mesh.remove(overlay);
      overlay.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
      Object.assign(mesh.material,materialState);mesh.material.needsUpdate=true;
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
        return commit(selectLinkedComponents(seed,edit.kernel));
      }
      return commit(selectLinkedComponents(edit.selection,edit.kernel));
    },
    setThrough(on){need();if(typeof on!=='boolean')throw Error('X-ray must be true or false');edit.through=on;rebuildOverlay();return result();},
    selection:()=>need().selection,
    kernel:()=>need().kernel,
    selectedVertices(){const s=need().selection.vertices;return [...s.keys()].filter(i=>s[i]);},
    vertexPosition(v){const q=need().kernel.vertexPositions;return [q[3*v],q[3*v+1],q[3*v+2]];},
    screenOf(point){
      need();const rect=canvas.getBoundingClientRect(),v=new Vector3(...point).applyMatrix4(edit.mesh.matrixWorld).project(camera);
      return {x:rect.left+(v.x+1)/2*rect.width,y:rect.top+(1-v.y)/2*rect.height,inView:v.z>=-1&&v.z<=1};
    },
  };
}
