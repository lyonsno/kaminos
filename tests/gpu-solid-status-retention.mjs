// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const core=fs.readFileSync(new URL('../volume-core.js',import.meta.url),'utf8'),html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const method=core.match(/    async sampleSceneCollisionMask\([\s\S]*?\n    },/)[0].replace(/,$/,'');
const state={sceneCollision:{requested:true,effective:'mesh-voxel-solid',backend:'gpu',reason:null,validation:'gpu-resident-unread',members:[]}};
const context={state,emitStatus(){},sceneSolidRevisionKey:'initial',sceneSolidGpu:{snapshot:async()=>({valid:false,cells:new Uint8Array(1),counts:[0],members:[]})},gridSize:1,gridHeight:1,structuredClone,analyticEmitterDescriptor:null,analyticEmitterDispatch:{},countEmitterChemicalSupport:()=>({})};
const api=vm.runInNewContext(`({${method}})`,context);
const sample=await api.sampleSceneCollisionMask();assert.equal(sample.runtime.effective,'off');
assert.equal(state.sceneCollision.effective,'off','Explicit same-revision rejection must reach ordinary readers');
const status={},inspector={...context,document:{getElementById:id=>id==='kiln-collision-status'?status:{}},isAuthoredKilnCollisionRoute:()=>true,sceneObjects:[{collision:{enabled:true}}],syncCollisionVoxelView(){},volumePrototype:{debugState:()=>({sceneCollision:state.sceneCollision})}};
const fn=html.slice(html.indexOf('function syncKilnCollisionControl('),html.indexOf('\nfunction installKilnCollisionControl('));
vm.runInNewContext(fn+';syncKilnCollisionControl();',inspector);assert.match(status.textContent,/Unavailable.*does-not-intersect/);
state.sceneCollision={requested:true,effective:'mesh-voxel-solid',backend:'gpu',validation:'gpu-resident-unread'};
vm.runInNewContext(fn+';syncKilnCollisionControl();',inspector);assert.match(status.textContent,/unverified/i,'A new submitted revision must not inherit prior acceptance');
let resolve;context.sceneSolidGpu={snapshot:()=>new Promise(r=>{resolve=r;})};
const pending=api.sampleSceneCollisionMask();context.sceneSolidRevisionKey='new-revision';
resolve({valid:false,cells:new Uint8Array(1),counts:[0],members:[]});assert.equal((await pending).status,'stale');assert.equal(state.sceneCollision.validation,'gpu-resident-unread');
