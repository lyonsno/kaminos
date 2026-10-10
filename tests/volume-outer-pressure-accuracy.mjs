import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as outer from '../volume-outer-smoke.mjs';
test('outer pressure retains its last pressure and checks the same metric divergence target',()=>{
  const shader=outer.outerSmokeShader(outer.outerSmokeConfig(),32);
  assert.match(shader,/pressureOut\[index\(c\)\]=vec2<f32>\(pressureIn\[index\(c\)\]\.x,div\)/,'warm-start the existing pressure rather than erase it');
  assert.match(shader,/fn pressureError/,'the exterior projection has a completion check');
  const source=readFileSync(new URL('../volume-outer-smoke.mjs',import.meta.url),'utf8');
  assert.match(source,/pressureCompletion/,'observed completion belongs in the receipt');
});
