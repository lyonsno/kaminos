// kaminos-test: node
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import * as preparation from '../models/trellis2/alpha-preparation.js';

// Observed Pillow12.3.0 outputs, not a second JS oracle. Source and replay:
// 9aa41d5db449be2af8bb91554ea899ee15c947e9:
// models/u2net/{fixtures/rembg-source.json,fixtures/rembg-fixture.js,
// export-rembg-fixtures.mjs}. Exporter invokes actual Pillow, rembg2.0.76,
// NumPy2.5.4; the RGBA case is opaque (straight-alpha resize is not this API).
const cases=[
  {
    "kind": "resample",
    "file": "resample-0.u8",
    "w": 257,
    "h": 191,
    "channels": 3,
    "ow": 320,
    "oh": 320,
    "seed": 1,
    "inputSha256": "aa243038d6e8d4401086764542807932673e2c9202f1309bce327e2953d76ec7",
    "outputSha256": "6f037852994d0424115010ca08eefc6746c0a4263758ddaf27aa39938cad3bf8"
  },
  {
    "kind": "resample",
    "file": "resample-1.u8",
    "w": 1500,
    "h": 900,
    "channels": 3,
    "ow": 1024,
    "oh": 614,
    "seed": 2,
    "inputSha256": "6ec9698d1876b1f261737f4ce791b23f02218e9fd58f475abe66c202c657fb47",
    "outputSha256": "7cd41079f50df2e627c7a8cc1797f86009512a4f16520bcd7e5261f5c89216a3"
  },
  {
    "kind": "resample",
    "file": "resample-2.u8",
    "w": 640,
    "h": 480,
    "channels": 3,
    "ow": 320,
    "oh": 320,
    "seed": 3,
    "inputSha256": "f89e0f325bb8c2978f16b3fc2c0bc64fe6adfaff4400d94be52adeb3a3924994",
    "outputSha256": "7d4c55df983f474b81dc1eeaf085852d65b7024dc41f86852d62470c10f22944"
  },
  {
    "kind": "resample",
    "file": "resample-3.u8",
    "w": 320,
    "h": 320,
    "channels": 1,
    "ow": 777,
    "oh": 513,
    "seed": 4,
    "inputSha256": "c372b666490029e39fc5a78d6fc3d0be599cc04f44bc78e85234542cd8ec9b4d",
    "outputSha256": "3dcc892f279f26c193766baf9a249d74fa808cda85652a27484fad9a81db8b53"
  },
  {
    "kind": "resample",
    "file": "resample-4.u8",
    "w": 300,
    "h": 200,
    "channels": 3,
    "ow": 300,
    "oh": 97,
    "seed": 5,
    "inputSha256": "fd788799f62d824ab4a771afe760abbfca45bed2b38074ec0e35f9ee5af49a3c",
    "outputSha256": "27ae83fd425ef7bdc108b72014f2cf7aa4eee61a13197480e77d655d463031d4"
  },
  {
    "kind": "resample",
    "file": "resample-5.u8",
    "w": 300,
    "h": 200,
    "channels": 4,
    "ow": 150,
    "oh": 200,
    "seed": 6,
    "inputSha256": "64e75083e5956e1546395af3269002e9e6a9d217bf9ad3b7fb2df7db50b8e9e5",
    "outputSha256": "dcbb33e2887bde57d64df97ec6c88a7f6b3759dfb4ca440bad8456501a1406a9"
  }
];
const sha=a=>createHash('sha256').update(a).digest('hex');
function random(seed){
  return ()=>{seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
}
// Preserve the observed generator exactly, including its one-channel byte writes.
function fixtureImage(width,height,seed,channels=3){
  const rand=random(seed),px=new Uint8Array(width*height*channels),discs=[];
  for(let i=0;i<5;i++)discs.push([rand()*width,rand()*height,(0.08+rand()*0.25)*Math.min(width,height),[rand()*255,rand()*255,rand()*255]]);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    let c=[40+180*x/width,60+150*y/height,200-120*x/width];
    for(const [cx,cy,r,col] of discs)if((x-cx)**2+(y-cy)**2<r*r)c=col;
    for(let k=0;k<3;k++)px[(y*width+x)*channels+k]=Math.max(0,Math.min(255,Math.round(c[k]+(rand()-.5)*24)));
    if(channels===4)px[(y*width+x)*4+3]=255;
  }
  return px;
}
const resize=preparation.resizePillowLanczosU8;
test('shared Pillow U8 Lanczos kernel is callable by foreground preparation',()=>{
  assert.equal(typeof resize,'function','missing shared Pillow U8 Lanczos export');
});
for(const c of cases)test('actual Pillow output: '+[c.w,c.h,c.channels,c.ow,c.oh].join('x'),{skip:!resize},()=>{
  const pixels=fixtureImage(c.w,c.h,c.seed,c.channels),before=sha(pixels);
  assert.equal(before,c.inputSha256);
  const output=resize(pixels,c.w,c.h,c.ow,c.oh,c.channels);
  assert.equal(output instanceof Uint8Array,true);
  assert.equal(output.length,c.ow*c.oh*c.channels);
  assert.equal(sha(output),c.outputSha256);
  assert.equal(sha(pixels),before,'caller pixels must not be modified');
});
test('no-op returns independent U8 storage, including clamped input',{skip:!resize},()=>{
  for(const Type of [Uint8Array,Uint8ClampedArray]){
    const pixels=new Type([1,17,255,42]);
    const output=resize(pixels,2,2,2,2,1);
    assert.equal(output instanceof Uint8Array,true);
    assert.deepEqual([...output],[...pixels]);
    assert.notEqual(output.buffer,pixels.buffer);
    output[0]=99;assert.equal(pixels[0],1);
  }
});
test('four-channel planes do not silently premultiply alpha',{skip:!resize},()=>{
  const pixels=Uint8Array.from([200,33,99,0,40,211,7,255]);
  const result=resize(pixels,2,1,5,1,4);
  for(let channel=0;channel<4;channel++){
    const single=resize(Uint8Array.from([pixels[channel],pixels[channel+4]]),2,1,5,1,1);
    assert.deepEqual([...result.filter((_,i)=>i%4===channel)],[...single]);
  }
});
test('invalid shape, type, channel count or incomplete rows fail visibly',{skip:!resize},()=>{
  for(const args of [
    [new Float32Array(3),1,1,2,2,3],
    [new Uint8Array(2),1,1,2,2,3],
    [new Uint8Array(3),0,1,2,2,3],
    [new Uint8Array(3),1,1,0,2,3],
    [new Uint8Array(3),1,1,2.5,2,3],
    [new Uint8Array(3),1,1,2,Infinity,3],
    [new Uint8Array(2),1,1,2,2,2],
    [new Uint8Array(3),Number.MAX_SAFE_INTEGER,2,2,2,3]
  ])assert.throws(()=>resize(...args),/U8|dimensions|channels/);
});
