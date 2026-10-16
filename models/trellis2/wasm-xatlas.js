// Browser UV provider for finishTrellisMesh: xatlas 0.0.11 (vendor/xatlas) with
// the TRELLIS2MLX finisher's options, then the same post-steps as the server
// source-atlas route: per-face de-indexing, a reserved 10% strip with
// isolated charts for collapsed atlas faces, and the source's post-UV normal
// law (trimesh vertex_normals on the export frame, mapped back to model frame).
import xatlasFactory from './vendor/xatlas/xatlas-0.0.11.mjs';
import {fma} from './mesh-simplify.js';
import {admitSignal,abortError,runFinishingWorker} from './finishing-worker.js';

export const WASM_XATLAS_ROUTE='xatlas 0.0.11 Wasm + explicit isolated charts for collapsed atlas faces';

let modulePromise=null;
const loadXatlas=()=>modulePromise??=xatlasFactory();

// One xatlas run; returns per-UV-vertex positions source index, UVs and faces.
export async function unwrapWithXatlas(vertices,triangles){
  if(!(vertices instanceof Float32Array)||!(triangles instanceof Uint32Array))throw TypeError('F32 vertices and U32 triangles required');
  return unwrapWithXatlasModule(await loadXatlas(),vertices,triangles);
}
// The same run on a given module instance.
export async function unwrapWithXatlasModule(M,vertices,triangles){
  if(!(vertices instanceof Float32Array)||!(triangles instanceof Uint32Array))throw TypeError('F32 vertices and U32 triangles required');
  // Wasm addresses are unsigned: index the heaps with >>> so buffers above 2 GiB work.
  const pv=M._malloc(vertices.byteLength),pi=M._malloc(triangles.byteLength);
  try{
    M.HEAPF32.set(vertices,pv>>>2);M.HEAPU32.set(triangles,pi>>>2);
    const n=M._xa_unwrap(pv,vertices.length/3,pi,triangles.length);
    if(n<0)throw Error('xatlas AddMesh refused the surface (error '+(-1-n)+')');
    const ni=M._xa_index_count(),pu=M._malloc(n*8),px=M._malloc(n*4),pf=M._malloc(ni*4);
    try{
      M._xa_read(pu,px,pf);
      return {uvs:M.HEAPF32.slice(pu>>>2,(pu>>>2)+n*2),xref:M.HEAPU32.slice(px>>>2,(px>>>2)+n),faces:M.HEAPU32.slice(pf>>>2,(pf>>>2)+ni),
        charts:M._xa_charts(),width:M._xa_width(),height:M._xa_height()};
    }finally{M._free(pu);M._free(px);M._free(pf);M._xa_release();}
  }finally{M._free(pv);M._free(pi);}
}

