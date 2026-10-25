// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { parseGlb, readTrianglePrimitives } from '../poly-glb-io.mjs';

const source = new URL('../models/material-photo/photograph-glb.js', import.meta.url);
test('photograph export retains calibrated points, camera-facing winding and inferred maps', async () => {
  assert.ok(existsSync(source), 'photograph GLB export is missing');
  const { photographGlb } = await import(source);
  const depth = {width:2,height:2,metricScale:9,
    points:Float32Array.of(-2,-1,3, 2,-1,3, -2,1,3, 2,1,3),
    normals:Float32Array.of(0,0,-1, 0,0,-1, 0,0,-1, 0,0,-1)};
  const image={width:2,height:2,data:new Uint8ClampedArray(16).fill(255)};
  const maps={albedo:{...image,data:Uint8ClampedArray.from({length:16},(_,i)=>i)},orm:{...image,data:new Uint8Array(16).fill(37)}};
  const encoded=[];
  const glb=await photographGlb({depth,maps,image},{encodePng:async map=>{encoded.push(map);return Uint8Array.of(1,2,3,4);}});
  const [mesh]=readTrianglePrimitives(glb),{json}=parseGlb(glb);
  assert.deepEqual([...mesh.positions],[-2,1,-3, 2,1,-3, -2,-1,-3, 2,-1,-3]);
  assert.deepEqual([...mesh.indices],[0,2,1, 1,2,3]);
  assert.deepEqual([...mesh.uvs],[.25,.25, .75,.25, .25,.75, .75,.75]);
  assert.equal(mesh.normals[2],1);
  assert.deepEqual(json.nodes[0].translation,[0,0,3]);
  assert.deepEqual(json.asset.extras.photograph.sourceCenter,[0,0,-3]);
  assert.equal(json.materials[0].pbrMetallicRoughness.metallicRoughnessTexture.index,1);
  assert.equal(json.materials[0].pbrMetallicRoughness.baseColorTexture.index,0);
  assert.equal(json.materials[0].pbrMetallicRoughness.metallicFactor,1);
  assert.deepEqual([...encoded[0].data],[...maps.albedo.data.slice(0,3),255,...maps.albedo.data.slice(4,7),255,...maps.albedo.data.slice(8,11),255,...maps.albedo.data.slice(12,15),255]);
  assert.deepEqual(encoded[1],maps.orm);
  assert.equal(depth.points[2],3);
});

test('photograph topology excludes invalid, transparent and discontinuous triangles', async()=>{
  assert.ok(existsSync(source), 'photograph GLB export is missing');
  const { photographGeometry }=await import(source);
  const depth={width:2,height:2,points:Float32Array.of(-1,-1,2, 1,-1,2, -1,1,2, 1,1,2),normals:new Float32Array(12)};
  const image={width:2,height:2,data:new Uint8ClampedArray(16).fill(255)};
  image.data[15]=0;
  assert.deepEqual([...photographGeometry(depth,{image}).indices],[0,2,1]);
  image.data[15]=255;depth.points[11]=100;
  assert.deepEqual([...photographGeometry(depth,{image}).indices],[0,2,1]);
  depth.points[11]=NaN;
  assert.ok(photographGeometry(depth,{image}).positions.every(Number.isFinite));
  depth.points.fill(NaN);
  assert.throws(()=>photographGeometry(depth,{image}),/no usable triangles/i);
  assert.throws(()=>photographGeometry({width:2,height:2,depth:new Float32Array(4)}),/points/i);
});
