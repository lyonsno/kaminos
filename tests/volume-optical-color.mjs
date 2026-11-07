// kaminos-test: node
import assert from 'node:assert/strict';
import {opticalRgbToXyz,opticalXyzToRgb} from '../volume-optical-color.mjs';
// The observed low-temperature source contains signed, out-of-gamut RGB.
const recorded=new Float32Array([2.396449565887451,.513521671295166,-.008843423798680305,.12596480548381805,1,.5,.25,.4]);
const xyz=opticalRgbToXyz(recorded);assert.ok(xyz.every(x=>x>=0));
const roundtrip=opticalXyzToRgb(xyz);
for(let i=0;i<recorded.length;i++)assert.ok(Math.abs(roundtrip[i]-recorded[i])<2e-7);
assert.equal(xyz[3],recorded[3]);assert.equal(roundtrip[3],recorded[3]);
assert.throws(()=>opticalRgbToXyz(new Float32Array([NaN,0,0,0])),/finite/);
assert.throws(()=>opticalRgbToXyz(new Float32Array([-1,-1,-1,0])),/physical/);
console.log('Signed production RGB survives positive XYZ reconstruction basis without gamut clipping');
