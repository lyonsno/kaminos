import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
assert.match(src,/setOuterSmokeInspection\(mode/,'joined fields cannot be inspected independently of fire lighting');
assert.match(src,/fn raymarchOuterSmokeInspection\(/,'density inspection must use the native raymarch');
assert.match(src,/sampleOuterSmoke\(p\)\.x/,'inspection needs the actual outer texture');
assert.match(src,/outerSmokeInspection: outerSmokeInspection/,'effective inspection must be visible in runtime state');
console.log('native joined smoke inspection wiring passed');
