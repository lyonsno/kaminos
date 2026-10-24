// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import * as image from '../models/flux3-klein/reference-image.js';
test('reference preprocessing preserves its own rectangle and crops only the 16 pixel grid',()=>{
 assert.equal(typeof image.referenceImageGeometry,'function');
 assert.deepEqual(image.referenceImageGeometry(259,145),{sourceWidth:259,sourceHeight:145,resizedWidth:259,resizedHeight:145,left:1,top:0,width:256,height:144});
 assert.equal(image.referenceImageGeometry(8192,4096).resizedWidth,5792);
 assert.throws(()=>image.referenceImageGeometry(15,128),/16/);
});
test('RGB normalization keeps row/channel order and declared white alpha background',()=>{
 assert.equal(typeof image.referenceRgb,'function');
 const rgb=image.referenceRgb(new Uint8ClampedArray([255,0,128,255,0,128,255,0]));
 assert.deepEqual([...rgb],[1,-1,Math.fround(128/127.5-1),1,1,1]);
});
