// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {RGBELoader} from 'three/examples/jsm/loaders/RGBELoader.js';
import {FloatType} from 'three';
const root=new URL('../assets/hdr/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('environment-previews.json',root)));
const decode=file=>{const b=readFileSync(new URL(file,root));return {bytes:b,...new RGBELoader().setDataType(FloatType).parse(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength))};};
function energy(image){const result=[0,0,0];for(let y=0;y<image.height;y++){const weight=(Math.cos(Math.PI*y/image.height)-Math.cos(Math.PI*(y+1)/image.height))/image.width;for(let x=0;x<image.width;x++)for(let c=0;c<3;c++)result[c]+=image.data[(y*image.width+x)*4+c]*weight;}return result;}
for(const asset of manifest.assets)test(`${asset.previewFile} retains linear lighting energy and source identity`,()=>{
 const full=decode(asset.fullFile),preview=decode(asset.previewFile);
 assert.deepEqual([preview.width,preview.height],[128,64]);
 for(const [image,key] of [[full,'fullSha256'],[preview,'previewSha256']])assert.equal(createHash('sha256').update(image.bytes).digest('hex'),asset[key]);
 const a=energy(full),b=energy(preview);for(let c=0;c<3;c++)assert.ok(Math.abs(b[c]-a[c])/a[c]<.015,`channel ${c}: ${b[c]} vs ${a[c]}`);
 assert.ok(preview.bytes.length<full.bytes.length/10,'preview must be materially smaller');
});
