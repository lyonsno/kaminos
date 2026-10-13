// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as inputs from '../generation-inputs.js';

const reference=JSON.parse(readFileSync(new URL('./fixtures/prepared-rgb-source-normalization.json',import.meta.url)));
const count=512*512*3;
function rgb(Type=Uint8Array){return Type.from({length:count},(_,i)=>i%256);}
const hash=data=>createHash('sha256').update(data).digest('hex');
function normalize(pixels,width=512,height=512){
  assert.equal(typeof inputs.normalizePreparedTrellisRgb,'function',
    'prepared RGB must have a browser-callable normalization boundary before model input');
  return inputs.normalizePreparedTrellisRgb({pixels,width,height});
}

test('prepared RGB produces the exact observed source F32 bits for every channel/byte value',()=>{
  const pixels=rgb(),before=pixels.slice();
  const actual=normalize(pixels);
  assert.ok(actual instanceof Float32Array);
  assert.equal(actual.length,count);
  assert.equal(hash(pixels),reference.rgbSha256);
  assert.deepEqual(pixels,before,'caller-owned prepared pixels remain unchanged');
  const period=Buffer.from(reference.periodLittleEndianBase64,'base64');
  assert.equal(period.length,reference.periodValues*4);
  const bits=new DataView(actual.buffer,actual.byteOffset,actual.byteLength);
  for(let i=0;i<count;i++)assert.equal(bits.getUint32(i*4,true),period.readUInt32LE(i%reference.periodValues*4),'source rounding at value '+i);
  assert.equal(hash(new Uint8Array(actual.buffer,actual.byteOffset,actual.byteLength)),reference.normalizedSha256);
  assert.equal(reference.modelCalls,0);
});

test('clamped browser RGB views honor their offset and do not mutate or alias caller storage',()=>{
  const backing=new Uint8ClampedArray(count+12);backing.fill(231);
  const pixels=backing.subarray(5,5+count);pixels.set(rgb());
  const before=backing.slice(),a=normalize(pixels),b=normalize(pixels);
  assert.equal(hash(new Uint8Array(a.buffer)),reference.normalizedSha256);
  assert.deepEqual(backing,before);assert.notEqual(a.buffer,backing.buffer);assert.notEqual(a.buffer,b.buffer);
  a[0]=123;assert.notEqual(b[0],123);
});

test('normalization refuses RGBA, wrong extent, wrong type and missing dimensions instead of preparing implicitly',()=>{
  const pixels=rgb();
  for(const value of [new Uint8Array(512*512*4),new Uint8Array(count-1),new Uint16Array(count),new Float32Array(count),Array.from(pixels),null])
    assert.throws(()=>normalize(value),/complete prepared 512x512 RGB bytes/);
  for(const [width,height]of [[1024,256],[256,1024],[512,undefined],[undefined,512],[512.5,512]])
    assert.throws(()=>inputs.normalizePreparedTrellisRgb({pixels,width,height}),/complete prepared 512x512 RGB bytes/);
});
