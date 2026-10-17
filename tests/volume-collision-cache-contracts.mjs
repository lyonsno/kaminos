// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as THREE from '../lib/three.core.js';
import * as solid from '../volume-scene-solid.mjs';
import * as core from '../volume-core.js';
const source=readFileSync(process.env.KAMINOS_CACHE_SOURCE || new URL('../volume-core.js',import.meta.url),'utf8');
const base={pressureSolver:'converged-open-top',projection:1,advectionScheme:'maccormack',commonGasTransport:true,emitterSourceLaw:'immersed-source',immersedRadius:.2,immersedCentreY:0,immersedBackWall:1};
function collision(){
 const mesh=new THREE.Mesh(new THREE.BoxGeometry(.25,.25,.25));mesh.position.set(.55,.5,.55);
 const ctx={device:{},gridSize:32,gridHeight:64,state:{},controlsSnapshot:{...base},productTransform:{translate:[0,0,0],scale:1},sceneSolidRevisionKey:null,sceneSolidCellsCpu:null,sceneSolidSupportCache:null,sceneSolidGeometryCache:null,immersedWallCache:null,analyticEmitterDescriptor:null,analyticEmitterDescriptorSignature:'',analyticEmitterDispatch:{active:false,cellMin:[0,0,0],cellExtent:[0,0,0],cellCount:0},PRESSURE_SOLVER_CONVERGED:'converged',...solid,immersedBackWallCells:core.immersedBackWallCells,composeSolidField:core.composeSolidField,resolvePressureSolverConfig:core.resolvePressureSolverConfig,resolveTransportConfig:core.resolveTransportConfig,performance};
 ctx.sceneSolidGpu=null;
 const counts={geometry:0,walls:0,uploads:0,bindings:0};
 ctx.getSceneCollision=()=>({requested:true,id:'kiln',object:mesh});
 ctx.joinedExterior=null;ctx.getSceneEditing=()=>null;ctx.state.joinedBoundary={admitted:true};
 ctx.voxelizeTriangleSolid=(...args)=>{counts.geometry++;return solid.voxelizeTriangleSolid(...args);};
 ctx.immersedBackWallCells=(...args)=>{counts.walls++;return core.immersedBackWallCells(...args);};
 ctx.installSceneSolidTexture=(field=null)=>{counts.uploads++;ctx.sceneSolidCellsCpu=field?.cells??null;return true;};
 ctx.rebuildSceneSolidBindingViews=()=>{counts.bindings++;};
 vm.createContext(ctx);const from=source.indexOf('  function immersedBackWallForState()');
 vm.runInContext(source.slice(from,source.indexOf('  function fluidBindGroup(',from)),ctx);
 const refresh=patch=>{Object.assign(ctx.controlsSnapshot,patch);ctx.state.immersedSource=core.resolveImmersedSourceConfig(ctx.controlsSnapshot,{grid:ctx.gridSize,gridHeight:ctx.gridHeight});vm.runInContext('refreshSceneCollision()',ctx);assert.equal(ctx.state.sceneCollision.reason,null);};
 return {ctx,counts,mesh,refresh};
}
test('moving/resizing/aiming a back wall reuses the unchanged kiln voxels',()=>{
 const {ctx,counts,refresh}=collision();refresh();const first=ctx.sceneSolidCellsCpu.slice();
 refresh({immersedCentreX:.25});refresh({immersedRadius:.3});refresh({immersedPitch:20});
 assert.equal(counts.geometry,1,'source/wall edits must not revoxelize the kiln');
 assert.notDeepEqual(ctx.sceneSolidCellsCpu,first,'moving wall must still update the physical mask');assert.equal(counts.uploads,4);
 const wallCount=counts.walls;refresh();refresh();assert.equal(counts.walls,wallCount,'unchanged wall must not enumerate its cells again');
});

