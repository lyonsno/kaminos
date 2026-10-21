// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
const start=source.indexOf('  function encodeWorldSmoke(');
const body=source.slice(start,source.indexOf('\n  }',start)+4);
test('world collision receives current remaining-material masks, including their removal',()=>{
  const mask={objectId:'burning-log',revision:17,texture:{}},calls=[];
  let masks=[mask];
  const ctx={getSceneCollision:()=>({requested:true,id:'burning-log',object:{}}),
    worldSmoke:{anchor:{translate:[0,0,0],scale:1},encode:()=>({})},
    worldSolidProducer:{update(...args){calls.push(args);return {triangleCount:0};}},
    gpuThermalConsumer:{materialMasks:()=>masks},controlsSnapshot:{worldSmokeExtent:2},
    resolveTimeStepConfig:()=>({effective:{}}),resolvePhysicsAppearance:()=>({}),
    resolveVelocityStaggeringConfig:()=>({effective:{mode:'cell'}}),state:{},
    fluidBuffers:[{}],reactantTextures:[{}],currentFluid:0,gridSize:4,gridHeight:8,
    productTransform:{translate:[0,0,0],scale:1},worldSmokeMapping:()=>({renderMin:[0,0,0],renderMax:[1,1,1],renderPitch:1}),
    device:{queue:{writeBuffer(){}}},worldRenderUniform:{},uniforms:[],Float32Array};
  vm.createContext(ctx);vm.runInContext(body,ctx);
  const plan={flowDims:[4,8,4],min:[-1,-1,-1],max:[1,3,1]};
  ctx.encodeWorldSmoke({},plan);
  assert.equal(calls[0][3]?.materialMasks,masks,'world uses the same live material-mask snapshot as fine collision');
  masks=[];ctx.encodeWorldSmoke({},plan);
  assert.equal(calls[1][3]?.materialMasks,masks,'removed masks must not remain cached');
  ctx.gpuThermalConsumer=null;ctx.encodeWorldSmoke({},plan);
  assert.equal(calls[2][3]?.materialMasks.length,0,'ordinary unburned obstacles remain supported');
});
