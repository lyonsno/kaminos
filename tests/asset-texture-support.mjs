// kaminos-test: node
import assert from 'node:assert/strict';
import {configureAssetTextures} from '../asset-texture-support.mjs';
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
console.log('Asset texture support contracts passed');
