// kaminos-test: node
import assert from 'node:assert/strict';
import {configureAssetTextures,prepareKtx2Texture} from '../asset-texture-support.mjs';
import {CompressedTexture,RGBAFormat,RGBA_ASTC_4x4_Format,SRGBColorSpace,LinearMipmapLinearFilter} from '../lib/three.core.js';
let created=0,detected=[];
const create=()=>({setTranscoderPath(path){assert.match(path,/\/lib\/addons\/libs\/basis\/$/);return this;},detectSupport(r){detected.push(r);return this;}});
const renderer={},loader={setKTX2Loader(value){this.ktx2Loader=value;return this;}};
assert.equal(configureAssetTextures(loader,renderer,()=>{created++;return create();}),loader);
assert.ok(loader.ktx2Loader,'ordinary GLB loading must mount the compressed texture consumer');
const another={...loader,ktx2Loader:null};configureAssetTextures(another,renderer,()=>{created++;return create();});
assert.equal(another.ktx2Loader,loader.ktx2Loader,'one transcoder pool per renderer, across asset loads');
assert.deepEqual(detected,[renderer]);assert.equal(created,1);
const other={...loader,ktx2Loader:null};configureAssetTextures(other,{},create);assert.notEqual(other.ktx2Loader,loader.ktx2Loader,'device routes must detect their own capabilities');
assert.throws(()=>configureAssetTextures({...loader},null,create),/initialized renderer/);
const failure={};assert.throws(()=>configureAssetTextures({...loader},failure,()=>({setTranscoderPath(){return this;},detectSupport(){throw Error('unsupported renderer');}})),/unsupported renderer/);
configureAssetTextures({...loader},failure,create); // A failed setup cannot poison later attempts.
// Observed Three r185 KTX2 RGBA fallback keeps a CompressedTexture wrapper.
// The local WebGPU uploader routes by the wrapper and cannot upload that data.
const mipmaps=[{data:new Uint8Array(4*4*4),width:4,height:4},{data:new Uint8Array(2*2*4),width:2,height:2}];
const rgba=new CompressedTexture(mipmaps,4,4,RGBAFormat);
rgba.colorSpace=SRGBColorSpace;rgba.minFilter=LinearMipmapLinearFilter;rgba.generateMipmaps=false;
const fallback=prepareKtx2Texture(rgba);
assert.equal(fallback.isDataTexture,true,'RGBA transcodes must use the uncompressed upload path');
assert.equal(fallback.isCompressedTexture,undefined,'RGBA must never enter block-compressed upload');
assert.deepEqual(fallback.image,{data:mipmaps[0].data,width:4,height:4});
assert.equal(fallback.mipmaps,mipmaps,'all authored mips survive fallback');
assert.equal(fallback.colorSpace,SRGBColorSpace);assert.equal(fallback.minFilter,rgba.minFilter);
assert.equal(fallback.generateMipmaps,false);assert.equal(fallback.flipY,rgba.flipY);
const astc=new CompressedTexture(mipmaps,4,4,RGBA_ASTC_4x4_Format);
assert.equal(prepareKtx2Texture(astc),astc,'supported compressed payloads keep their format and identity');
assert.equal(prepareKtx2Texture(fallback),fallback,'ordinary textures are unchanged');
console.log('Asset texture support contracts passed');
