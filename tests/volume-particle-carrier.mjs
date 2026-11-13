// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {withKaminosGpu} from '../tools/shader-herder.mjs';
import {createOpticalParticles} from '../volume-optical-particles.mjs';

async function fixture(d,run){
 const owner=createOpticalParticles(d,{transparent:true}),matrix=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
 const buffer=d.createBuffer({size:64,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC}),uniform=d.createBuffer({size:240,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
 const fine=d.createBuffer({size:8*64,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),reactants=d.createTexture({size:[2,2,2],dimension:'3d',format:'rg32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
 const source={buffer,uniform,width:1,height:1,pixels:1,samples:1,step:0,backtrace:1,viewProj:matrix};
 const sf=new Float32Array(60);sf.set(matrix);sf.set([0,2,1,0],28);d.queue.writeBuffer(uniform,0,sf);
 const target=d.createTexture({size:[8,8],format:'rgba8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC}),depth=d.createTexture({size:[1,1],format:'depth32float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
 const camera=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,1,1,0,0,0,1,0]);
 function seed(state,q=[4,2,1,.4]){const material=new Float32Array(8*16),oxygen=new Float32Array(8*2);for(let i=0;i<8;i++){material.set([state[2],state[1],state[0],0],i*16+4);oxygen.set([state[3],.01],i*2);}d.queue.writeBuffer(fine,0,material);d.queue.writeTexture({texture:reactants},oxygen,{bytesPerRow:16,rowsPerImage:2},[2,2,2]);d.queue.writeBuffer(buffer,0,new Float32Array([...q,0,0,0,1,-.25,.25,1,1,...q.slice(0,3),0]));owner.reset();}
 async function draw(step,settings={}){source.step=step;const e=d.createCommandEncoder();const p=e.beginRenderPass({colorAttachments:[],depthStencilAttachment:{view:depth.createView(),depthLoadOp:'clear',depthStoreOp:'store',depthClearValue:1}});p.end();const passNames=[];owner.encode(e,{profileWrites:name=>{passNames.push(name);return{};},view:target.createView(),format:'rgba8unorm',source,fine,reactants,dims:[2,2,2],invViewProj:matrix,settings:{enabled:true,acquisitionMode:1,capacity:1,refresh:0,flow:0,...settings},cameraValues:camera,depth,identity:'actual-composition-fixture'});d.queue.submit([e.finish()]);await d.queue.onSubmittedWorkDone();return {...await owner.sample(),passNames};}
 async function propose(step,settings={}){source.step=step;const read=d.createBuffer({size:64,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),e=d.createCommandEncoder();owner.prepareAcquisition?.(e,{source,fine,dims:[2,2,2],settings:{enabled:true,acquisitionMode:1,capacity:1,refresh:0,flow:0,followFraction:1,followFuel:1,followHeat:0,followSmoke:0,followJitter:0,...settings},identity:'actual-composition-fixture'});e.copyBufferToBuffer(buffer,0,read,0,64);d.queue.submit([e.finish()]);await read.mapAsync(GPUMapMode.READ);const rows=new Float32Array(read.getMappedRange().slice(0));read.unmap();read.destroy();return rows;}
 async function pixels(){const e=d.createCommandEncoder(),read=d.createBuffer({size:8*256,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});e.copyTextureToBuffer({texture:target},{buffer:read,bytesPerRow:256},[8,8]);d.queue.submit([e.finish()]);await read.mapAsync(GPUMapMode.READ);const data=new Uint8Array(read.getMappedRange().slice(0));read.unmap();read.destroy();return data;}
 try{await run({owner,seed,draw,propose,pixels});}finally{owner.dispose();for(const r of [buffer,uniform,fine,reactants,target,depth])r.destroy();}
}
test('production carrier retains actual reactants and advances a state-dependent lifetime without enlarging the record',async()=>{
 await withKaminosGpu(async({device:d})=>fixture(d,async({seed,draw})=>{
  seed([1,.8,.2,3]);const birth=await draw(0);assert.equal(birth.records.length,24);[1,.8,.2,3].forEach((v,i)=>assert.ok(Math.abs(birth.records[20+i]-v)<1e-6,'birth samples actual F/H/S/O'));
  const live=await draw(1,{exchangeStrength:0,lifeFuel:30,lifeHeat:30,lifeSmoke:30,lifeQuiet:30});assert.ok(live.records[20]<1&&live.records[23]<3,'reaction uses both carried reactants');assert.ok(live.records[15]>0,'motion.w retains representation lifetime progress');
  const held=await draw(1,{exchangeStrength:1,exchangeTime:.01,lifeHeat:.1});assert.deepEqual(held.records,live.records,'presentation changes cannot advance material or survival');
 }));
});
test('invalid exchange grouping preserves a current population before any encoding mutation',async()=>{
 await withKaminosGpu(async({device:d})=>fixture(d,async({seed,draw,owner})=>{
  seed([1,.8,.2,3]);const before=await draw(0);await assert.rejects(draw(1,{exchangeCellSize:1e-8}),/Particle exchange/);const after=await owner.sample();assert.deepEqual(after.state,before.state,'preflight cannot advance frame or replace effective settings');assert.deepEqual(after.records,before.records,'invalid grouping cannot clear or update material');const continued=await draw(1);assert.equal(continued.state.stepDelta,1,'rejected grouping cannot consume the next simulation delta');assert.ok(continued.records[20]<before.records[20]);
 }));
});
test('actual particle pixels expose carried material diagnostics while holding the same medium',async()=>{
 await withKaminosGpu(async({device:d})=>fixture(d,async({seed,draw,pixels})=>{
  seed([1,.8,.2,3]);const before=await draw(0),normal=await pixels();await draw(0,{debugView:1});const fuel=await pixels();assert.notDeepEqual(fuel,normal,'fuel view changes actual rendered pixels');await draw(0,{debugView:3});assert.notDeepEqual(await pixels(),fuel,'oxygen view has a different material color');const after=await draw(0,{debugView:0});assert.deepEqual(after.records,before.records,'diagnostic views do not edit material');assert.deepEqual(await pixels(),normal,'normal view restores the exact image');
 }));
});
test('follow acquisition writes an actual retained material position without a CPU population readback',async()=>{
 await withKaminosGpu(async({device:d})=>fixture(d,async({seed,draw,propose})=>{
  seed([1,0,0,0]);await draw(0);const rows=await propose(1);assert.equal(rows[7],-1,'negative anchor tag identifies a GPU follow proposal');assert.ok(Math.abs(rows[4])+Math.abs(rows[5])+Math.abs(rows[6])<1e-6,'zero flow/jitter proposes retained center');
 }));
});
test('unlit fuel can be acquired, and quiet material retires through the authored state lifetime',async()=>{
 await withKaminosGpu(async({device:d})=>fixture(d,async({seed,draw})=>{
  seed([1,0,0,0],[0,0,0,0]);const fuel=await draw(0);assert.equal(fuel.records[3],1,'optically transparent fuel is material, not an invalid observation');assert.equal(fuel.records[20],1);
  seed([0,0,.1,0]);await draw(0);const dead=await draw(3,{lifeFuel:2,lifeHeat:2,lifeSmoke:2,lifeQuiet:2});assert.equal(dead.records[3],0,'state lifetime retires before the unrelated maximum-age cap');
 }));
});

test('production work gates hold retained state and skip disabled passes without changing the record',async()=>withKaminosGpu(async({device:d})=>fixture(d,async({seed,draw})=>{seed([1,.8,.2,3]);const a=await draw(0,{exchangeEnabled:false,followFraction:0});const held=await draw(2,{updateEnabled:false,birthsEnabled:false,exchangeEnabled:false,followFraction:0});assert.deepEqual(held.records,a.records);assert.equal(held.state.work.updateSlots,0);assert.equal(held.state.exchange.work.grouping,false);assert.equal(held.state.work.birthCapacityPerFrame,0);const hot=await draw(3,{reactionEnabled:false,transportEnabled:false,exchangeEnabled:false,birthsEnabled:false});assert.deepEqual(hot.records.slice(20,24),a.records.slice(20,24),'reaction gate preserves carried composition');assert.deepEqual(hot.records.slice(0,3),a.records.slice(0,3),'transport gate holds centers');assert.ok(hot.records[3]>a.records[3],'age can advance independently');assert.equal(hot.records.length,24);})));
test('exchange-neighborhood heat is an actual field diagnostic and preserves held carrier state',async()=>withKaminosGpu(async({device:d})=>fixture(d,async({seed,draw,pixels})=>{seed([1,.8,.2,3]);await draw(0);const a=await draw(1,{exchangeEnabled:true,exchangeStrength:1});const normal=await pixels();const field=await draw(1,{debugView:8,exchangeEnabled:true});assert.equal(field.state.exchange.field.valid,true);assert.equal(field.state.exchange.field.step,1);assert.deepEqual(field.records,a.records);assert.notDeepEqual(await pixels(),normal);await draw(1,{debugView:0});assert.deepEqual(await pixels(),normal);})));

test('tracking predicts residual transport even while carried reaction is disabled',async()=>withKaminosGpu(async({device:d})=>fixture(d,async({seed,draw,propose})=>{seed([1,1,0,3]);await draw(0);const q=await propose(1,{reactionEnabled:false,transportEnabled:true,rise:.1,drag:4});assert.equal(q[7],-1);assert.ok(q[5]>.05,'tracking must predict the transport clock independently from the reaction clock');})));

test('paused population preserves records and encodes neither no-op update nor dropped births',async()=>withKaminosGpu(async({device:d})=>fixture(d,async({seed,draw})=>{seed([1,.8,.2,3]);const a=await draw(0);const b=await draw(0,{exchangeStrength:1});assert.deepEqual(b.records,a.records);assert.equal(b.passNames.includes('update'),false);assert.equal(b.passNames.includes('births'),false);assert.equal(b.state.work.updateSlots,0);assert.equal(b.state.work.birthCapacityPerFrame,0);})));

test('live incoming light changes native scattering while preserving carried material and a dark-field image',async()=>withKaminosGpu(async({device:d})=>fixture(d,async({owner,seed,draw,pixels})=>{
 seed([1,0,1,3],[0,0,0,1]);const settings={gain:0,scatteredGain:0,exchangeEnabled:false,followFraction:0};
 const held=await draw(0,settings),before=await pixels();
 assert.equal(typeof owner.setIncidentField,'function','native particles must accept a current incoming-light field');
 const field=new Float32Array(2*2*2*4);for(let i=0;i<8;i++)field.set([4,0,0,0],i*4);
 const metadata={dims:[2,2,2],origin:[-1,-1,-1],extent:[2,2,2],sourceStep:0,sourceIdentity:'actual-composition-fixture',albedo:1,gain:1};
 owner.setIncidentField({...metadata,data:new Float32Array(field.length)});await draw(0,settings);assert.deepEqual(await pixels(),before,'zero current illumination preserves the native extinction image');
 owner.setIncidentField({...metadata,sourceIdentity:'another-source',data:field});await draw(0,settings);assert.deepEqual(await pixels(),before,'a different source cannot leak its lighting into this population');assert.equal(owner.read().incident.effective,'source-mismatch');
 owner.setIncidentField({...metadata,data:field});
 const lit=await draw(0,settings),after=await pixels();assert.deepEqual(lit.records,held.records,'incoming light cannot change reaction or retained history');
 let redBefore=0,redAfter=0;for(let y=0;y<8;y++)for(let x=0;x<8;x++){const i=y*256+x*4;redBefore+=before[i];redAfter+=after[i];}
 assert.ok(redAfter>redBefore,'actual native pixels receive the current incident field');assert.equal(owner.read().incident.effective,'live-angular-field');
 assert.throws(()=>owner.setIncidentField({dims:[2,2,2],origin:[-1,-1,-1],extent:[2,2,2],data:new Float32Array(4),sourceStep:0,sourceIdentity:'actual-composition-fixture',albedo:1,gain:1}),/field|complete/i);
 owner.setIncidentField(null);await draw(0,settings);assert.deepEqual(await pixels(),before,'disabling live field restores the prior image');
})));

test('explicit live lighting snapshots retain the sampled step while native evolution continues',async()=>withKaminosGpu(async({device:d})=>fixture(d,async({owner,seed,draw})=>{
 seed([1,.8,.2,3]);const held=await draw(0,{exchangeEnabled:false,followFraction:0});
 const pending=owner.sample({allowAdvance:true});const advanced=await draw(1,{exchangeEnabled:false,followFraction:0});
 const snapshot=await pending;assert.equal(snapshot.state.step,0);assert.deepEqual(snapshot.records,held.records,'snapshot is the queued copy, not a later state');assert.notDeepEqual(advanced.records,snapshot.records,'native material really advanced while the copy was pending');
})));
