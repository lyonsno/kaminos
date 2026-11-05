// kaminos-test: node
import assert from 'node:assert/strict';
import * as surface from '../burn-fracture-replay.mjs';
assert.equal(typeof surface.packBurnFractureSurface,'function','Moving material needs original surface coordinates and per-face connection ownership');
const arrays={positions:Float32Array.of(0,0,0,1,0,0,0,1,0,1,1,0),normals:new Float32Array(12).fill(1),uvs:new Float32Array(8),indices:Uint32Array.of(0,1,2,1,3,2),faceMaterial:Uint8Array.of(0,1)};
const result=surface.packBurnFractureSurface({pieces:[{index:0,arrays,faceInterfaces:Uint32Array.of(0,4),faceBonds:Int32Array.of(-1,2)}]});
assert.deepEqual([...result.caps],[0,0,0,3,3,3],'Exterior and closed internal faces must remain distinguishable');
assert.deepEqual([...result.arrays.positions],[0,0,0,1,0,0,0,1,0,1,0,0,1,1,0,0,1,0]);
assert.deepEqual([...result.owners],[0,0,0,0,0,0]);
assert.deepEqual([...result.arrays.faceMaterial],[0,1]);

import * as THREE from '../lib/three.webgpu.js';
{
 const prepared={capMaterial:1,cells:[{index:0}],receipt:{sourceTriangles:1},pieces:[{index:0,arrays,faceInterfaces:Uint32Array.of(0,4),faceBonds:Int32Array.of(-1,0)}]};
 const bounds=new THREE.Box3(new THREE.Vector3(-1,-1,-1),new THREE.Vector3(1,1,1));
 const stateNode=THREE.TSL.vec4(.8,.6,.4,1);
 const field={device:{createBuffer:()=>({destroy(){}}),queue:{writeBuffer(){}}},texture:{},stateNode,residentState:()=>({bounds})};
 const dynamics={wrapper:new THREE.DataTexture(new Float32Array(16),4,1,THREE.RGBAFormat,THREE.FloatType),texture:{}};
 const renderer={library:new THREE.StandardNodeLibrary()};
 const baseMat=new THREE.MeshStandardMaterial();
 const cutoutView=surface.createBurnFractureSurface({renderer,prepared,materials:[baseMat],field,dynamics,surfaceCutout:true});
 assert.equal(cutoutView.bindings[0].material.opacityNode,stateNode.w,'Cutout mode retains exterior voxel presence cutout');
 assert.equal(cutoutView.bindings[1].material.opacityNode,stateNode.w,'Cutout mode clips planar section caps where wood has disintegrated so dead caps do not float in mid-air');
 assert.equal(cutoutView.read().surfaceCutout,true);
 cutoutView.dispose();
 const solidView=surface.createBurnFractureSurface({renderer,prepared,materials:[baseMat],field,dynamics,surfaceCutout:false});
 assert.equal(solidView.bindings[0].material.opacityNode,null,'Solid regional mode keeps watertight region exteriors without mid-region voxel holes');
 assert.equal(solidView.bindings[1].material.opacityNode,null);
 assert.equal(solidView.read().surfaceCutout,false);
 solidView.dispose();
 baseMat.dispose();
}
