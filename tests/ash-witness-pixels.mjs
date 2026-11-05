// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {airbornePixelDelta,coveredSurfaceDelta} from '../ash/witness-pixels.mjs';
const frame=()=>({width:10,height:20,data:new Uint8Array(800)});
test('FPS and CPU text at the bottom cannot establish visible airborne ash',()=>{
 const a=frame(),b=frame();b.data[(19*10+3)*4]=255;const delta=airbornePixelDelta(a,b);assert.equal(delta.changedPixels,0);assert.equal(delta.excludedPixelsChanged,1);
});
test('scattered temporal noise cannot establish a covered surface',()=>{
 const a={width:120,height:120,data:new Uint8Array(120*120*4)},b={...a,data:a.data.slice()};
 for(let y=2;y<100;y+=3)for(let x=2;x<118;x+=3)b.data[(x+y*120)*4]=255;
 assert.ok(coveredSurfaceDelta(a,b).changedPixels>300);assert.equal(coveredSurfaceDelta(a,b).visible,false);
 for(let y=10;y<60;y++)for(let x=10;x<60;x++)b.data[(x+y*120)*4]=255;
 assert.equal(coveredSurfaceDelta(a,b).visible,true);
});
test('the airborne scene region still counts changed pixels and checks shape',()=>{
 const a=frame(),b=frame();b.data[(6*10+3)*4]=255;assert.equal(airbornePixelDelta(a,b).changedPixels,1);assert.throws(()=>airbornePixelDelta(a,{...b,width:5}),/shape/);
});
