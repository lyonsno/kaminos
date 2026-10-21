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

// ---- scene consumers: navigation, duplication, framing and grounding, viewport, fallback colour (TS-01..05)
// A small 512-grid sheet away from the origin, so rays through the origin miss it.
function offsetField(){
  const coords=new Int32Array([128,128,192,129,128,192,128,129,192,129,129,192]);
  return buildSurfelField({vertices:new Float32Array([...coords].map(v=>(v+.5)/512-.5)),triangles:new Uint32Array([0,1,3,0,3,2]),
    geometryCoordinates:coords,material:{coordinates:coords,features:new Float32Array([0,0,0,-1,.8,1, 0,0,0,-1,.8,1, 0,0,0,-1,.8,1, 0,0,0,-1,.8,1]),resolution:512}});
}

test('TS-01: navigation preparation keeps surfel picking: a ray that misses the field hits nothing',async()=>{
  const {prepareNavigationGeometry}=await import('../scene-navigation.mjs');
  const object=createSurfelObject(THREE,offsetField());object.updateMatrixWorld(true);
  await prepareNavigationGeometry(object);
  const miss=new THREE.Raycaster(new THREE.Vector3(0,0,1),new THREE.Vector3(0,0,-1));
  assert.deepEqual(miss.intersectObject(object,true),[],'no template-triangle hits after preparation');
  const p=surfelPositions(offsetField());
  const hit=new THREE.Raycaster(new THREE.Vector3(p[0],p[1],1),new THREE.Vector3(0,0,-1)).intersectObject(object,true);
  assert.equal(hit.length,1);assert.equal(hit[0].object,object);
});

test('TS-01: navigation depth uses the surfel field, not template triangles',async()=>{
  const {prepareNavigationGeometry,navigationPivot}=await import('../scene-navigation.mjs');
  const object=createSurfelObject(THREE,offsetField());object.updateMatrixWorld(true);await prepareNavigationGeometry(object);
  const p=surfelPositions(offsetField()),camera=new THREE.PerspectiveCamera(30,1,.01,10);
  camera.position.set(p[0],p[1],1);camera.lookAt(p[0],p[1],0);camera.updateMatrixWorld(true);
  const pivot=navigationPivot(camera,new THREE.Vector3(),new THREE.Vector2(0,0),[object]);
  assert.equal(pivot.source,'mesh-surface');assert.ok(Math.abs(pivot.point.z-(193/512-.5))<1e-4,'the top of the surfel cell');
  camera.position.set(0,0,1);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
  assert.equal(navigationPivot(camera,new THREE.Vector3(),new THREE.Vector2(0,0),[object]).source,'retained-depth','empty space keeps the retained pivot');
});

test('TS-02: a production clone keeps voxel picking and projected-size LOD, on its own transform',async()=>{
  const {clone}=await import('../node_modules/three/examples/jsm/utils/SkeletonUtils.js');
  const source=createSurfelObject(THREE,{...offsetField()},{viewportHeight:1050});source.scale.setScalar(1.377);source.updateMatrixWorld(true);
  const copy=clone(source);copy.position.x=2;copy.updateMatrixWorld(true);
  const camera=new THREE.PerspectiveCamera(50,1.5,.01,100);
  const levelOf=(o,d)=>{const lod=o.children.find(c=>c.isLOD),wp=lod.getWorldPosition(new THREE.Vector3());camera.position.copy(wp).add(new THREE.Vector3(0,0,d));camera.lookAt(wp);camera.updateMatrixWorld(true);lod.update(camera);return lod.levels.findIndex(l=>l.object.visible);};
  for(const d of [2.9,5,12])assert.equal(levelOf(copy,d),levelOf(source,d),`same level at ${d}`);
  const p=surfelPositions(offsetField()),w=new THREE.Vector3(p[0],p[1],p[2]).applyMatrix4(copy.matrixWorld);
  const hits=new THREE.Raycaster(new THREE.Vector3(w.x,w.y,5),new THREE.Vector3(0,0,-1)).intersectObject(copy,true);
  assert.equal(hits.length,1);assert.equal(hits[0].object,copy,'the copy picks itself through its own grid walk');
});

