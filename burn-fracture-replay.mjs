import * as THREE from './lib/three.webgpu.js';
import {createLogSurfaceMask} from './live-log-surface-mask.mjs';
import {LOG_RESIDUE} from './log-consumption.mjs';
import {createBurnMaterial} from './burn-table-material.mjs';
import {createCoarseSurfaceMesh} from './fracture-coarse-surface.mjs';

export function readBurnReplay(raw,replayMatrix){
 const snapshot=raw?.snapshot??(raw?.snapshots?.length===1?raw.snapshots[0]:null);
 if(snapshot?.identity!=='frozen-material-residue-snapshot-v1'||snapshot?.read?.identity!=='finite-wood-residue-v1')throw Error('Observed complete frozen material snapshot required');
 const {material,initial}=snapshot,n=Math.cbrt(initial?.length);
 if(!Number.isInteger(n)||n<1||material?.length!==initial.length*8||!material.every(Number.isFinite)||!initial.every(x=>x===0||x===1))throw Error('Complete finite material and initial occupancy required');
 const recordedMatrix=snapshot.read.sourceWorld,matrix=replayMatrix??recordedMatrix;
 for(const frame of [recordedMatrix,matrix])if(!Array.isArray(frame)||frame.length!==16||!frame.every(Number.isFinite)||new THREE.Matrix4().fromArray(frame).determinant()===0)throw Error('Finite invertible recorded and replay coordinate frames required');
 return {snapshot,n,matrix:[...matrix],recordedMatrix:[...recordedMatrix],steps:snapshot.read.steps,sourceAuthority:'retained-native-material-observation',evolvedMaterial:false};
}