test('joined geometry edit holds collision through previews and reconciles once at placement',()=>{
 const {ctx,counts,mesh,refresh}=collision();refresh({immersedBackWall:0});
 const committed=ctx.sceneSolidCellsCpu;ctx.joinedExterior={};ctx.getSceneEditing=()=>({id:'kiln'});
 for(let i=0;i<4;i++){mesh.position.x-=.04;refresh();}
 assert.equal(counts.geometry,1,'drag must not enter geometry voxelization');
 assert.equal(ctx.sceneSolidCellsCpu,committed,'fine uses the committed mask during editing');
 assert.equal(ctx.state.joinedEditing.held,true);
 ctx.getSceneEditing=()=>null;refresh();refresh();
 assert.equal(counts.geometry,2,'placement rebuilds only the final pose');
 assert.equal(ctx.state.joinedEditing.pending,true,'shared projection must reconcile before resuming');
 assert.equal(ctx.state.joinedEditing.held,false);
});
test('cancelled joined geometry edit reuses the original mask',()=>{
 const {ctx,counts,mesh,refresh}=collision();refresh({immersedBackWall:0});const x=mesh.position.x;
 ctx.joinedExterior={};ctx.getSceneEditing=()=>({id:'kiln'});mesh.position.x-=.2;refresh();
 mesh.position.x=x;ctx.getSceneEditing=()=>null;refresh();
 assert.equal(counts.geometry,1);assert.equal(counts.uploads,1);
});
test('moving one authored obstacle reuses the other object and unions their independent solids',()=>{
 const {ctx,counts,mesh,refresh}=collision();const other=new THREE.Mesh(new THREE.BoxGeometry(.3,.3,.3));other.position.set(-.55,.5,.55);
 const group=new THREE.Group();group.add(mesh,other);
 ctx.getSceneCollision=()=>({requested:true,id:'authored-fire-solids',object:group,objects:[{id:'kiln',object:mesh},{id:'baffle',object:other}]});
 const triangles=[];ctx.voxelizeTriangleSolid=(faces,...args)=>{counts.geometry++;triangles.push(faces.length);return solid.voxelizeTriangleSolid(faces,...args);};
 refresh({immersedBackWall:0});assert.deepEqual(triangles,[12,12],'each object must be filled independently, rather than closing the space between objects');
 const first=ctx.sceneSolidCellsCpu.slice();other.position.x+=.2;refresh();assert.equal(counts.geometry,3,'moving the baffle must reuse the unchanged kiln');assert.notDeepEqual(ctx.sceneSolidCellsCpu,first);
 ctx.getSceneCollision=()=>({requested:true,id:'authored-fire-solids',object:mesh,objects:[{id:'kiln',object:mesh}]});refresh();assert.equal(counts.geometry,3,'removing an obstacle reuses the remaining mask');
 assert.deepEqual(ctx.sceneSolidCellsCpu,solid.voxelizeTriangleSolid(solid.trianglesFromSceneObject(mesh).triangles,32).cells);
});
test('source coefficients and compatible solver/transport changes do not rebuild static geometry or mask',()=>{
 const {ctx,counts,refresh}=collision();refresh({immersedBackWall:0});
 ctx.analyticEmitterDescriptorSignature='changed-source-coefficient';refresh({immersedFuel:.9,immersedTemperature:1.6});refresh({advectionScheme:'maccormack-velocity'});
 assert.equal(counts.geometry,1);assert.equal(counts.uploads,1,'admission/control metadata must not rewrite the mask');
});
test('actual geometry, attribute replacement, domain transform and grid changes invalidate kiln voxels',()=>{
 const {ctx,counts,mesh,refresh}=collision();refresh({immersedBackWall:0});mesh.position.x+=.03;refresh();assert.equal(counts.geometry,2);
 const attr=mesh.geometry.getAttribute('position');mesh.geometry.setAttribute('position',attr.clone());refresh();assert.equal(counts.geometry,3,'replacement with same count/version must invalidate');
 mesh.geometry.getAttribute('position').needsUpdate=true;refresh();assert.equal(counts.geometry,4);ctx.productTransform.translate[0]=.02;refresh();assert.equal(counts.geometry,5);
 ctx.gridSize=48;ctx.gridHeight=96;refresh();assert.equal(counts.geometry,6);
});
test('wall key distinguishes small changes that cross the actual cell mask',()=>{
 const {ctx,refresh}=collision();refresh({immersedCentreY:.03125+0.0001,immersedThickness:1});const first=ctx.sceneSolidCellsCpu.slice();refresh({immersedCentreY:.03125-0.0001});
 assert.notDeepEqual(ctx.sceneSolidCellsCpu,first,'rounded pose key must not hide a mask change');
});
test('solid texture keeps its allocation and view for same-shaped occupancy changes',()=>{
 let allocations=0,writes=0,destroyed=0;const device={createTexture(){allocations++;return{createView:()=>({allocation:allocations}),destroy(){destroyed++;}};},queue:{writeTexture(){writes++;}}};
 const ctx={device,gridSize:16,gridHeight:32,state:{},sceneSolidTexture:null,sceneSolidTextureView:null,sceneSolidCellsCpu:null,sceneSolidSupportCache:null,sceneSolidTextureSizeKey:null,sceneSolidTextureDevice:null,GPUTextureUsage:{TEXTURE_BINDING:1,COPY_DST:2},gridShapeLabel:g=>`${g}x${2*g}x${g}`,packSolidTextureRows:solid.packSolidTextureRows,Uint8Array};
 vm.createContext(ctx);const from=source.indexOf('  function installSceneSolidTexture(');const to=source.indexOf('\n  let transportPipelineLayout',from);vm.runInContext(source.slice(from,to),ctx);
 ctx.field={cells:new Uint8Array(16*32*16)};vm.runInContext('installSceneSolidTexture(field)',ctx);const view=ctx.sceneSolidTextureView;
 ctx.field={cells:new Uint8Array(16*32*16).fill(1)};vm.runInContext('installSceneSolidTexture(field)',ctx);
 assert.equal(allocations,1,'same dimensions need only an occupancy upload');assert.equal(ctx.sceneSolidTextureView,view);assert.equal(writes,2);
 ctx.gridSize=24;ctx.gridHeight=48;ctx.field={cells:new Uint8Array(24*48*24)};vm.runInContext('installSceneSolidTexture(field)',ctx);assert.equal(allocations,2);assert.equal(destroyed,1);
});

