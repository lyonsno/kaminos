// kaminos-test: manual — actual source atlas Python/MLX-source CPU packages.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createSourceAtlasUnwrapper} from '../source-atlas.mjs';
const [python,sourceRoot,expectedSourceCommit,fixture,out]=process.argv.slice(2);
assert.ok(out,'explicit source and caller-owned fixture/output required');
const cleanRoot=path.join(fixture,'clean'),input=JSON.parse(await fs.readFile(path.join(cleanRoot,'report.json')));
async function typed(folder,row,Type){const b=await fs.readFile(path.join(folder,row.file));return new Type(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));}
const mesh={vertices:await typed(cleanRoot,input.arrays.vertices,Float32Array),
  triangles:await typed(cleanRoot,input.arrays.triangles,Uint32Array),metadata:{fixture:'source-normal-transfer'}};
const unwrap=createSourceAtlasUnwrapper({python,sourceRoot,expectedSourceCommit,cleanRoot,out});
const actual=await unwrap(mesh),report=JSON.parse(await fs.readFile(path.join(out,'report.json'))),
  normals=await typed(out,report.arrays.normals,Float32Array),indices=await typed(out,report.arrays.triangles,Uint32Array);
for(let i=0;i<indices.length;i++)for(let axis=0;axis<3;axis++)
  assert.ok(Math.abs(actual.normals[i*3+axis]-normals[indices[i]*3+axis])<1e-7,
    'actual GLB consumer must receive the source post-UV normal at the same corner, not worker-recomputed normals');
assert.equal(actual.uvMetadata.normalBasis.rule,'source-resume-export/Trimesh-post-UV');
assert.equal(actual.uvMetadata.normalWorkerSha256,undefined,'source route must not imply a worker normal calculation');
assert.equal(actual.triangles.length,mesh.triangles.length);
console.log('Actual source normal bytes reach the same-corner material/GLB consumer without geometry or winding replacement.');