export function createBurnReplayField({renderer,mesh,raw,replayMatrix}){
 const input=readBurnReplay(raw,replayMatrix),{snapshot,n}=input,device=renderer.backend.device,owned=[];
 mesh.geometry.computeBoundingBox();const bounds=mesh.geometry.boundingBox.clone(),size=bounds.getSize(new THREE.Vector3()),observed=Uint32Array.from(snapshot.initial);
 const computed=createLogSurfaceMask(mesh.geometry,bounds,n,{filled:true});
 if(computed.some((v,i)=>v!==observed[i]))throw Error('Imported source geometry does not reproduce the observed material occupancy');
 const buffer=device.createBuffer({label:'Observed original burn material',size:snapshot.material.length*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});owned.push(buffer);device.queue.writeBuffer(buffer,0,Float32Array.from(snapshot.material));
 const texture=device.createTexture({label:'Frozen observed burn appearance',dimension:'3d',size:[n,n,n],format:'rgba16float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});owned.push(texture);
 const pixels=new Uint16Array(n**3*4);for(let i=0;i<n**3;i++){for(let j=0;j<3;j++)pixels[i*4+j]=THREE.DataUtils.toHalfFloat(snapshot.material[i*8+j]);pixels[i*4+3]=snapshot.material[i*8+5]>LOG_RESIDUE+1e-6?0x3c00:0;}
 device.queue.writeTexture({texture},pixels,{bytesPerRow:n*8,rowsPerImage:n},[n,n,n]);
 const wrapper=new THREE.ExternalTexture(texture);wrapper.is3DTexture=true;wrapper.image={width:n,height:n,depth:n};wrapper.type=THREE.HalfFloatType;wrapper.format=THREE.RGBAFormat;wrapper.colorSpace=THREE.NoColorSpace;wrapper.minFilter=wrapper.magFilter=THREE.LinearFilter;
 const uv=THREE.TSL.positionGeometry.sub(THREE.TSL.vec3(...bounds.min.toArray())).div(THREE.TSL.vec3(...size.toArray())),stateNode=THREE.TSL.texture3D(wrapper,uv);
 return {device,texture,stateNode,input,
  residentState:()=>({mesh,bounds,dimensions:[n,n,n],initial:observed,after:buffer}),
  dispose(){delete renderer.backend.get(wrapper).texture;wrapper.dispose();for(const x of owned)x.destroy();},
 };
}

export function replayRegionMasses(prepared,field){
 return replayRegionBodies(prepared,field,1).masses;
}

export function replayRegionBodies(prepared,field,density){
 if(!Number.isFinite(density)||density<=0)throw Error('Positive material density required');
 const {bounds,dimensions,initial}=field.residentState(),n=dimensions[0],size=bounds.getSize(new THREE.Vector3()).toArray(),lo=bounds.min.toArray(),material=field.input.snapshot.material;
 const total=new Uint32Array(prepared.cells.length),remaining=new Float64Array(total.length);
 const contact=prepared.cells.map(()=>({min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]}));
 for(let i=0;i<initial.length;i++)if(initial[i]){
  const point=[i%n,Math.floor(i/n)%n,Math.floor(i/(n*n))].map((v,k)=>lo[k]+(v+.5)*size[k]/n);
  let region=0,best=Infinity;for(const p of prepared.pieces){const d=point.reduce((sum,v,k)=>sum+Math.max(p.bounds.min[k]-v,0,v-p.bounds.max[k])**2,0);if(d<best){best=d;region=p.index;}}
  total[region]++;const fuel=material[i*8+5];if(fuel>LOG_RESIDUE+1e-6){remaining[region]+=fuel;
   for(let k=0;k<3;k++){contact[region].min[k]=Math.min(contact[region].min[k],point[k]-.5*size[k]/n);contact[region].max[k]=Math.max(contact[region].max[k],point[k]+.5*size[k]/n);}
  }
 }
 const masses=prepared.cells.map((c,i)=>density*c.volume*(total[i]?remaining[i]/total[i]:1));
 const cells=prepared.cells.map((c,i)=>remaining[i]>0?{...c,position:contact[i].min.map((v,k)=>(v+contact[i].max[k])/2),halfExtents:contact[i].min.map((v,k)=>(contact[i].max[k]-v)/2)}:c);
 const bonds=prepared.bonds.map(b=>({...b,anchorA:b.anchorA.map((v,k)=>v+prepared.cells[b.a].position[k]-cells[b.a].position[k]),anchorB:b.anchorB.map((v,k)=>v+prepared.cells[b.b].position[k]-cells[b.b].position[k])}));
 return {masses,prepared:{...prepared,cells,bonds},contactModel:'surviving-material-aabb-no-cavity-contact',massModel:'frozen-region-mean-fuel-density-box-inertia',unmapped:prepared.cells.filter((_,i)=>!total[i]).map(c=>c.index)};
}

export function createBurnFractureSurface({renderer,prepared,materials,field,dynamics}){
 const vertices=prepared.pieces.reduce((s,p)=>s+p.arrays.positions.length/3,0),faces=prepared.pieces.reduce((s,p)=>s+p.arrays.indices.length/3,0);
 const arrays={positions:new Float32Array(vertices*3),normals:new Float32Array(vertices*3),uvs:new Float32Array(vertices*2),indices:new Uint32Array(faces*3),faceMaterial:new Uint8Array(faces)},owners=new Float32Array(vertices);
 let v=0,f=0;for(const p of prepared.pieces){const a=p.arrays;arrays.positions.set(a.positions,v*3);arrays.normals.set(a.normals,v*3);arrays.uvs.set(a.uvs,v*2);owners.fill(p.index,v,v+a.positions.length/3);
  for(let i=0;i<a.indices.length;i++)arrays.indices[f*3+i]=a.indices[i]+v;arrays.faceMaterial.set(a.faceMaterial,f);v+=a.positions.length/3;f+=a.indices.length/3;
 }
 const cap=new THREE.MeshStandardMaterial({color:0x18120d,roughness:.75}),original=[...materials];original[prepared.capMaterial]=cap;
 const {bounds}=field.residentState(),bindings=original.map(material=>createBurnMaterial({renderer,original:material,bounds,settings:{heat:0,char:0,reaction:0},stateNode:field.stateNode,stateIdentity:'retained-native-material-observation',presenceNode:field.stateNode.w}));
 const {textureLoad,ivec2,attribute,mat4,mat3,vec4,positionGeometry,normalGeometry,transformNormalToView}=THREE.TSL,region=attribute('burnPiece','float').toInt();
 const pose=mat4(...[0,1,2,3].map(col=>textureLoad(dynamics.wrapper,ivec2(col,region))));
 for(const binding of bindings){binding.material.positionNode=pose.mul(vec4(positionGeometry,1)).xyz;binding.material.normalNode=transformNormalToView(mat3(pose).mul(normalGeometry)).normalize();}
 const mesh=createCoarseSurfaceMesh(arrays,bindings.map(b=>b.material));mesh.geometry.setAttribute('burnPiece',new THREE.Float32BufferAttribute(owners,1));mesh.frustumCulled=false;mesh.castShadow=false;mesh.name='Burned material regions';
 return {mesh,read:()=>({exteriorTriangles:prepared.receipt.sourceTriangles,renderedTriangles:faces,regions:prepared.cells.length,pose:'resident-matrix-texture',runtimeReadbacks:0,lighting:'ordinary-surface-no-dynamic-shadow-proxy'}),
  dispose(){mesh.removeFromParent();mesh.geometry.dispose();for(const b of bindings)b.dispose();cap.dispose();}};
}