test('admission refusal clears the installed mask and readmission reuses legitimate geometry',()=>{
 const {ctx,counts,refresh}=collision();refresh({immersedBackWall:0});
 ctx.controlsSnapshot.pressureSolver='legacy';vm.runInContext('refreshSceneCollision()',ctx);assert.equal(ctx.state.sceneCollision.effective,'off');assert.equal(ctx.sceneSolidCellsCpu,null);
 refresh({pressureSolver:'converged-open-top'});assert.equal(counts.geometry,1);assert.ok(ctx.sceneSolidCellsCpu);
});
test('support changes update admission receipts without rewriting identical occupancy',()=>{
 const {ctx,counts,refresh}=collision();refresh({immersedBackWall:0});
 ctx.analyticEmitterDispatch={active:true,cellMin:[0,0,0],cellExtent:[32,32,32],cellCount:32768};
 ctx.analyticEmitterDescriptor={family:'ring',sourceLaw:'shallow-primary',origin:[0,0,0],axis:[0,1,0],supportAxis:[1,0,0],radius:.05,extent:.15,sourceDepth:.04,strength:1};ctx.analyticEmitterDescriptorSignature=JSON.stringify(ctx.analyticEmitterDescriptor);refresh();
 assert.ok(ctx.state.sceneCollision.sourceSupport.fluidSupportCells>0);assert.equal(ctx.state.sceneCollision.sourceBoundsCellCount,32768);assert.equal(counts.uploads,1);assert.equal(counts.geometry,1);
});
test('source footprint cache reuses static weights while current mask, flux and turbulence stay live',()=>{
 assert.equal(typeof core.createImmersedSourceWeightCache,'function','source footprint geometry cache must exist');
 const cache=core.createImmersedSourceWeightCache();const shape={grid:32,gridHeight:64,weightCache:cache};
 const first=core.resolveImmersedSourceConfig(base,shape);assert.equal(cache.builds,1);
 const controls={...base,immersedSpeed:.3,immersedFuel:.8,immersedCapFraction:.2};
 const mask=new Uint8Array(32*64*32);for(const c of core.immersedSourceWeights(first.effective,shape).cells)if(c.x<16)mask[c.x+32*(c.y+64*c.z)]=1;
 const cached=core.resolveImmersedSourceConfig(controls,{...shape,solidCells:mask,puffFactor:.7});
 const uncached=core.resolveImmersedSourceConfig(controls,{grid:32,gridHeight:64,solidCells:mask,puffFactor:.7});
 assert.deepEqual(cached,uncached);assert.equal(cache.builds,1,'changing supply or mask must not rescan the static footprint');assert.ok(cached.effective.masked.cells>0);
 const field=new Float32Array(32*32).fill(.3);const windy={...controls,emitterInletTurbulence:.6};const signals={turbulence:{field,rms:.3}};assert.deepEqual(core.resolveImmersedSourceConfig(windy,{...shape,solidCells:mask,inletSignals:signals}),core.resolveImmersedSourceConfig(windy,{grid:32,gridHeight:64,solidCells:mask,inletSignals:signals}));assert.equal(cache.builds,1);
 const moving={...base};for(const patch of [{immersedCentreX:.125},{immersedPitch:30},{immersedRadius:.3},{immersedThickness:2}]){Object.assign(moving,patch);core.resolveImmersedSourceConfig(moving,shape);}
 assert.equal(cache.builds,5,'pose/shape changes must invalidate exact weights; this inherited engine predates slab patterns');
});

test('a subcell wall move that leaves occupancy identical does not upload another mask',()=>{
 const {ctx,counts,refresh}=collision();refresh({immersedCentreY:.03,immersedThickness:1});const first=ctx.sceneSolidCellsCpu.slice();
 refresh({immersedCentreY:.03001});assert.deepEqual(ctx.sceneSolidCellsCpu,first);assert.equal(counts.uploads,1,'GPU mask key follows actual occupied cells, not pose metadata');
});
