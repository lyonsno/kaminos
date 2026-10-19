// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import {createLocalLiquidEmitterObject} from '../local-liquid-scene-object.mjs';
import {createAuthoredWaterDrop} from '../authored-water-drop.mjs';
const transform={position:[.3,1,-.2],rotation:[.2,.4,.1],scale:[1.2,1.2,1.2]};
const drop={width:.5,samplesPerUnit:16};
const {object}=createLocalLiquidEmitterObject(THREE,{id:'initial',transform,settings:{schema:'kaminos.local-liquid-emitter.v1',mode:'finite_drop',baseRadius:.08,strength:1.15,rate:1200,drop}});
const preview=object.children.find(child=>child.userData.kaminosWaterPreview);
assert.equal(preview.isInstancedMesh,true,'The actual initial picture must show particles, not the volume cube');
const released=createAuthoredWaterDrop(drop,transform);
assert.equal(preview.count,released.particleCount,'Every initial particle must be shown; no hidden display cap');
object.updateMatrixWorld(true);const instance=new THREE.Matrix4(),world=new THREE.Vector3();
for(let i=0;i<preview.count;i++){
 preview.getMatrixAt(i,instance);world.setFromMatrixPosition(instance).applyMatrix4(object.matrixWorld);
 for(let k=0;k<3;k++)assert.ok(Math.abs(world.getComponent(k)-released.population.particleData[i*16+k])<1e-6,'Preview positions must agree with actual release after pose and scale');
}
assert.equal(preview.userData.initialParticleCount,preview.count);
assert.equal(preview.userData.initialStateOnly,true);
assert.equal(preview.material.transparent,true);
console.log('Complete initial particle picture agrees with actual released population, including pose and scale');
