// kaminos-test: node
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const target=new URL('../models/trellis2/alpha-preparation.js',import.meta.url);
const module=await import(target).catch(error=>{
  if(error.code==='ERR_MODULE_NOT_FOUND'&&error.url===target.href)return {};
  throw error;
});
const fixture=JSON.parse(await readFile(new URL('../models/trellis2/tests/fixtures/alpha-preparation-source.json',import.meta.url),'utf8'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function pattern({width,height,variant}){
  const rgba=new Uint8Array(width*height*4),alphas=[0,64,127,204,205,254,255];
  const x0=variant%2?0:1,x1=variant%3?width-1:width-2;
  const y0=variant%3?0:1,y1=variant%2?height-1:height-2;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4;
    for(let c=0;c<3;c++)rgba[i+c]=(x*37+y*101+c*79+variant*17)%256;
    rgba[i+3]=x<x0||x>x1||y<y0||y>y1?0:alphas[(x+y*3+variant)%7];
  }
  return rgba;
}
test('source-matched alpha conditioning is a callable without Python',()=>{
  assert.equal(typeof module.prepareTrellisAlphaRgba,'function','missing browser alpha-to512RGB capability');
});
for(const row of fixture.cases)test('complete actual-source pixels: '+row.name,{skip:!module.prepareTrellisAlphaRgba},async()=>{
  const rgba=pattern(row),before=sha(rgba);
  assert.equal(before,row.inputRgbaSha256,'The complete source RGBA must match the observed fixture input.');
  const result=await module.prepareTrellisAlphaRgba({pixels:rgba,width:row.width,height:row.height});
  assert.equal(result.width,512);assert.equal(result.height,512);
  assert.equal(result.pixels instanceof Uint8Array,true);
  assert.equal(result.pixels.byteLength,row.preparedByteLength);
  assert.equal(sha(result.pixels),row.preparedRgbSha256,'All512RGB bytes must match the actual pinned source.');
  assert.equal(result.provenance.foregroundPixels,row.foregroundPixels);
  assert.deepEqual(result.provenance.foregroundBbox,row.foregroundBbox);
  assert.deepEqual(result.provenance.crop,row.crop);
  assert.deepEqual(result.provenance.scaledSize,row.scaledSize);
  assert.equal(result.provenance.croppedRgbSha256,row.croppedRgbSha256);
  assert.equal(sha(rgba),before,'Preparation preserves caller-owned RGBA.');
});
test('invalid/empty/opaque input and Stop cannot pretend to be prepared foreground',{skip:!module.prepareTrellisAlphaRgba},async()=>{
  const prepare=module.prepareTrellisAlphaRgba,row=fixture.cases[0],pixels=pattern(row);
  for(const bad of [{pixels:pixels.slice(1),width:row.width,height:row.height},
    {pixels:new Float32Array(pixels),width:row.width,height:row.height},
    {pixels,width:0,height:row.height}])
    await assert.rejects(prepare(bad),/complete.*RGBA|dimensions/);
  const opaque=pixels.slice();for(let i=3;i<opaque.length;i+=4)opaque[i]=255;
  await assert.rejects(prepare({pixels:opaque,width:row.width,height:row.height}),/alpha cutout/);
  const empty=pixels.slice();for(let i=3;i<empty.length;i+=4)empty[i]=204;
  await assert.rejects(prepare({pixels:empty,width:row.width,height:row.height}),/foreground/);
  const control=new AbortController();control.abort();
  await assert.rejects(prepare({pixels,width:row.width,height:row.height,signal:control.signal}),error=>error.name==='AbortError');
});
