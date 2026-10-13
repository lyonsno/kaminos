import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeMaterialContrast,adjustMaterialMaps } from './material-contrast.js';

function rgba(values,width=values.length){return {width,height:values.length/width,data:Uint8Array.from(values.flatMap(value=>[value,value,value,255]))};}
function maps(orm){return {orm,albedo:rgba(Array(orm.width*orm.height).fill(90),orm.width),roughness:orm,metallic:orm};}
test('flat maps remain flat even with a strong highlight and manual full strength',()=>{
  const input=maps(rgba([120,120,120,120],2)),analysis=analyzeMaterialContrast(rgba([0,255,0,0],2),input);
  assert.equal(analysis.roughness.compression,0);
  assert.equal(adjustMaterialMaps(input,analysis,{mode:'manual',roughness:1,metallic:1}).maps,input);
});
test('sharp residual peaks contribute evidence; a uniformly brighter photograph does not',()=>{
  const input=maps(rgba(Array(81).fill(128),9));
  const flat=analyzeMaterialContrast(rgba(Array(81).fill(220),9),input);
  const values=Array(81).fill(90);values[40]=255;
  const peaked=analyzeMaterialContrast(rgba(values,9),input);
  assert.equal(flat.highlightEvidence,0);assert.ok(peaked.highlightEvidence>.5);
});
test('original is exact and weighted correction scales with evidence and compression',()=>{
  const input=maps(rgba([110,120,130,140],2));
  const analysis=analyzeMaterialContrast(input.albedo,input);
  assert.equal(adjustMaterialMaps(input,analysis,{mode:'original',roughness:1,metallic:1}).maps,input);
  assert.equal(adjustMaterialMaps(input,analysis,{mode:'highlight',roughness:1,metallic:1}).maps,input);
  const manual=adjustMaterialMaps(input,analysis,{mode:'manual',roughness:1,metallic:0});
  assert.equal(manual.maps.orm.data[1],0);assert.equal(manual.maps.orm.data[13],255);
  assert.deepEqual([...manual.maps.orm.data].filter((_,i)=>i%4===0||i%4===2||i%4===3),
    [...input.orm.data].filter((_,i)=>i%4===0||i%4===2||i%4===3));
  const weighted=adjustMaterialMaps(input,{...analysis,highlightEvidence:.5},{mode:'highlight',roughness:.8,metallic:.4});
  assert.equal(weighted.gains.roughness,.8*.5*(1-30/255));
  assert.equal(weighted.gains.metallic,.4*.5*(1-30/255));
  assert.ok(weighted.maps.orm.data[1]>manual.maps.orm.data[1]);
  assert.ok(weighted.maps.orm.data[13]<manual.maps.orm.data[13]);
});
test('transparent pixels cannot set histogram endpoints or acquire altered ORM values',()=>{
  const orm=rgba([0,110,140,255],2);orm.data[3]=orm.data[15]=0;
  const input=maps(orm),analysis=analyzeMaterialContrast(input.albedo,input);
  assert.equal(analysis.roughness.low,110);assert.equal(analysis.roughness.high,140);
  const corrected=adjustMaterialMaps(input,analysis,{mode:'manual',roughness:1,metallic:1});
  assert.deepEqual(corrected.maps.orm.data.slice(0,4),orm.data.slice(0,4));
  assert.deepEqual(corrected.maps.orm.data.slice(12,16),orm.data.slice(12,16));
});
