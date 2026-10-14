import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
function magnitudeFor(grid,velocity,joined=true){
  const context={GRID:grid,OUTER_SMOKE:joined,f32:Number,select:(a,b,p)=>p?b:a,length:v=>Math.hypot(...v),velocityDensity:{xyz:velocity}};
  const scale=source.match(/fn joinedVelocityScale\(\)[^\n]*?return ([^;]+);/)[1];
  context.joinedVelocityScale=()=>vm.runInNewContext(scale,context);
  const optical=source.match(/fn opticalVelocityMagnitude\([^]*?return ([^;]+);/);
  context.opticalVelocityMagnitude=v=>vm.runInNewContext(optical[1],{...context,v});
  const support=source.slice(source.indexOf('fn boundarySupportFromSlots('));
  const expression=support.match(/let velMag = ([^;]+);/)[1];
  return vm.runInNewContext(expression,context);
}
test('actual boundary-support magnitude is invariant for equal local speed at32 and64',()=>{
  assert.equal(magnitudeFor(32,[0,.5,0]),magnitudeFor(64,[0,1,0]));
  assert.equal(magnitudeFor(64,[0,1,0],false),1,'standalone saved appearance is unchanged');
});
test('raymarch, direct support and irradiance share the same optical velocity reading',()=>{
  assert.ok((source.match(/let velMag = opticalVelocityMagnitude\(/g)||[]).length>=4);
  assert.match(source,/Math\.hypot\(st\[0\], st\[1\], st\[2\]\) \/ joinedVelocityUnits\(n,outerRequested\)\.cellScale/,'CPU appearance census matches GPU units');
});
