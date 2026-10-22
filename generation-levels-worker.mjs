// Module worker for generation-levels-runner.mjs: prepareGenerationLevels with the page's own finisher,
// UV unwrapper and same-origin fetch. Posts {kind:'phase'} progress and one {kind:'done', report}.
import * as THREE from './lib/three.core.js';
// three-mesh-bvh rebuilt to import ./three.core.js by URL (npm run build:three-mesh-bvh): workers have no import map.
import {MeshBVH} from './lib/three-mesh-bvh.module.js';
import * as levels from './lod-generation-levels.mjs';
import {admitLevelsRequest} from './generation-levels-admission.mjs';
import {finishTrellisMesh} from './models/trellis2/trellis-material.js';
import {createWasmXatlasUnwrapper} from './models/trellis2/wasm-xatlas.js';

self.addEventListener('message',async({data})=>{
  let report;
  try{
    report=admitLevelsRequest(levels,data)??await levels.prepareGenerationLevels({...data,THREE,MeshBVH,finish:finishTrellisMesh,
      unwrapMesh:createWasmXatlasUnwrapper({WorkerClass:Worker}),WorkerClass:Worker,
      onPhase:phase=>self.postMessage({kind:'phase',...(typeof phase==='object'?phase:{phase})})});
  }catch(error){report={phase:'worker',error:String(error?.message||error)};}
  self.postMessage({kind:'done',report:JSON.parse(JSON.stringify(report??{phase:'worker',error:'no report'}))});
});