// trimesh 5.1.1 Trimesh(export_verts, faces).vertex_normals: angle-weighted unit
// face normals summed per vertex, then unitized (reciprocal-multiply as trimesh).
// Calibrated on the bear against trimesh/numpy/scipy (arm64): row norms sum as
// (x*x + y*y) + z*z, and the sparse per-vertex sums fuse each multiply-add in
// face order (scipy's compiled mat-vec). Angles use the engine's acos, which can
// differ from the platform libm in the last bit; agreement is measured, not exact.
const TOL_ZERO=1e-13,TOL_MERGE=1e-8; // trimesh util.TOL_ZERO, constants.tol.merge
function unitize3(x,y,z,threshold=TOL_ZERO){
  const norm=Math.sqrt((x*x+y*y)+z*z);if(!(norm>threshold))return [x*norm,y*norm,z*norm,false];
  const r=norm**-1;return [x*r,y*r,z*r,true];
}
export function trimeshVertexNormals(positions,faces){
  const nv=positions.length/3,summed=new Float64Array(nv*3),P=i=>[positions[i*3],positions[i*3+1],positions[i*3+2]];
  for(let f=0;f<faces.length/3;f++){
    const ia=faces[f*3],ib=faces[f*3+1],ic=faces[f*3+2],a=P(ia),b=P(ib),c=P(ic);
    const e0=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],e1=[c[0]-b[0],c[1]-b[1],c[2]-b[2]];
    const [nx,ny,nz,valid]=unitize3(e0[1]*e1[2]-e0[2]*e1[1],e0[2]*e1[0]-e0[0]*e1[2],e0[0]*e1[1]-e0[1]*e1[0]);
    if(!valid||!(nx*nx+ny*ny+nz*nz>.5))continue;
    const u=unitize3(b[0]-a[0],b[1]-a[1],b[2]-a[2]),v=unitize3(c[0]-a[0],c[1]-a[1],c[2]-a[2]),w=unitize3(c[0]-b[0],c[1]-b[1],c[2]-b[2]);
    const clip=x=>Math.min(1,Math.max(-1,x));
    let a0=Math.acos(clip((u[0]*v[0]+u[1]*v[1])+u[2]*v[2])),a1=Math.acos(clip((-u[0]*w[0]+-u[1]*w[1])+-u[2]*w[2])),a2=Math.PI-a0-a1;
    if(a0<TOL_MERGE||a1<TOL_MERGE||a2<TOL_MERGE)a0=a1=a2=0;
    for(const [vi,angle] of [[ia,a0],[ib,a1],[ic,a2]]){
      summed[vi*3]=fma(angle,nx,summed[vi*3]);summed[vi*3+1]=fma(angle,ny,summed[vi*3+1]);summed[vi*3+2]=fma(angle,nz,summed[vi*3+2]);}
  }
  const out=new Float64Array(nv*3);
  for(let i=0;i<nv;i++){const [x,y,z]=unitize3(summed[i*3],summed[i*3+1],summed[i*3+2]);out[i*3]=x;out[i*3+1]=y;out[i*3+2]=z;}
  return out;
}

// The whole UV step on plain arrays: shared by the calling thread and
// wasm-xatlas-worker.js so both paths run the same code.
export async function finishUVSurface(inputVertices,inputTriangles){
  const mesh={vertices:inputVertices,triangles:inputTriangles};
    const {uvs:su,xref,faces:sf,charts,width,height}=await unwrapWithXatlas(mesh.vertices,mesh.triangles);
    if(sf.length!==mesh.triangles.length)throw Error('xatlas changed the face count');
    const nv=xref.length,sv=new Float32Array(nv*3);
    for(let i=0;i<nv;i++)for(let a=0;a<3;a++)sv[i*3+a]=mesh.vertices[xref[i]*3+a];
    // Source normal basis: export frame (x, z, -y), normals mapped back as (x, -z, y).
    const exported=new Float64Array(nv*3);
    for(let i=0;i<nv;i++){exported[i*3]=sv[i*3];exported[i*3+1]=sv[i*3+2];exported[i*3+2]=-sv[i*3+1];}
    const world=trimeshVertexNormals(exported,sf),sn=new Float32Array(nv*3);
    let zeroNormals=0;
    for(let i=0;i<nv;i++){sn[i*3]=world[i*3];sn[i*3+1]=-world[i*3+2];sn[i*3+2]=world[i*3+1];if(!world[i*3]&&!world[i*3+1]&&!world[i*3+2])zeroNormals++;}
    if(!su.every(v=>Number.isFinite(v)&&v>=0&&v<=1))throw Error('finite bounded xatlas UVs required');
    const n=sf.length,vertices=new Float32Array(n*3),normals=new Float32Array(n*3),uvs=new Float32Array(n*2),triangles=new Uint32Array(n);
    for(let i=0;i<n;i++){
      triangles[i]=i;
      for(let a=0;a<3;a++){
        const value=sv[sf[i]*3+a];
        if(value!==mesh.vertices[mesh.triangles[i]*3+a])throw Error('xatlas changed ordered geometry');
        vertices[i*3+a]=value;normals[i*3+a]=sn[sf[i]*3+a];
      }
      uvs[i*2]=su[sf[i]*2]*.9;uvs[i*2+1]=su[sf[i]*2+1];
    }
    const collapsed=[];
    for(let face=0;face<n/3;face++){
      const a=face*6,b=a+2,c=a+4;
      if((uvs[b]-uvs[a])*(uvs[c+1]-uvs[a+1])-(uvs[b+1]-uvs[a+1])*(uvs[c]-uvs[a])===0)collapsed.push(face);
    }
    const cols=collapsed.length?Math.ceil(Math.sqrt(collapsed.length*.1)):0,rows=cols?Math.ceil(collapsed.length/cols):0;
    for(let i=0;i<collapsed.length;i++){
      const col=i%cols,row=Math.floor(i/cols),u0=.9+.1*(col+.1)/cols,u1=.9+.1*(col+.9)/cols,v0=(row+.1)/rows,v1=(row+.9)/rows;
      uvs.set([u0,v0,u1,v0,u0,v1],collapsed[i]*6);
    }
    return {vertices,triangles,normals,uvs,info:{charts,atlasSize:[width,height],indexedVertices:nv,
      repairedFaces:collapsed.length,grid:[cols,rows],zeroNormals}};
}

