// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {prepareStoneFromGlb} from '../structural-material-stone-prepare.mjs';

const bytes=fs.readFileSync(new URL('../assets/arch-stones/03-bedded-stone-500-normal.glb',import.meta.url));
const options={size:[2.4,.6,.6],cellSize:4};
test('explicit mechanical surface approximation retains its actual tolerance and volume reference',()=>{
 const reference=prepareStoneFromGlb(bytes,options),actual=prepareStoneFromGlb(bytes,{...options,surfaceTolerance:.001});
 assert.equal(actual.mechanicalPreparation?.surfaceTolerance,.001,'Requested mechanical tolerance must not be silently ignored');
 assert.equal(actual.mechanicalPreparation.referenceVolume,reference.volume);
 assert.equal(actual.mechanicalPreparation.preparedVolume,actual.volume);
 assert.equal(actual.mechanicalPreparation.sourceSha256,reference.sourceSha256);
 assert.equal(actual.mechanicalPreparation.route,'manifold-3.5.4-simplify-within-tolerance-v1');
 assert(actual.mechanicalPreparation.preparedTriangles<=actual.mechanicalPreparation.referenceTriangles);
 assert(actual.mechanicalPreparation.relativeVolumeError<=.01);
 assert.equal(actual.cells[0].geometry.exterior.every(Boolean),true);
 assert(actual.cells[0].geometry.properties.every(Number.isFinite));
});
test('mechanical approximation rejects invalid tolerance rather than substituting a default',()=>{
 for(const surfaceTolerance of [-1,NaN,Infinity,'0.01',null])assert.throws(()=>prepareStoneFromGlb(bytes,{...options,surfaceTolerance}),/surface tolerance/i);
});
test('zero tolerance keeps the prior source geometry and volume',()=>{
 const original=prepareStoneFromGlb(bytes,options),explicit=prepareStoneFromGlb(bytes,{...options,surfaceTolerance:0});
 assert.deepEqual(explicit.cells,original.cells);assert.equal(explicit.volume,original.volume);
 assert.equal(explicit.mechanicalPreparation?.surfaceTolerance,0);
});
