import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Exercise the actual receiver-mask expression with scalar TSL step/sub
// semantics. Depths below are native WebGPU zero-to-one, not linear distance.
const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const expression=source.match(/const backgroundMask = (.*);/)[1];
const scalar=value=>({valueOf:()=>value,sub:other=>scalar(value-Number(other))});
const mask=depth=>Number(new Function('float','step','depthSampleNode',`return ${expression}`)(scalar,(edge,x)=>scalar(Number(x)>=Number(edge)?1:0),scalar(depth)));

// Actual saved-kiln route camera: near=.01, far=100. Its observed projection
// matrix has z coefficients -1.0001000100010002 and -.010001000100010001.
const depthAtDistance=d=>1.0001000100010002-.010001000100010001/d;
for(const distance of [.01,1,8,9,10,20,80,99]) {
 assert.equal(mask(depthAtDistance(distance)),1,`real receiver at distance ${distance} must retain fire illumination`);
}
assert.equal(mask(0),1,'near-plane geometry remains a receiver');
assert.equal(mask(1-2**-24),1,'last representable normalized depth below clear remains geometry');
assert.equal(mask(1),0,'clear depth is background and must not receive fire light');
console.log('fire light-field depth mask contracts passed');
