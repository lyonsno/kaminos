import {Vector3,Matrix3,Matrix4,BufferGeometry,Float32BufferAttribute,Mesh} from './lib/three.core.js';
export function collectFractureSurface(root){
 root.updateWorldMatrix(true,true);const inverse=root.matrixWorld.clone().invert(),positions=[],normals=[],uvs=[],indices=[],faceMaterial=[],materials=[],meshes=[];
 const materialId=m=>{let id=materials.indexOf(m);if(id<0){id=materials.length;materials.push(m);}if(id>254)throw Error('Surface cutter material storage supports at most 255 source materials');return id;};
 root.traverse(mesh=>{
  if(!mesh.isMesh)return;if(mesh.isSkinnedMesh||mesh.isInstancedMesh||mesh.morphTargetInfluences?.length)throw Error('Coarse fracture requires static ordinary triangle meshes');
  meshes.push(mesh);const g=mesh.geometry,p=g.getAttribute('position'),n=g.getAttribute('normal'),uv=g.getAttribute('uv'),ix=g.getIndex(),count=ix?.count??p.count,base=positions.length/3,matrix=new Matrix4().multiplyMatrices(inverse,mesh.matrixWorld),normal=new Matrix3().getNormalMatrix(matrix);
  if(count%3)throw Error('Source triangle attributes are incomplete');
  for(let i=0;i<p.count;i++){positions.push(...new Vector3().fromBufferAttribute(p,i).applyMatrix4(matrix).toArray());normals.push(...(n?new Vector3().fromBufferAttribute(n,i).applyNormalMatrix(normal).toArray():[0,0,0]));uvs.push(uv?uv.getX(i):0,uv?uv.getY(i):0);}
  for(let f=0;f<count/3;f++){for(let c=0;c<3;c++)indices.push(base+(ix?ix.getX(f*3+c):f*3+c));const group=g.groups.find(x=>f*3>=x.start&&f*3<x.start+x.count);const m=Array.isArray(mesh.material)?mesh.material[group?.materialIndex??0]:mesh.material;faceMaterial.push(materialId(m));}
 });
 if(!indices.length)throw Error('No static triangle surface');
 return {arrays:{positions:Float32Array.from(positions),normals:Float32Array.from(normals),uvs:Float32Array.from(uvs),indices:Uint32Array.from(indices),faceMaterial:Uint8Array.from(faceMaterial)},materials,meshes};
}
export function createCoarseSurfaceMesh(arrays,materials,center=[0,0,0]){
 const g=new BufferGeometry(),p=arrays.positions.slice();for(let i=0;i<p.length;i++)p[i]-=center[i%3];
 g.setAttribute('position',new Float32BufferAttribute(p,3));if(arrays.normals)g.setAttribute('normal',new Float32BufferAttribute(arrays.normals,3));else g.computeVertexNormals();if(arrays.uvs)g.setAttribute('uv',new Float32BufferAttribute(arrays.uvs,2));g.setIndex(Array.from(arrays.indices));
 let material=-1,start=0;for(let f=0;f<=arrays.indices.length/3;f++){const next=f<arrays.indices.length/3?arrays.faceMaterial[f]:-1;if(next!==material){if(material>=0)g.addGroup(start*3,(f-start)*3,material);material=next;start=f;}}
 g.computeBoundingBox();g.computeBoundingSphere();const mesh=new Mesh(g,materials);mesh.position.fromArray(center);mesh.castShadow=true;mesh.receiveShadow=true;return mesh;
}
export function coarseFixture(prepared,{strength=200}={}){
 if(!(strength>0&&Number.isFinite(strength)))throw Error('Positive finite cohesion required');
 const {area,center,normal}=prepared.interface,cells=prepared.pieces.map((p,index)=>({index,id:`coarse:${index}`,pinned:index===0,position:p.center,halfExtents:p.halfExtents,mass:index===0?0:p.volume,volume:p.volume,column:index,row:0,layer:0}));
 return {cells,bonds:[{id:'coarse-interface:0',a:0,b:1,area,normal,anchorA:center.map((v,k)=>v-cells[0].position[k]),anchorB:center.map((v,k)=>v-cells[1].position[k])}],dimensions:{dx:Math.min(...cells.map(c=>c.halfExtents[0]*2)),dy:Math.min(...cells.map(c=>c.halfExtents[1]*2)),dz:Math.min(...cells.map(c=>c.halfExtents[2]*2))},floorY:Math.min(...cells.map(c=>c.position[1]-c.halfExtents[1]))-10,config:{gravity:0,timeStep:1/60,substeps:1,solverIterations:20,stiffness:10000,strength,friction:0,gripStiffness:250,gripRadius:0,initialJointPenalty:10000,gravityRampSeconds:0,preventPenetratingNormalDropout:true}};
}
