// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import {createPreparedAssetPool,disposePreparedAsset,prepareSceneAssetBatch} from '../scene-asset-preparation.mjs';
let loads=0;
const pool=createPreparedAssetPool({load:async()=>{loads++;return {scene:new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial()))};}});
const [a,b]=await Promise.all([pool.acquire('same'),pool.acquire('same')]);
assert.equal(loads,1,'a content identity must prepare once for repeated scene instances');
assert.notEqual(a.scene,b.scene,'each instance owns its scene root');
assert.notEqual(a.scene.children[0].geometry,b.scene.children[0].geometry,'editing one instance must not mutate another');
console.log('Prepared scene assets share decoding and retain independent instances');

const map=new THREE.DataTexture(new Uint8Array([10,20,30,255]),1,1);
let rootLoads=0;const resources=createPreparedAssetPool({load:async()=>{rootLoads++;return new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial({map})));}});
const x=await resources.acquire('root'),y=await resources.acquire('root');
x.children[0].material.map.image.data[0]=99;
assert.equal(y.children[0].material.map.image.data[0],10,'pixel edits are instance-local');
disposePreparedAsset(x);const z=await resources.acquire('root');assert.equal(rootLoads,1,'live instances keep shared preparation resident');
disposePreparedAsset(y);disposePreparedAsset(z);assert.equal(resources.state().entries,0,'last consumer releases template');
let attempts=0;const failed=createPreparedAssetPool({load:async()=>{if(attempts++===0)throw Error('network failed');return new THREE.Group();}});
await assert.rejects(failed.acquire('retry'),/network failed/);const retry=await failed.acquire('retry');assert.equal(attempts,2);disposePreparedAsset(retry);
let unsupportedLoads=0;const unsupported=createPreparedAssetPool({load:async()=>{unsupportedLoads++;const group=new THREE.Group();group.type='CustomSimulation';return group;}});
const custom=await Promise.all([unsupported.acquire('custom'),unsupported.acquire('custom')]);assert.equal(unsupportedLoads,2);assert.notEqual(custom[0],custom[1]);
const freed=[];await assert.rejects(prepareSceneAssetBatch([{id:'a',source:'ok',type:'glb'},{id:'b',source:'bad',type:'glb'}],{acquire:async source=>{if(source==='bad')throw Error('bad source');return source;},dispose:value=>freed.push(value)}),/preparation failed/);assert.deepEqual(freed,['ok']);
console.log('Prepared ownership, retry, unsupported fallback and batch failure contracts pass');
