// kaminos-test: node
import assert from 'node:assert/strict';import {assertNativeRGB} from '../neural-appearance-trajectory.mjs';
assert.deepEqual(assertNativeRGB([.1,.2,.3]),[.1,.2,.3]);
for(const values of [[NaN,1,2],[1,Infinity,2],[1,2],[],[null,1,2]])assert.throws(()=>assertNativeRGB(values),/RGB/);
console.log('Native RGB readbacks reject nonfinite or incomplete values');
