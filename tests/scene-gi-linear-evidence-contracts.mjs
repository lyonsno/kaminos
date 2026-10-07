import assert from 'node:assert/strict';
import {admitSceneGILinearAddition} from '../scene-gi-evidence.mjs';
const fixture={width:1,height:1,zero:[1,1,1,1],lit:[1.0009765625,1.0009765625,1.0009765625,1],received:[.0008001327514648438,.0008001327514648438,.0008001327514648438,1]};
assert.doesNotThrow(()=>admitSceneGILinearAddition(fixture),'subtraction of quantized bright buffers must admit the rounding bound');
assert.throws(()=>admitSceneGILinearAddition({...fixture,received:[.1,.1,.1,1]}),'wrong radiance must fail beyond the format precision');
assert.throws(()=>admitSceneGILinearAddition({...fixture,received:[0,0,0,1]}),'blank received light is not evidence');
assert.throws(()=>admitSceneGILinearAddition({...fixture,lit:[NaN,1,1,1]}),'nonfinite evidence must fail');
assert.throws(()=>admitSceneGILinearAddition({...fixture,lit:[1,1]}),'partial evidence must fail');
console.log('linear receiving evidence respects half precision and rejects wrong, blank and partial signals');
