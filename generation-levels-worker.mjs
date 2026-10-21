// Module worker for generation-levels-runner.mjs: prepareGenerationLevels with the page's own finisher,
// UV unwrapper and same-origin fetch. Posts {kind:'phase'} progress and one {kind:'done', report}.
import * as THREE from './lib/three.core.js';
import {MeshBVH} from './node_modules/three-mesh-bvh/build/index.module.js';
import {prepareGenerationLevels} from './lod-generation-levels.mjs';
import {finishTrellisMesh} from './models/trellis2/trellis-material.js';
import {createWasmXatlasUnwrapper} from './models/trellis2/wasm-xatlas.js';

self.addEventListener('message',async({data})=>{
  let report;
  try{
    report=await prepareGenerationLevels({...data,THREE,MeshBVH,finish:finishTrellisMesh,
      unwrapMesh:createWasmXatlasUnwrapper({WorkerClass:Worker}),WorkerClass:Worker,
      onPhase:phase=>self.postMessage({kind:'phase',...(typeof phase==='object'?phase:{phase})})});
  }catch(error){report={phase:'worker',error:String(error?.message||error)};}
  self.postMessage({kind:'done',report:JSON.parse(JSON.stringify(report??{phase:'worker',error:'no report'}))});
});