test('TS-03: the scene-geometry proxy matches the drawn surfels for framing and grounding',()=>{
  const object=createSurfelObject(THREE,offsetField());const proxy=object.sceneGeometry;
  assert.ok(proxy?.isBufferGeometry,'the surfel root offers plain triangles for scene geometry consumers');
  const box=new THREE.Box3().setFromBufferAttribute(proxy.getAttribute('position'));
  object.updateMatrixWorld(true);const drawn=new THREE.Box3();object.traverse(o=>{if(o.isLOD)drawn.union(new THREE.Box3().setFromObject(o.levels[0].object,true));});
  const voxel=1/512;
  for(const a of ['x','y','z'])assert.ok(Math.abs(box.min[a]-drawn.min[a])<=3*voxel&&Math.abs(box.max[a]-drawn.max[a])<=3*voxel,`proxy bounds follow the surfels on ${a}`);
});

test('TS-04: the viewport height comes from the page and is read at every update; orthographic too',async()=>{
  const {configureSurfelRendering}=await import('../trellis-surfels.mjs');
  let height=1080;configureSurfelRendering({viewportHeight:()=>height});
  try{
    const object=createSurfelObject(THREE,{...offsetField()});object.scale.setScalar(1.377);object.updateMatrixWorld(true);
    const lod=object.children.find(c=>c.isLOD),wp=lod.getWorldPosition(new THREE.Vector3());
    const camera=new THREE.PerspectiveCamera(50,1.5,.01,100);camera.position.copy(wp).add(new THREE.Vector3(0,0,5));camera.lookAt(wp);camera.updateMatrixWorld(true);
    const level=()=>{lod.update(camera);return lod.levels.findIndex(l=>l.object.visible);};
    assert.equal(level(),1);height=2160;assert.equal(level(),0,'a taller drawing buffer keeps more detail');
    const ortho=new THREE.OrthographicCamera(-1,1,1,-1,.01,100);ortho.position.copy(camera.position);ortho.updateMatrixWorld(true);
    height=1080;ortho.zoom=.1;ortho.updateProjectionMatrix();lod.update(ortho);const far=lod.levels.findIndex(l=>l.object.visible);
    ortho.zoom=8;ortho.updateProjectionMatrix();lod.update(ortho);const near=lod.levels.findIndex(l=>l.object.visible);
    assert.ok(far>near,'zooming an orthographic view in selects finer surfels');
  }finally{configureSurfelRendering({viewportHeight:null});}
});

test('TS-05: the fallback mesh carries linear vertex colour, like the plugin',async()=>{
  const coords=new Int32Array([3,3,3]);
  const field=buildSurfelField({vertices:new Float32Array([...coords].map(v=>(v+.5)/8-.5)),triangles:new Uint32Array(),geometryCoordinates:coords,
    material:{coordinates:coords,features:new Float32Array([0,0,0,-1,.8,1]),resolution:8}});
  const {json}=readSurfelGLBExtension(encodeSurfelGLB(field,{fallbackFactor:1}));
  const glb=encodeSurfelGLB(field,{fallbackFactor:1}),view=new DataView(glb),jl=view.getUint32(12,true),acc=json.accessors[1],bv=json.bufferViews[acc.bufferView];
  const r=new Uint8Array(glb,28+jl+bv.byteOffset,4)[0]/255;
  assert.ok(Math.abs(r-new THREE.Color().setRGB(128/255,0,0,THREE.SRGBColorSpace).r)<1/255+1e-6,`fallback stores linear ${r}`);
});

