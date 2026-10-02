import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import {outerSmokeConfig, validateOuterSmokeDevice} from '../volume-outer-smoke.mjs';
import {voxelizeTriangleSolid, packSolidTextureRows, assertEffectiveSceneCollision} from '../volume-scene-solid.mjs';

const limits={maxTextureDimension3D:2048,maxBufferSize:1e9,maxStorageBufferBindingSize:1e9,maxComputeWorkgroupsPerDimension:65535};
test('accepted outer lattices have actual donor samples',()=>{
  for(const [grid,extent] of [[10,4],[8,3]]) {
    assert.throws(()=>validateOuterSmokeDevice(outerSmokeConfig({grid,extent}),limits),/donor.*lattice/);
  }
  assert.doesNotThrow(()=>validateOuterSmokeDevice(outerSmokeConfig(),limits));
});

// Execute the actual browser admission functions with allocation/draw boundaries
// stubbed. The real voxelizer remains in the path; this is not a GPU witness.
const source=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
function functionSource(name){
  const start=source.indexOf(`  function ${name}(`);
  if(start<0)return '';
  const end=source.indexOf('\n  function ',start+12);
  return source.slice(start,end<0?undefined:end);
}
test('exterior-only geometry stays installed without a fake near collision',()=>{
  const triangles=[
    [[-1.5,3.5,-1.5],[1.5,3.5,-1.5],[1.5,3.5,1.5]],
    [[-1.5,3.5,-1.5],[1.5,3.5,1.5],[-1.5,3.5,1.5]],
  ];
  let installedOuter=null,installedNear=null;
  const context=vm.createContext({device:{},getSceneCollision:()=>({requested:true,id:'exterior-ceiling',object:{}}),
    controlsSnapshot:{},PRESSURE_SOLVER_CONVERGED:'converged',
    resolvePressureSolverConfig:()=>({effective:{solver:'converged',dispatch:'full',projection:'full'}}),
    resolveTransportConfig:()=>({effective:{commonCharacteristic:true,scheme:'maccormack'}}),
    sceneSolidRevision:()=> 'ceiling-revision',productTransform:{},sceneSolidRevisionKey:null,
    analyticEmitterDispatch:{active:false,cellMin:[0,0,0],cellExtent:[0,0,0],cellCount:0},
    analyticEmitterDescriptorSignature:'none',analyticEmitterDescriptor:null,
    gridSize:16,gridHeight:32,performance,
    trianglesFromSceneObject:()=>({triangles}),voxelizeTriangleSolid,packSolidTextureRows,
    outerConfig:outerSmokeConfig(),
    outerSmoke:{setSolids(packed){installedOuter=packed;},clearSolids(){installedOuter=null;}},
    countEmitterChemicalSupport:()=>({fluidSupportCells:0}),
    sceneSolidCellsCpu:null,installSceneSolidTexture(field){installedNear=field;},
    rebuildSceneSolidBindingViews(){},state:{simStepCount:0},
  });
  vm.runInContext(functionSource('refreshSceneCollision')+'\nrefreshSceneCollision();',context);
  assert.equal(context.state.sceneCollision.effective,'mesh-voxel-solid',context.state.sceneCollision.reason);
  assert.ok(installedOuter?.data.some(x=>x!==0));
  assert.equal(installedNear.surfaceCellCount,0);
  assert.ok(context.state.sceneCollision.outerSolidCellCount>0);
  assert.doesNotThrow(()=>assertEffectiveSceneCollision({...context.state.sceneCollision,
    sourceSupport:{fluidSupportCells:1}},'exterior-ceiling'));
  context.getSceneCollision=()=>({requested:false});
  vm.runInContext('refreshSceneCollision();',context);
  assert.equal(installedOuter,null,'disabling collision clears the exterior mask too');
});

test('draw admission rejects an unsupported mode even when simulation is paused',()=>{
  const uniforms=new Float32Array(600);uniforms[368]=0;
  const context=vm.createContext({outerRequested:true,productFrameOwner:'prototype',uniforms,
    controlsSnapshot:{},PRESSURE_SOLVER_CONVERGED:'converged',gridSize:64,gridHeight:128,
    resolvePressureSolverConfig:()=>({effective:{solver:'converged',dispatch:'full',projection:'full'}}),
    resolveTransportConfig:()=>({effective:{commonCharacteristic:true}}),
    ordinarySceneDepthFallback:null,device:{createTexture(){throw new Error('GPU draw reached before route admission');}},
    GPUTextureUsage:{TEXTURE_BINDING:1,RENDER_ATTACHMENT:2},
    pipeline:{},simulationPaused:true,
  });
  vm.runInContext(functionSource('assertOuterRoute')+functionSource('encodeDraw'),context);
  assert.throws(()=>vm.runInContext('encodeDraw({},null,"paused")',context),/outer smoke requires/);
  uniforms[368]=2;
  assert.throws(()=>vm.runInContext('encodeDraw({},null,"paused")',context),/GPU draw reached/,
    'admitted frozen emissive rendering reaches the actual draw boundary');
});
