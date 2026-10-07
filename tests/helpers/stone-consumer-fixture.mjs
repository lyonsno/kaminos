import fs from 'node:fs';
import * as Three from 'three';
import { OrbitControls as NativeOrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildGpuStoneFixture, preparedContactNormal } from '../../structural-material-stone-fixture.js';

// Actual consumer and OrbitControls, with acquisition/rendering substituted only for local lifecycle tests.
export async function stoneConsumerFixture() {
  const bytes=fs.readFileSync(new URL('../../artifacts/imported-stone-thickness/prepared.json',import.meta.url)),prepared=JSON.parse(bytes),nodes=new Map(),listeners=new Map();
  let renders=0,steps=0,frame,armed=false,resolveGate,entered;
  const node=id=>{if(!nodes.has(id))nodes.set(id,{value:id==='#strength'?'200':'0',max:'1.2',setAttribute(){},replaceChildren(){},append(){}});return nodes.get(id);};
  const ownerDocument={addEventListener(){},removeEventListener(){}},canvas={style:{},clientWidth:1280,clientHeight:900,ownerDocument,
    getRootNode(){return ownerDocument;},addEventListener(name,fn){listeners.set(name,fn);},removeEventListener(){},getBoundingClientRect(){return{left:0,top:0,width:1280,height:900};}};
  const createModel=async fixture=>{
    if(armed){armed=false;entered();await new Promise(r=>resolveGate=r);}
    const state={config:fixture.config,step:30,hand:null,broken:0,connectivityEpoch:0,bonds:fixture.bonds.map(b=>({...b,alive:true})),
      bodies:fixture.cells.map(c=>({...c,position:Object.fromEntries(['x','y','z'].map((a,i)=>[a,c.position[i]])),quaternion:{x:0,y:0,z:0,w:1}}))};
    return{cells:fixture.cells,snapshot:()=>state,dispose(){},release(){state.hand=null;},setStrength(v){state.config.strength=v;},
      setSurfaceHand(index,target){state.hand={index,target:{...target},force:{x:0,y:0,z:0}};},moveHand(p){state.hand.target={...p};},async step(){steps++;state.step++;}};
  };
  globalThis.__stoneConsumerTest={renderer:{setPixelRatio(){},setSize(){},render(){renders++;}},device:{addEventListener(){},lost:new Promise(()=>{}),queue:{async onSubmittedWorkDone(){}}},identity:{architecture:'synthetic-consumer-only'},createModel,
    assets:[{sha256:prepared.sourceSha256,material:new Three.MeshStandardMaterial()}],buildGpuStoneFixture,preparedContactNormal,OrbitControls:NativeOrbitControls};
  Object.assign(globalThis,{innerWidth:1280,innerHeight:900,devicePixelRatio:1,location:{search:'?smoke=1'},window:{},document:{querySelector:node,createElement:()=>canvas},
    addEventListener(){},requestAnimationFrame:fn=>frame=fn,fetch:async()=>({ok:true,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)})});
  const source=fs.readFileSync(new URL('../../structural-material-stone-view.js',import.meta.url),'utf8')
    .replace("import * as THREE from 'three/webgpu';",`import * as THREE from '${import.meta.resolve('three')}';`)
    .replace("import { OrbitControls } from 'three/addons/controls/OrbitControls.js';",'const {OrbitControls}=globalThis.__stoneConsumerTest;')
    .replace("import { createElement, Pause, Play, RotateCcw, Hand } from 'lucide';",'const createElement=()=>({}),Pause={},Play={},RotateCcw={},Hand={};')
    .replace("import { createNativeGpuRenderer } from './dist/structural-material-arch-gpu-engine.js';",'const createNativeGpuRenderer=async()=>globalThis.__stoneConsumerTest;')
    .replace("import { createGpuStructuralFixture } from './structural-material-arch-gpu.js';",'const createGpuStructuralFixture=globalThis.__stoneConsumerTest.createModel;')
    .replace("import { buildGpuStoneFixture, preparedContactNormal } from './structural-material-stone-fixture.js';",'const {buildGpuStoneFixture,preparedContactNormal}=globalThis.__stoneConsumerTest;')
    .replace("import { loadStoneAssets } from './structural-material-arch-stones.js';",'const loadStoneAssets=async()=>globalThis.__stoneConsumerTest.assets;');
  await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  return{api:window.__stoneThickness,node,listeners,counts:()=>({renders,steps}),frame:()=>frame(performance.now()+20),
    holdNextAcquisition(){armed=true;return new Promise(r=>entered=r);},releaseAcquisition:()=>resolveGate()};
}