test('TS-03: framing and Snap Ground read the surfel proxy, so a grounded surfel asset rests on the ground',async()=>{
  const fs=await import('node:fs');const {snapGroundWorldDelta}=await import('../asset-resting-plane.mjs');
  const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const start=source.indexOf('function sceneObjectWorldGeometry(');const end=source.indexOf('function sceneObjectWorldPoints(',start);
  const readGeometry=new Function('THREE',source.slice(start,end)+'return sceneObjectWorldGeometry;')(THREE);
  // the encoded node matrix plus an authored transform, around an asymmetric, offset field
  const object=createSurfelObject(THREE,offsetField()),node=new THREE.Group();
  node.matrix.fromArray([1,0,0,0, 0,0,-1,0, 0,1,0,0, 0,0,0,1]);node.matrixAutoUpdate=false;node.add(object);
  const authored=new THREE.Group();authored.add(node);authored.position.set(.3,1.2,-.4);authored.rotation.y=.7;authored.scale.setScalar(1.377);authored.updateMatrixWorld(true);
  const g=readGeometry(authored,{triangles:true});
  const drawn=new THREE.Box3();object.traverse(o=>{if(o.isLOD)drawn.union(new THREE.Box3().setFromObject(o.levels[0].object,true));});
  const consumer=new THREE.Box3().setFromArray(g.points);const tol=4*1.377/512;
  for(const a of ['x','y','z'])assert.ok(Math.abs(consumer.min[a]-drawn.min[a])<=tol&&Math.abs(consumer.max[a]-drawn.max[a])<=tol,`consumer bounds follow the surfels on ${a}`);
  const {delta}=snapGroundWorldDelta({...g,groundY:0});
  assert.ok(Math.abs(drawn.clone().applyMatrix4(delta).min.y)<=tol,'after Snap Ground the surfels rest on the ground');
});

test('TS-01-C1: a fully transparent or hidden surfel object gives no navigation depth; a visible surface behind it does',async()=>{
  const {prepareNavigationGeometry,navigationPivot}=await import('../scene-navigation.mjs');
  const object=createSurfelObject(THREE,offsetField());object.updateMatrixWorld(true);await prepareNavigationGeometry(object);
  const behind=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial());behind.position.z=-.3;behind.updateMatrixWorld(true);
  const p=surfelPositions(offsetField()),camera=new THREE.PerspectiveCamera(30,1,.01,10);
  camera.position.set(p[0],p[1],1);camera.lookAt(p[0],p[1],0);camera.updateMatrixWorld(true);
  const z=()=>navigationPivot(camera,new THREE.Vector3(),new THREE.Vector2(0,0),[object,behind]).point.z;
  assert.ok(Math.abs(z()-(193/512-.5))<1e-4,'visible surfels supply depth');
  const materials=new Set();object.traverse(o=>{if(o.isInstancedMesh)materials.add(o.material);});
  for(const m of materials){m.transparent=true;m.opacity=0;}
  assert.ok(Math.abs(z()+.3)<1e-6,'transparent surfels let the surface behind supply depth');
  for(const m of materials){m.transparent=false;m.opacity=1;m.visible=false;}
  assert.ok(Math.abs(z()+.3)<1e-6,'hidden surfel material too');
});

test('a surfel GLB names its frame: TRELLIS source space, placed by the same node matrix as the run\'s mesh GLB',()=>{
  const field=buildSurfelField(fixture()),{extension,json}=readSurfelGLBExtension(encodeSurfelGLB(field));
  assert.deepEqual(extension.frame,{name:'trellis-source',extent:[-.5,.5],cellSize:1/field.resolution,nodeMatrix:[1,0,0,0, 0,0,-1,0, 0,1,0,0, 0,0,0,1]});
  assert.deepEqual(json.nodes[0].matrix,extension.frame.nodeMatrix,'the node carries the matrix the frame names');
  assert.equal(extension.occupancy,'surface','the cells are the decoded surface shell, not filled mass');
});
