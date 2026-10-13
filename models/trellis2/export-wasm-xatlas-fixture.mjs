// Record expectations for the browser UV route on the simplify-route fixture's
// cleaned surface: the Wasm xatlas atlas identity (a determinism pin; xatlas
// atlases are not byte-identical across native builds) and the source finisher's
// post-UV normal law evaluated by trimesh on that same atlas.
//
// node models/trellis2/export-wasm-xatlas-fixture.mjs --python <venv python> --work <dir> [--out <json>]
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {MESH_FINISHING_CASES} from './tests/mesh-finishing-fixture.js';
import {cleanupAndSimplifyPreservingSurface} from './mesh-cleanup.js';
import {unwrapWithXatlas} from './wasm-xatlas.js';

const here=path.dirname(fileURLToPath(import.meta.url));
const args=new Map();for(let i=2;i<process.argv.length;i+=2)args.set(process.argv[i],process.argv[i+1]);
for(const key of ['--python','--work'])if(!args.get(key))throw Error(key+' required');
const out=args.get('--out')??path.join(here,'tests/fixtures/wasm-xatlas-source-normals.json'),work=path.resolve(args.get('--work'));
await fs.mkdir(work,{recursive:true});
const sha=a=>createHash('sha256').update(new Uint8Array(a.buffer,a.byteOffset,a.byteLength)).digest('hex');
const spec=MESH_FINISHING_CASES['simplify-route'],{vertices,triangles}=spec.build();
const clean=cleanupAndSimplifyPreservingSurface(vertices,triangles,{targetFaces:spec.targetFaces});
const atlas=await unwrapWithXatlas(clean.vertices,clean.faces);
await fs.writeFile(path.join(work,'vertices.f32'),clean.vertices);await fs.writeFile(path.join(work,'triangles.u32'),clean.faces);
await fs.writeFile(path.join(work,'atlas-vmap.u32'),atlas.xref);await fs.writeFile(path.join(work,'atlas-faces.u32'),atlas.faces);
execFileSync(args.get('--python'),['-c',`import sys,numpy as np,trimesh
w=sys.argv[1];v=np.fromfile(w+'/vertices.f32','<f4').reshape(-1,3);vm=np.fromfile(w+'/atlas-vmap.u32','<u4');f=np.fromfile(w+'/atlas-faces.u32','<u4').reshape(-1,3)
uv=v[vm];ex=uv.copy();ex[:,1],ex[:,2]=uv[:,2].copy(),-uv[:,1].copy()
n=trimesh.Trimesh(vertices=ex,faces=f,process=False).vertex_normals;m=np.asarray(n).copy();m[:,1],m[:,2]=-n[:,2],n[:,1]
np.ascontiguousarray(m,'<f8').tofile(w+'/source-normals.f64');print(trimesh.__version__)`,work],{env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
const trimeshVersion=execFileSync(args.get('--python'),['-c','import trimesh;print(trimesh.__version__)'],{encoding:'utf8'}).trim();
const normals=await fs.readFile(path.join(work,'source-normals.f64'));
await fs.writeFile(out,JSON.stringify({schema:'trellis2.wasm-xatlas-fixture.v0',case:'simplify-route',
  cleaned:{verticesSha256:sha(clean.vertices),trianglesSha256:sha(clean.faces)},
  atlasPin:{note:'determinism pin of vendor/xatlas Wasm; not a source-wheel identity',indexedVertices:atlas.xref.length,charts:atlas.charts,
    width:atlas.width,height:atlas.height,uvsSha256:sha(atlas.uvs),xrefSha256:sha(atlas.xref),facesSha256:sha(atlas.faces)},
  sourceNormals:{law:'trimesh Trimesh(export_verts, faces).vertex_normals mapped to model frame',trimesh:trimeshVersion,
    f64Base64:normals.toString('base64')}},null,1)+'\n');
console.log(JSON.stringify({indexedVertices:atlas.xref.length,charts:atlas.charts,normalsBytes:normals.length}));
