// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import * as THREE from 'three';
import PMREMGenerator from 'three/src/renderers/common/extras/PMREMGenerator.js';
import {readFileSync} from 'node:fs';
const source=readFileSync(process.env.KAMINOS_STARTUP_TEST_INDEX || new URL('../index.html',import.meta.url),'utf8');
const code=source.slice(source.indexOf('async function loadEnvironment('),source.indexOf('\nfunction applyEnvMap('));
test('environment selection returns while actual HDR resource is unresolved',async()=>{
 let done=false;const node={style:{},classList:{toggle(){}}};
 const c={HDR_ENVS:{sunset:{url:'sunset.hdr',label:'Sunset'}},environmentLoadToken:0,envCache:{},
  sceneEnvironment:{select(){}},document:{querySelectorAll:()=>[],getElementById:()=>node},
  readEnvironmentRecipe:()=>({intensity:1}),RGBELoader:class {load(){}},
  environmentLoader:{select:()=>({name:'sunset',pending:true})}};
 vm.runInNewContext(code,c);c.loadEnvironment('sunset').then(()=>done=true);await new Promise(r=>setImmediate(r));
 assert.equal(done,true,'selected environment must not hold scene restoration behind its HDR download');
});
test('ordinary scene restore holds full-detail work until restoration settles and a frame can paint',async()=>{
 const start=source.indexOf('async function loadSceneFile('),end=source.indexOf('\nasync function applySceneDocument(',start);
 let held=0,finish;const frames=[];const pending=new Promise(r=>finish=r);
 const c={authoringBusy:false,vantageCaptureHeld:false,scenePlacementTools:null,
  environmentLoader:{holdFull(){held++;return()=>held--;}},sceneDocument:{restore:()=>pending},
  requestAnimationFrame:fn=>frames.push(fn),setTimeout:fn=>fn()};
 vm.runInNewContext(source.slice(start,end),c);const restored=c.loadSceneFile({},{});
 assert.equal(held,1);finish(true);assert.equal(await restored,true);assert.equal(held,1);
 frames.shift()();assert.equal(held,0);
});

test('pending environment supports the renderer minimum PMREM mip resolution',()=>{
 const start=source.indexOf('function createPendingEnvironment('),end=source.indexOf('\nfunction createProceduralEnv(',start);
 const sizing={_setSize:PMREMGenerator.prototype._setSize};
 const c={THREE,pmremGenerator:{fromEquirectangular(texture){
  PMREMGenerator.prototype._setSizeFromTexture.call(sizing,texture);return {texture:{}};
 }}};
 vm.runInNewContext(source.slice(start,end),c);c.createPendingEnvironment();
 // The installed PMREMGenerator has LOD_MIN=4 (16px faces); smaller inputs
 // produce an undersized atlas, even though its texture object exists.
 assert.ok(sizing._cubeSize>=16,'placeholder must populate the PMREM minimum 16px cube faces');
});
