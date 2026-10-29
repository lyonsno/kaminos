// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import * as drops from '../authored-water-drop.mjs';
import {createLocalLiquidEmitterObject} from '../local-liquid-scene-object.mjs';
import {normalizeLocalLiquidSetup,defaultLocalLiquidSetup} from '../local-liquid-setup.mjs';
import {authoredDropSetup} from '../authored-water-host.mjs';
assert.equal(typeof drops.resolveAuthoredWaterSampling,'function','Shared water spacing must be resolved independently from a drop count');
const sampling={spacing:.05,container:{min:[-2,-1,-2],max:[2,3,2]}};
const pose={position:[.2,1,0],rotation:[.1,.2,.3],scale:[1.2,1.2,1.2]},drop={width:.63,samplesPerUnit:20};
const d=drops.describeAuthoredWaterDrop(drop,pose,sampling);
assert.equal(d.spacing,.05);assert.equal(d.width,.756);assert.equal(d.samplesAcross,15);assert.equal(d.particleCount,3375);assert.ok(Math.abs(d.representedWidth-.75)<1e-12);assert.ok(Math.abs(d.worldVolume-.75**3)<1e-12);assert.ok(Math.abs(d.requestedVolume-.756**3)<1e-12);assert.ok(Math.abs(d.relativeVolumeError-(d.worldVolume/d.requestedVolume-1))<1e-12);
assert.equal(drops.normalizeAuthoredWaterDrop(drop).width,.63,'Arbitrary requested size must survive quantization');
const make=(id,width,position=[0,1,0],scale=1)=>({id,label:id,transform:{position,rotation:[0,0,0],scale:[scale,scale,scale]},localLiquidEmitter:{schema:'kaminos.local-liquid-emitter.v1',mode:'finite_drop',drop:{width,samplesPerUnit:20}}});
const records=[make('A',.63),make('B',.51,[1,1,0])],settings={...defaultLocalLiquidSetup(),waterSampling:sampling};
assert.deepEqual(normalizeLocalLiquidSetup(settings).waterSampling,sampling,'Shared spacing/container must round-trip in saved scene domain');
const setup=authoredDropSetup(records,settings);assert.equal(setup.solver.particleCount,2197+1000);assert.equal(setup.solver.cellSize,.05*Math.cbrt(3));assert.equal(drops.inspectAuthoredWaterCompatibility(records,sampling).compatible,true,'Independent sizes no longer create resolution mismatches');
const shifted=structuredClone(records);shifted[0].transform.position[0]+=.017;assert.equal(authoredDropSetup(shifted,settings).solver.particleCount,setup.solver.particleCount);
const record=make('preview',.63,pose.position,1.2);record.transform=pose;
const {object}=createLocalLiquidEmitterObject(THREE,{id:record.id,label:record.label,transform:record.transform,settings:record.localLiquidEmitter},{sampling});
const preview=object.children.find(n=>n.userData.kaminosWaterPreview),released=drops.createAuthoredWaterDrop(record.localLiquidEmitter.drop,pose,sampling);
assert.equal(preview.count,released.particleCount);object.updateMatrixWorld(true);const matrix=new THREE.Matrix4(),v=new THREE.Vector3();for(let i=0;i<preview.count;i++){preview.getMatrixAt(i,matrix);v.setFromMatrixPosition(matrix).applyMatrix4(object.matrixWorld);for(let k=0;k<3;k++)assert.ok(Math.abs(v.getComponent(k)-released.population.particleData[16*i+k])<1e-6,'Quantized preview and release share actual positions including scale');}
const fine=drops.describeAuthoredWaterDrop({width:.6,samplesPerUnit:20},{...pose,scale:[1,1,1]},sampling),finer=drops.describeAuthoredWaterDrop({width:.6,samplesPerUnit:20},{...pose,scale:[1,1,1]},{...sampling,spacing:.025});assert.equal(finer.particleCount,8*fine.particleCount);assert.equal(finer.requestedVolume,fine.requestedVolume);assert.ok(Math.abs(finer.supportRadius/fine.supportRadius-.5)<1e-12);
assert.throws(()=>normalizeLocalLiquidSetup({...settings,waterSampling:{...sampling,spacing:0}}),/spacing/i);
console.log('Shared spacing, automatic quantization, error readout, saved domain and complete preview/release parity');
