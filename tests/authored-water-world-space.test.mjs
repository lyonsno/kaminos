// kaminos-test: node
import assert from 'node:assert/strict';
import {createAuthoredWaterDrop, inspectAuthoredWaterCompatibility} from '../authored-water-drop.mjs';
const bounds={min:[-2,-1,-2],max:[2,3,2]};
const records=[[-20,5,8],[24,-6,-9]].map((position,i)=>({id:`water-${i}`,label:`Water ${i}`,transform:{position,rotation:[.2,.3,.1],scale:[1,1,1]},localLiquidEmitter:{mode:'finite_drop',drop:{width:.5,samplesPerUnit:16,container:null,worldBounds:bounds}}}));
assert.equal(inspectAuthoredWaterCompatibility(records).compatible,true,'Without physical walls, old search bounds cannot block placed water');
for(const record of records){
 const source=createAuthoredWaterDrop(record.localLiquidEmitter.drop,record.transform);
 assert.equal(source.particleCount,512);
 const center=[0,0,0];for(let i=0;i<512;i++)for(let k=0;k<3;k++)center[k]+=source.population.particleData[i*16+k]/512;
 center.forEach((v,k)=>assert.ok(Math.abs(v-record.transform.position[k])<1e-5,'Placement must remain at the authored world position'));
 assert.equal(source.box.collisions,false);
}
const contained=structuredClone(records[0]);contained.localLiquidEmitter.drop.container=bounds;
assert.equal(inspectAuthoredWaterCompatibility([contained]).compatible,false,'Physical walls retain their initial-placement constraint');
assert.throws(()=>createAuthoredWaterDrop(contained.localLiquidEmitter.drop,contained.transform),/fit/);
console.log('World-space placement and optional physical walls remain separate');
