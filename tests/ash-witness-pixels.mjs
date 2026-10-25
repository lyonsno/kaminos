// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {airbornePixelDelta} from '../ash/witness-pixels.mjs';
const frame=()=>({width:10,height:20,data:new Uint8Array(800)});
test('FPS and CPU text at the bottom cannot establish visible airborne ash',()=>{
 const a=frame(),b=frame();b.data[(19*10+3)*4]=255;const delta=airbornePixelDelta(a,b);assert.equal(delta.changedPixels,0);assert.equal(delta.excludedPixelsChanged,1);
});
test('the airborne scene region still counts changed pixels and checks shape',()=>{
 const a=frame(),b=frame();b.data[(6*10+3)*4]=255;assert.equal(airbornePixelDelta(a,b).changedPixels,1);assert.throws(()=>airbornePixelDelta(a,{...b,width:5}),/shape/);
});
