// kaminos-test: node
import assert from 'node:assert/strict';
import { WORLD_SMOKE_WGSL } from '../volume-world-smoke.mjs';
assert.match(WORLD_SMOKE_WGSL,/u\.wind/, 'World flow must continue the resolved wind outside its Fine donor');
const { worldWindAcceleration }=await import('../volume-world-smoke.mjs');
const input={strength:1.5,angle:0,height:-.8,speed:1,fineWidth:48,scale:1};
const a=worldWindAcceleration(input),b=worldWindAcceleration({...input,angle:Math.PI/2}),c=worldWindAcceleration({...input,scale:2});
assert.ok(Math.abs(a[0]-b[2])<1e-12);assert.ok(Math.abs(b[0])<1e-12);
assert.equal(c[0],a[0]*2);assert.equal(a[3],-.8);
assert.deepEqual(worldWindAcceleration({...input,strength:0}).slice(0,3),[0,0,0]);
console.log('outer wind uses rotated force and anchored units');
