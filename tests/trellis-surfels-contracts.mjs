// kaminos-test: node — TRELLIS fields as surfels: compact field, merged levels, voxel picking, GLB round trip, scene object
import test from 'node:test';import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import {buildSurfelField,surfelPositions,surfelNormals,mergeSurfelLevel,pickSurfelField,encodeSurfelGLB,
  readSurfelGLBExtension,createSurfelObject,SURFEL_EXTENSION} from '../trellis-surfels.mjs';

// A 2x2 sheet of surface cells at z=3 on an 8-grid, facing +z, plus one isolated cell; dual-grid style:
// vertex i belongs to geometry row i at (coordinate + offset) / resolution - 0.5.
function fixture({shuffleMaterial=false}={}){
  const resolution=8,coords=[[2,2,3],[3,2,3],[2,3,3],[3,3,3],[6,6,6]],offsets=[[.5,.5,.4],[.6,.5,.5],[.5,.4,.5],[.5,.5,.5],[.5,.5,.5]];
  const vertices=new Float32Array(coords.flatMap((c,i)=>c.map((v,a)=>(v+offsets[i][a])/resolution-.5)));
  const triangles=new Uint32Array([0,1,3, 0,3,2]);
  const geometryCoordinates=new Int32Array(coords.flat());
  // signed decoder material: channel*0.5+0.5 -> [r,g,b,metallic,roughness,alpha]
  const unit=[[1,0,0,0,.9,1],[0,1,0,0,.9,1],[0,0,1,0,.9,1],[1,1,1,0,.9,1],[.5,.5,.5,1,.2,1]];
  let rows=coords.map((c,i)=>({c,m:unit[i].map(v=>v*2-1)}));
  if(shuffleMaterial)rows=[rows[3],rows[0],rows[4],rows[2],rows[1]];
  const material={resolution,coordinates:new Int32Array(rows.flatMap(r=>r.c)),features:new Float32Array(rows.flatMap(r=>r.m))};
  return {resolution,vertices,triangles,geometryCoordinates,material,coords,unit};
}

test('the field keeps every surface voxel in about 14 bytes: cell, offset, normal, colour, metallic, roughness',()=>{
  const f=fixture(),field=buildSurfelField(f);
  assert.equal(field.count,5);assert.equal(field.resolution,8);
  const bytes=field.cells.byteLength+field.offsets.byteLength+field.normals.byteLength+field.color.byteLength+field.metalRough.byteLength;
  assert.equal(bytes/field.count,14);
  const p=surfelPositions(field);
  for(let i=0;i<15;i++)assert.ok(Math.abs(p[i]-f.vertices[i])<=1/f.resolution/127+1e-7,`position ${i} within one offset step`);
  const n=surfelNormals(field);
  for(let i=0;i<4;i++)assert.ok(Math.abs(Math.abs(n[i*3+2])-1)<0.02,'sheet normals point along z');
  assert.deepEqual([...field.color.subarray(0,3)],[255,0,0]);assert.deepEqual([...field.metalRough.subarray(0,2)],[0,230]);
  assert.deepEqual([...field.color.subarray(12,15)],[128,128,128]);
});

test('material is joined by voxel coordinate, not by row order',()=>{
  const a=buildSurfelField(fixture()),b=buildSurfelField(fixture({shuffleMaterial:true}));
  assert.deepEqual([...b.color],[...a.color]);assert.deepEqual([...b.metalRough],[...a.metalRough]);
});

test('a surface voxel with no material voxel is refused',()=>{
  const f=fixture();f.material={...f.material,coordinates:f.material.coordinates.slice(0,12),features:f.material.features.slice(0,24)};
  assert.throws(()=>buildSurfelField(f),/no material voxel/);
});

test('a merged level averages each k-cube and records which merged surfel every source surfel belongs to',()=>{
  const field=buildSurfelField(fixture()),{field:m,parent}=mergeSurfelLevel(field,2);
  assert.equal(m.resolution,4);assert.equal(m.count,2,'the 2x2 sheet lies in one 2-cube; the isolated cell in another');
  assert.equal(parent.length,5);assert.equal(parent[0],parent[1]);assert.equal(parent[0],parent[3]);assert.notEqual(parent[0],parent[4]);
  const i=parent[0];assert.deepEqual([...m.color.subarray(i*3,i*3+3)],[128,128,128],'mean of red, green, blue and white');
});

