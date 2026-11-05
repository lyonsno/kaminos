// kaminos-test: node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=process.env.KAMINOS_COMPOSITION_CORE?new URL(process.env.KAMINOS_COMPOSITION_CORE):new URL('../volume-core.js',import.meta.url);
const core=await import(source.href);
assert.ok(Number.isSafeInteger(core.SHARED_ASH_UNIFORM_OFFSET),'current-main shared ash must remain in the composed uniform block');
assert.ok(Number.isSafeInteger(core.WORLD_CALIBRATION_UNIFORM_OFFSET),'selected material world calibration must remain in the composed uniform block');
assert.equal(core.SHARED_ASH_UNIFORM_OFFSET,core.DISPLAY_RECONSTRUCTION_UNIFORM_OFFSET+8,'preserve the already published shared-ash byte offset');
assert.equal(core.WORLD_CALIBRATION_UNIFORM_OFFSET,core.SHARED_ASH_UNIFORM_OFFSET+4,'append material calibration after ash without overlapping either');
assert.equal(core.VOLUME_UNIFORM_FLOATS,core.WORLD_CALIBRATION_UNIFORM_OFFSET+8);
const text=readFileSync(source,'utf8');
assert.match(text,/shared_ash: vec4<f32>,[^\n]*\n  world_calibration: vec4<f32>,\n  calibration_pose: vec4<f32>,/,'GPU uniform layout matches both CPU offsets');
console.log('PASS current-main ash and material world-calibration uniform composition');