// finishTrellisMesh unwrapMesh provider. With WorkerClass the step runs in
// wasm-xatlas-worker.js; Stop (signal) terminates it with AbortError. On the
// calling thread the Wasm call cannot be interrupted, so Stop is honoured
// before and after it.
export function createWasmXatlasUnwrapper({WorkerClass,signal}={}){
  if(WorkerClass!==undefined&&typeof WorkerClass!=='function')throw TypeError('WorkerClass must be a Worker constructor');
  admitSignal(signal);
  return async mesh=>{
    const started=performance.now();let r;
    if(WorkerClass){
      const vertices=Float32Array.from(mesh.vertices),triangles=Uint32Array.from(mesh.triangles);
      const d=await runFinishingWorker({WorkerClass,url:new URL('./wasm-xatlas-worker.js',import.meta.url),signal,label:'UV',
        message:{vertices:vertices.buffer,triangles:triangles.buffer},transfer:[vertices.buffer,triangles.buffer]});
      r={vertices:new Float32Array(d.vertices),triangles:new Uint32Array(d.triangles),normals:new Float32Array(d.normals),uvs:new Float32Array(d.uvs),info:d.info};
    }else{
      if(signal?.aborted)throw abortError(signal);
      r=await finishUVSurface(mesh.vertices,mesh.triangles);
      if(signal?.aborted)throw abortError(signal);
    }
    for(let i=0;i<r.triangles.length;i++)for(let a=0;a<3;a++)
      if(r.vertices[r.triangles[i]*3+a]!==mesh.vertices[mesh.triangles[i]*3+a])throw Error('xatlas changed ordered geometry');
    const {info}=r;
    return {vertices:r.vertices,triangles:r.triangles,normals:r.normals,uvs:r.uvs,metadata:mesh.metadata,
      uvMetadata:{route:WASM_XATLAS_ROUTE,execution:WorkerClass?'module-worker':'caller-thread',xatlasVersion:'0.0.11',
        build:'vendor/xatlas (Emscripten 6.0.12, single-threaded)',
        sourceComparison:'same algorithm and options as source xatlas; atlas not byte-identical to the native wheel',
        normalBasis:{rule:'source-resume-export/Trimesh-post-UV (JS port)',frame:'model-local',zeroNormals:info.zeroNormals},
        fixWinding:false,maxIterations:0,charts:info.charts,atlasSize:info.atlasSize,indexedVertices:info.indexedVertices,reservedStripFraction:.1,
        repairedFaces:info.repairedFaces,grid:info.grid,orderedTrianglePositionsUnchanged:true,deindexedForIndependentFaceUV:true,
        elapsedSeconds:(performance.now()-started)/1000}};
  };
}
