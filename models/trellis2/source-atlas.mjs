// The exercised source-xatlas repair, with the unchanged shipped-worker normal
// basis. This is explicit CPU finishing, never a model or UV-route fallback.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {NodeTrellisUVWorker} from './node-uv-worker.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
async function readArray(root,row,Type){
  if(!row||typeof row.file!=='string'||path.basename(row.file)!==row.file)throw Error('identified atlas array required');
  const bytes=await fs.readFile(path.join(root,row.file));
  if(bytes.length!==row.byteLength||bytes.length%4||hash(bytes)!==row.sha256)throw Error('changed atlas array '+row.file);
  return new Type(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
}
async function workerNormals(mesh){
  const source=new URL('../../lib/sf3d/assets/uv_unwrap_worker-29CGZ7RB.js',import.meta.url),
    worker=new NodeTrellisUVWorker(source),id=randomUUID(),vertices=mesh.vertices.slice(),faces=mesh.triangles.slice();
  try{
    const reply=await new Promise((resolve,reject)=>{
      worker.onmessage=({data})=>data?.id===id&&data.ok===true?resolve(data):reject(Error('complete matching normal-worker reply required'));
      worker.onerror=e=>reject(Error(e.message));worker.onmessageerror=()=>reject(Error('normal-worker reply decoding failed'));
      worker.postMessage({id,vertices:vertices.buffer,faces:faces.buffer,numVertices:vertices.length/3,numFaces:faces.length/3},
        [vertices.buffer,faces.buffer]);
    });
    if(!Number.isSafeInteger(reply.newNumVertices)||reply.newNumVertices<1||reply.newNumFaces!==mesh.triangles.length/3)
      throw Error('complete normal-worker surface required');
    const read=(name,Type,count)=>{
      if(!(reply[name] instanceof ArrayBuffer)||reply[name].byteLength!==count*4)throw Error('complete worker '+name+' required');
      return new Type(reply[name]);
    };
    const v=read('newVertices',Float32Array,reply.newNumVertices*3),n=read('newNormals',Float32Array,reply.newNumVertices*3),
      f=read('newFaces',Uint32Array,reply.newNumFaces*3);
    if(!v.every(Number.isFinite)||!n.every(Number.isFinite)||!f.every(i=>i<reply.newNumVertices))throw Error('finite normal-worker geometry required');
    // Preserve the already exercised encoder's exact unit normalization.
    for(let i=0;i<n.length;i+=3){const length=Math.hypot(n[i],n[i+1],n[i+2]);
      if(length)for(let a=0;a<3;a++)n[i+a]/=length;else n[i+2]=1;}
    return {vertices:v,normals:n,triangles:f,sourceSha256:hash(await fs.readFile(source))};
  }finally{await worker.terminate();}
}
export function createSourceAtlasUnwrapper({python,sourceRoot,expectedSourceCommit,cleanRoot,out}={}){
  for(const value of [python,sourceRoot,expectedSourceCommit,cleanRoot,out])if(typeof value!=='string'||!value)
    throw Error('explicit source-atlas paths and source revision required');
  return async mesh=>{
    await fs.mkdir(out,{recursive:true});
    const args=['-B',fileURLToPath(new URL('./unwrap-retained-mesh.py',import.meta.url)),'--source-root',sourceRoot,
      '--expected-source-commit',expectedSourceCommit,'--clean-root',cleanRoot,'--out',out];
    const stdout=await fs.open(path.join(out,'stdout.log'),'w'),stderr=await fs.open(path.join(out,'stderr.log'),'w');
    let code;
    try{const child=spawn(python,args,{stdio:['ignore',stdout.fd,stderr.fd],env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
      code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
    }finally{await stdout.close();await stderr.close();}
    const raw=await fs.readFile(path.join(out,'report.json')),r=JSON.parse(raw),clean=await fs.readFile(path.join(cleanRoot,'report.json'));
    if(code!==0||r.status!=='succeeded'||r.source?.commit!==expectedSourceCommit||r.source.dirty||
      r.cleanReportSha256!==hash(clean)||r.completeTrianglePositionsUnchanged!==true||r.fixWinding!==false)
      throw Error('identified source atlas failed: '+(r.error?.message??r.status));
    const sv=await readArray(out,r.arrays.vertices,Float32Array),sf=await readArray(out,r.arrays.triangles,Uint32Array),
      su=await readArray(out,r.arrays.uvs,Float32Array),basis=await workerNormals(mesh);
    if(sf.length!==mesh.triangles.length||su.length!==sv.length/3*2||!sf.every(i=>i<sv.length/3)||
      !su.every(v=>Number.isFinite(v)&&v>=0&&v<=1))throw Error('complete source-atlas surface required');
    const vertices=new Float32Array(sf.length*3),normals=new Float32Array(sf.length*3),
      uvs=new Float32Array(sf.length*2),triangles=new Uint32Array(sf.length);
    for(let i=0;i<sf.length;i++){
      triangles[i]=i;
      for(let a=0;a<3;a++){
        const value=sv[sf[i]*3+a];
        if(value!==mesh.vertices[mesh.triangles[i]*3+a]||value!==basis.vertices[basis.triangles[i]*3+a])
          throw Error('source atlas/normal worker changed ordered geometry');
        vertices[i*3+a]=value;normals[i*3+a]=basis.normals[basis.triangles[i]*3+a];
      }
      uvs[i*2]=su[sf[i]*2]*.9;uvs[i*2+1]=su[sf[i]*2+1];
    }
    const collapsed=[];
    for(let face=0;face<sf.length/3;face++){
      const a=face*6,b=a+2,c=a+4;
      if((uvs[b]-uvs[a])*(uvs[c+1]-uvs[a+1])-(uvs[b+1]-uvs[a+1])*(uvs[c]-uvs[a])===0)collapsed.push(face);
    }
    const cols=collapsed.length?Math.ceil(Math.sqrt(collapsed.length*.1)):0,rows=cols?Math.ceil(collapsed.length/cols):0;
    for(let i=0;i<collapsed.length;i++){
      const col=i%cols,row=Math.floor(i/cols),u0=.9+.1*(col+.1)/cols,u1=.9+.1*(col+.9)/cols,
        v0=(row+.1)/rows,v1=(row+.9)/rows;
      uvs.set([u0,v0,u1,v0,u0,v1],collapsed[i]*6);
    }
    return {vertices,triangles,normals,uvs,metadata:mesh.metadata,
      uvMetadata:{route:'source xatlas + explicit isolated charts for collapsed atlas faces',source:r.source,
        sourceReportSha256:hash(raw),normalWorkerSha256:basis.sourceSha256,xatlasVersion:r.xatlasVersion,
        fixWinding:false,maxIterations:0,reservedStripFraction:.1,repairedFaces:collapsed.length,grid:[cols,rows],
        orderedTrianglePositionsUnchanged:true,deindexedForIndependentFaceUV:true}};
  };
}
