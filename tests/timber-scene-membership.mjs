import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const host=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const clear=host.match(/function clearScene\([^\n]*\) \{[\s\S]*?\n\}/)[0];
let gpuClears=0, runtimeDisposals=0;
const object={};
const context={sceneLoadRequests:{invalidate(){}},authoringControlSessions:[],sceneControlHistory:null,
  scenePlacementTools:{clear(){},edits:{unregister(){}}},groupProxies:new Map(),meshDataTargets:new Set(),groupEditTargets:new Set(),
  proceduralMeshes:new Map(),flameDomainGuide:null,compoundInsertionTargets:new Set(),compoundRetentionTargets:new Set(),
  sceneMembershipEditTargets:new Set(),sceneMutationToken:1,localLiquidGeneration:1,localLiquidHost:null,localLiquidSetup:null,
  localLiquidFailure:null,localLiquidPaused:false,sceneSpotLights:new Map(),sceneObjects:[{id:'timber',object}],scene:{remove(){}},
  disposeObjectTree(){},greenroomPreviewState:null,currentMesh:object,rimLight:null,sceneGroups:[],transformControls:null,
  document:{getElementById(){return {classList:{remove(){}}};}},renderSceneObjectList(){},updateTransformInspector(){},
  savedMeshCombustionRuntime:{entries:[{object}],runtime:{dispose(){runtimeDisposals++;}}},
  volumePrototype:{clearGpuStructuralCombustionAssembly(){gpuClears++;}},
};
runInNewContext(`${clear};clearScene();`,context);
assert.equal(gpuClears,1,'ordinary scene clearing must remove timber physics');
assert.equal(runtimeDisposals,1,'ordinary scene clearing must release timber material resources');
assert.equal(context.savedMeshCombustionRuntime,null);
assert.equal(context.sceneObjects.length,0);
console.log('ordinary scene clear releases timber combustion: ok');
