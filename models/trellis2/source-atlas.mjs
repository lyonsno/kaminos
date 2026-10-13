// Source-xatlas plus the actual MLX resume-export normal basis. Explicit CPU
// finishing, never a model, worker-normal or UV-route fallback.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const hash=b=>createHash('sha256').update(b).digest('hex');
async function readArray(root,row,Type){
  if(!row||typeof row.file!=='string'||path.basename(row.file)!==row.file)throw Error('identified atlas array required');
  const bytes=await fs.readFile(path.join(root,row.file));
  if(bytes.length!==row.byteLength||bytes.length%4||hash(bytes)!==row.sha256)throw Error('changed atlas array '+row.file);
  return new Type(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
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
    if(r.normalBasis?.rule!=='source-resume-export/Trimesh-post-UV'||r.normalBasis.frame!=='model-local')
      throw Error('identified source post-UV normal basis required; no worker fallback');
    const sv=await readArray(out,r.arrays.vertices,Float32Array),sf=await readArray(out,r.arrays.triangles,Uint32Array),
      su=await readArray(out,r.arrays.uvs,Float32Array),sn=await readArray(out,r.arrays.normals,Float32Array);
    if(sf.length!==mesh.triangles.length||su.length!==sv.length/3*2||!sf.every(i=>i<sv.length/3)||
      !su.every(v=>Number.isFinite(v)&&v>=0&&v<=1))throw Error('complete source-atlas surface required');
    if(sn.length!==sv.length||!sn.every(Number.isFinite))throw Error('complete finite source post-UV normals required');
    const vertices=new Float32Array(sf.length*3),normals=new Float32Array(sf.length*3),
      uvs=new Float32Array(sf.length*2),triangles=new Uint32Array(sf.length);
    for(let i=0;i<sf.length;i++){
      triangles[i]=i;
      for(let a=0;a<3;a++){
        const value=sv[sf[i]*3+a];
        if(value!==mesh.vertices[mesh.triangles[i]*3+a])throw Error('source atlas changed ordered geometry');
        vertices[i*3+a]=value;normals[i*3+a]=sn[sf[i]*3+a];
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
        sourceReportSha256:hash(raw),normalBasis:r.normalBasis,xatlasVersion:r.xatlasVersion,
        fixWinding:false,maxIterations:0,reservedStripFraction:.1,repairedFaces:collapsed.length,grid:[cols,rows],
        orderedTrianglePositionsUnchanged:true,deindexedForIndependentFaceUV:true}};
  };
}