test('picking walks the ray through the voxel grid and returns the first occupied cell',()=>{
  const field=buildSurfelField(fixture());
  const hit=pickSurfelField(field,[(2.5/8)-.5,(2.5/8)-.5,1],[0,0,-1]);
  assert.ok(hit,'a ray down onto the sheet hits');assert.deepEqual(hit.cell,[2,2,3]);
  assert.ok(Math.abs(hit.t-(1-(4/8-.5)))<1e-6,'distance to the cell top face');
  assert.equal(pickSurfelField(field,[(0.5/8)-.5,(0.5/8)-.5,1],[0,0,-1]),null,'an empty column misses');
});

test('a surfel GLB carries the field in its extension and round-trips it exactly',()=>{
  const field=buildSurfelField(fixture()),glb=encodeSurfelGLB(field,{provenance:{source:'fixture'}});
  const view=new DataView(glb);assert.equal(view.getUint32(0,true),0x46546c67);
  const {extension,field:back,json}=readSurfelGLBExtension(glb);
  assert.equal(extension.version,1);assert.ok(json.extensionsUsed.includes(SURFEL_EXTENSION));
  assert.ok(!json.extensionsRequired?.includes(SURFEL_EXTENSION),'other viewers fall back to the plain mesh');
  for(const k of ['cells','offsets','normals','color','metalRough'])assert.deepEqual([...back[k]],[...field[k]],k);
  assert.equal(json.nodes[0].mesh,0,'a fallback mesh is present for viewers without the extension');
});

test('the scene object draws chunks of instanced surfels at each level and picks through the grid, not the instances',()=>{
  const field=buildSurfelField(fixture()),object=createSurfelObject(THREE,field,{levels:[1,2],chunkVoxels:4});
  const lods=[];object.traverse(o=>{if(o.isLOD)lods.push(o);});
  assert.equal(lods.length,2,'the sheet and the isolated cell fall in different 4-voxel chunks');
  const counts=lods.map(l=>l.levels.map(x=>x.object.count));
  assert.deepEqual(counts.flat().sort(),[1,1,1,4].sort());
  const perInstance=[];object.traverse(o=>{if(o.isInstancedMesh&&o.raycast===THREE.InstancedMesh.prototype.raycast)perInstance.push(o);});
  assert.equal(perInstance.length,0,'no chunk falls back to three.js testing every instance');
  object.updateMatrixWorld(true);
  const rc=new THREE.Raycaster(new THREE.Vector3((2.5/8)-.5,(2.5/8)-.5,1),new THREE.Vector3(0,0,-1));
  const hits=rc.intersectObject(object,true);
  assert.equal(hits.length,1);assert.equal(hits[0].object,object);assert.deepEqual(hits[0].surfelCell,[2,2,3]);
});

test('each chunk draws the coarsest level whose surfels still look about a pixel wide, from object scale, camera and viewport',()=>{
  // a 512-grid asset at world scale 1.377 seen by a 50-degree camera on a 1050-pixel-high viewport:
  // a full-detail surfel spans about 3/d pixels at distance d.
  const field=buildSurfelField(fixture()),object=createSurfelObject(THREE,{...field,resolution:512},{levels:[1,2,4],chunkVoxels:64,viewportHeight:1050,targetPixels:1.5});
  object.scale.setScalar(1.377);object.updateMatrixWorld(true);
  const lod=[];object.traverse(o=>{if(o.isLOD)lod.push(o);});
  const camera=new THREE.PerspectiveCamera(50,1.5,0.01,100);
  const levelAt=d=>{const p=lod[0].getWorldPosition(new THREE.Vector3());camera.position.copy(p).add(new THREE.Vector3(0,0,d));camera.lookAt(p);camera.updateMatrixWorld(true);
    lod[0].update(camera);return lod[0].levels.findIndex(l=>l.object.visible);};
  assert.equal(levelAt(2.9),0,'at the overview distance a full-detail surfel is about a pixel: keep full detail');
  assert.equal(levelAt(5),1,'merged x2 once its surfels are about 1.2 pixels');
  assert.equal(levelAt(12),2,'merged x4 far away');
});
