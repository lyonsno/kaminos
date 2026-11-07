// kaminos-test: node
import assert from 'node:assert/strict';
import {conditioningCloud,smoothConditioningCloud,opticalCoverage,conditioningSettings,packConditioningGeometry,unpackConditioningGeometry} from '../image-conditioning.mjs';
const image={width:3,height:3,data:new Uint8ClampedArray(36).fill(255)},geometry={width:3,height:3,depth:new Float32Array([1,1,1,1,1.2,1,1,1,1]),normals:new Float32Array(27).fill(.5)};
const cloud=conditioningCloud(geometry,image),before=cloud.positions.slice();
assert.equal(smoothConditioningCloud(cloud,0),cloud);
const smooth=smoothConditioningCloud(cloud,2);
assert.ok(smooth.positions[14]<cloud.positions[14]-.01,'form smoothing must reduce a raised depth feature');
assert.deepEqual(cloud.positions,before,'retained source geometry stays untouched');
assert.equal(opticalCoverage(0),0);assert.ok(opticalCoverage(6)>.997);assert.ok(opticalCoverage(2)>opticalCoverage(1));
assert.throws(()=>conditioningSettings({boundary:-1}),/boundary/);assert.throws(()=>conditioningSettings({clay:2}),/appearance/);
const packed=packConditioningGeometry(geometry,{source:'source.png'}),restored=unpackConditioningGeometry(packed);assert.deepEqual(restored.depth,geometry.depth);assert.deepEqual(restored.normals,geometry.normals);assert.equal(restored.metadata.source,'source.png');assert.throws(()=>unpackConditioningGeometry(packed.subarray(0,packed.length-1)),/Invalid/);
const isolated={...cloud,positions:new Float32Array(cloud.positions),alpha:new Float32Array(9)};isolated.alpha[0]=isolated.alpha[8]=1;isolated.positions.set([0,0,1],0);isolated.positions.set([100,0,1],24);const separated=smoothConditioningCloud(isolated,1);assert.equal(separated.positions[0],0);assert.equal(separated.positions[24],100);
console.log('conditioning geometry, coverage and retained bytes pass');
const {conditioningSourceName}=await import('../image-conditioning.mjs');
assert.equal(conditioningSourceName({name:'Confirmed chrome rack with sculpted vents',source:'/api/read?root=image-inbox&path=stored%2Frack.png'}),'Confirmed chrome rack with sculpted vents.png','friendly catalogue names still need the actual image extension at preparation');
