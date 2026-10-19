// kaminos-test: node
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../lib/three.core.js';

test('scene-color probe separates requested RGBA pixels from native row padding',async()=>{
  // Local unpack policy fixture. The effective browser's matching native
  // 256-byte row layout is witnessed separately in the native report.
  const source=readFileSync(new URL('../fluid-viewport-host.mjs',import.meta.url),'utf8');
  const a=source.indexOf('    async readSceneColor('),b=source.indexOf('    state:',a);
  const method=source.slice(a,b).trim().replace(/^async readSceneColor/,'async function').replace(/,$/,'');
  const disposed=false,frameCount=1,failure=null,lastFrame={frameId:'frame-1'},colorTarget={width:32,height:32};
  const raw=new Uint16Array(400).fill(THREE.DataUtils.toHalfFloat(7));
  for(let row=0;row<4;row++)raw.fill(THREE.DataUtils.toHalfFloat(1),row*128,row*128+16);
  const renderer={readRenderTargetPixelsAsync:async()=>raw};
  const read=eval('('+method+')'),result=await read({x:0,y:0,width:4,height:4});
  assert.equal(result.values.length,64);assert.ok(result.values.every(value=>value===1));
  assert.equal(result.nativeValues.length,400);assert.ok(result.nativeValues.includes(7));
  assert.equal(result.nativeBytesPerRow,256);
});
