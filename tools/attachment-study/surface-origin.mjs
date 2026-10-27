// Read-only material correspondence on retained rest/posed triangle buffers.
import * as T from '../../lib/three.core.js';
export function traceSurfacePoint({rest,posed,triangles,weights,channels,camera,ndc}){
 if(!rest?.length||rest.length%3||posed?.length!==rest.length||weights?.length!==rest.length/3*channels.length||!rest.every(Number.isFinite)||!posed.every(Number.isFinite))throw Error('Incomplete surface geometry');
 if(triangles.length%3||triangles.some(v=>!Number.isInteger(v)||v<0||v>=rest.length/3))throw Error('Invalid triangle index');
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.BufferAttribute(posed,3));geometry.setIndex(new T.BufferAttribute(triangles,1));const material=new T.MeshBasicMaterial({side:T.DoubleSide}),mesh=new T.Mesh(geometry,material),ray=new T.Raycaster();ray.setFromCamera(new T.Vector2(...ndc),camera);
 try{const hit=ray.intersectObject(mesh,false)[0];if(!hit)return null;const indices=[hit.face.a,hit.face.b,hit.face.c],at=(a,i)=>new T.Vector3().fromArray(a,i*3),bary=T.Triangle.getBarycoord(hit.point,...indices.map(i=>at(posed,i)),new T.Vector3()).toArray(),blend=a=>[0,1,2].map(k=>indices.reduce((s,v,j)=>s+bary[j]*a[v*3+k],0));return {faceIndex:hit.faceIndex,indices,barycentric:bary,rest:blend(rest),posed:blend(posed),weights:channels.map((_,k)=>indices.reduce((s,v,j)=>s+bary[j]*weights[v*channels.length+k],0))};}finally{geometry.dispose();material.dispose();}
}
export function tracePalette({manifest,boneWorld,rootMatrix}){
 const inverseGroup=new T.Matrix4().fromArray(rootMatrix).invert(),world=new Map(boneWorld.map(b=>[b.name,b.matrix])),spec=new Map(manifest.bones.map(b=>[b.name,b]));
 const matrices=[new T.Matrix4().toArray(),...manifest.channels.slice(1).map(name=>{const b=spec.get(name),w=world.get(name);if(!b||!w)throw Error('Missing actual Bone '+name);return inverseGroup.clone().multiply(new T.Matrix4().fromArray(w)).multiply(new T.Matrix4().set(...b.restMatrix.flat()).invert()).toArray();})];
 const rotationParents=[-1,...manifest.channels.slice(1).map(name=>{const parent=spec.get(name).parent,k=parent==null?0:manifest.channels.indexOf(parent);if(k<0)throw Error('Missing Bone parent');return k;})];return {matrices,rotationParents};
}
