import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const [output,sourceRoot=process.cwd()]=process.argv.slice(2),root=process.cwd(),out=path.resolve(output),frozenRoot=path.resolve(sourceRoot);fs.mkdirSync(out,{recursive:true});
const report={status:'running',phase:'launch',root,frozenRoot,revision:null,dirty:null,browserLaunched:false,served:{},errors:[],claim:'Controlled oblique material contact and GPU topology conformance, with native engine floor solve. No full-arm effectiveness or performance claim.'};
const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));save();
let server,context;
try{
 report.phase='source-identification';save();report.revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();report.dirty=execFileSync('git',['status','--porcelain'],{encoding:'utf8'});save();
 const importmap=fs.readFileSync(path.join(root,'index.html'),'utf8').match(/<script type="importmap">([\s\S]*?)<\/script>/)[1];
 server=http.createServer((req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://local').pathname);
  if(pathname==='/__contact__.html'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><script type="importmap">'+importmap+'</script>');return;}
  const relative=pathname.slice(1),base=fs.existsSync(path.join(frozenRoot,relative))?frozenRoot:root,file=path.resolve(base,relative);
  if(!file.startsWith(path.resolve(base)+path.sep)){res.writeHead(403);res.end();return;}
  try{const data=fs.readFileSync(file);report.served[relative]={file,sha256:createHash('sha256').update(data).digest('hex')};res.setHeader('Content-Type',/\.(mjs|js)$/.test(file)?'text/javascript':'application/octet-stream');res.end(data);}catch{res.writeHead(404);res.end();}
 });
 report.phase='server-bind';save();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});report.url='http://127.0.0.1:'+server.address().port;
 const {chromium}=await import('/Users/noahlyons/.local/state/sammy-kaminos-masks-0922/browser-tools/node_modules/playwright/index.mjs');
 report.executable='/Users/noahlyons/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell';
 report.phase='browser-launch';save();context=await chromium.launchPersistentContext(path.join(out,'profile'),{headless:true,executablePath:report.executable,args:['--use-mock-keychain','--password-store=basic','--enable-unsafe-webgpu','--use-gl=angle','--use-angle=metal']});report.browserLaunched=true;save();context.setDefaultTimeout(0);context.setDefaultNavigationTimeout(0);
 const page=context.pages()[0];page.on('pageerror',e=>{report.errors.push(e.stack);save();});
 await page.goto(report.url+'/__contact__.html');report.phase='native-contact';save();
 report.result=await page.evaluate(async()=>{
  const T=await import('/lib/three.webgpu.js'),{requestKaminosSharedWebGpuDevice}=await import('/volume-core.js');
  const {prepareWholeFracture}=await import('/fracture-whole-prepare.mjs'),{createCoarseFractureDynamics}=await import('/fracture-coarse-dynamics.mjs');
  const {contactShapeSeparation,boxContactShape}=await import('/fracture-contact-shape.mjs');
  const {createConvexBodyContacts}=await import('/fracture-convex-contact.mjs');
  const {contactTopology,contactEligibility}=await import('/fracture-contact-topology.mjs');
  const {encodeCoarseExternalCompute}=await import('/fracture-compute-batch.mjs');
  const {ArchGpuEngine}=await import('/lib/fracture/rigid-engine.js');
  let currentEngine;const originalContactBuffers=ArchGpuEngine.prototype.getContactRenderBuffers;
  ArchGpuEngine.prototype.getContactRenderBuffers=function(){currentEngine=this;return originalContactBuffers.call(this);};
  const gpu=await requestKaminosSharedWebGpuDevice(),renderer=new T.WebGPURenderer({device:gpu.device});await renderer.init();
  const device=renderer.backend.device,errors=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
  const adapter={vendor:gpu.adapter.info.vendor,architecture:gpu.adapter.info.architecture,fallback:gpu.adapter.info.isFallbackAdapter};
  if(adapter.vendor!=='apple'||adapter.fallback)throw Error('Expected native Apple WebGPU route');
  const face=[[-1,1,-1],[1,-1,-1],[0,0,1]],points=[...face,[-2,-2,0],...face,[2,2,0]],indices=[];
  for(let body=0;body<2;body++){const start=body*4,center=[0,1,2].map(k=>points.slice(start,start+4).reduce((s,p)=>s+p[k],0)/4);
   for(const ids of [[0,1,2],[0,3,1],[1,3,2],[2,3,0]]){const p=ids.map(i=>points[start+i]),u=p[1].map((x,k)=>x-p[0][k]),v=p[2].map((x,k)=>x-p[0][k]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    indices.push(...(n.reduce((s,x,k)=>s+x*(p[0][k]-center[k]),0)>0?ids:[ids[0],ids[2],ids[1]]).map(i=>start+i));}
  }
  const whole=prepareWholeFracture({positions:Float32Array.from(points.flat()),indices:Uint32Array.from(indices)},{labels:Int32Array.from([0,0,0,0,1,1,1,1]),boundaries:[]},{cellExtent:10,strength:1e20,elasticModulus:1e6});
  whole.floorY=-100;whole.cells.forEach((c,i)=>{c.pinned=i===0;c.mass=i===0?0:1;});
  const transformHull=(h,q)=>{const quat=new T.Quaternion(q.x,q.y,q.z,q.w),vertices=new Float32Array(h.vertices.length);for(let i=0;i<vertices.length;i+=3){const p=new T.Vector3(...h.vertices.subarray(i,i+3)).applyQuaternion(quat);vertices.set(p.toArray(),i);}return {...h,vertices};};
  const run=async(mode,angle=0)=>{
   const fixture={...whole,cells:whole.cells.map(c=>({...c})),config:{...whole.config}};
   if(mode==='legacy')fixture.cells=fixture.cells.map(({collisionHull,...c})=>c);
   const model=await createCoarseFractureDynamics(fixture,renderer),states=[],contactTrace=[];let liveMaps=0;
   const acquireContacts=async()=>{
    const buffer=renderer.backend.get(currentEngine.pairContactsAttr).buffer;
    const read=device.createBuffer({label:'Explicit test-only contact record readback',size:4*9*16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    try{const encoder=device.createCommandEncoder();encoder.copyBufferToBuffer(buffer,0,read,0,read.size);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);const bytes=read.getMappedRange();return {floats:Array.from(new Float32Array(bytes)),words:Array.from(new Uint32Array(bytes))};}finally{read.destroy();}
   };
   try{
    if(angle){const rotation=new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),angle),poses=new Float32Array(8),quats=new Float32Array(8);whole.cells.forEach((c,i)=>{const p=new T.Vector3(...c.position).applyQuaternion(rotation);poses.set([...p.toArray(),i===0?0:1],i*4);quats.set(rotation.toArray(),i*4);});device.queue.writeBuffer(model.resident.positions,0,poses);device.queue.writeBuffer(model.resident.quaternions,0,quats);}
    await model.acquire();states.push(model.snapshot());contactTrace.push(await acquireContacts());
    // Controlled topological release, performed once before free evolution.
    // Native stress-driven fracture remains a separate full-object check.
    device.queue.writeBuffer(model.resident.joints,12,new Uint32Array([0]));
    for(let block=0;block<12;block++){
     const originalMap=GPUBuffer.prototype.mapAsync;
     GPUBuffer.prototype.mapAsync=function(){liveMaps++;throw Error('Live contact solve attempted CPU readback');};
     try{for(let step=0;step<2;step++)model.step();}finally{GPUBuffer.prototype.mapAsync=originalMap;}
     await model.acquire();states.push(model.snapshot());contactTrace.push(await acquireContacts());
    }
    const overlaps=states.map(s=>{const a=s.bodies[0],b=s.bodies[1];return -contactShapeSeparation(transformHull(whole.cells[0].collisionHull,a.quaternion),[a.position.x,a.position.y,a.position.z],transformHull(whole.cells[1].collisionHull,b.quaternion),[b.position.x,b.position.y,b.position.z]).separation;});
    return {mode,liveMaps,states,contactTrace,overlaps,peakPenetration:Math.max(...overlaps),effectiveShape:model.snapshot().residency.contactShape};
   }finally{model.dispose();}
  };
  const legacy=await run('legacy'),candidate=await run('candidate'),rotated=await run('candidate-rotated',Math.PI/3);
  const topologyCases=[];
  const chain=Array.from({length:9},(_,a)=>({a,b:a+1}));
  const ring=[{a:0,b:1},{a:1,b:2},{a:2,b:3},{a:3,b:0}];
  for(const spec of [
   {name:'intact-long-chain',count:10,bonds:chain,alive:Array(9).fill(1)},
   {name:'unsampled-interior-break',count:10,bonds:chain,alive:[1,1,1,1,0,1,1,1,1]},
   {name:'direct-crack-with-alternate-path',count:4,bonds:ring,alive:[0,1,1,1]},
   {name:'parallel-bond-still-holds',count:2,bonds:[{a:0,b:1},{a:0,b:1}],alive:[0,1]},
   {name:'parallel-bonds-both-broken',count:2,bonds:[{a:0,b:1},{a:0,b:1}],alive:[0,0]},
   {name:'folded-connected-material',count:3,bonds:[{a:0,b:1},{a:1,b:2}],alive:[1,1],far:true},
   {name:'collinear-polygon-boundary',count:2,bonds:[],alive:[],collinear:true},
   {name:'triangular-index-boundaries',count:75,bonds:[],alive:[],pairIdentity:true}
  ]){
   const cells=Array.from({length:spec.count},(_,index)=>({index,position:[spec.far?index*4:index*.01,0,0],halfExtents:[1,1,1],collisionHull:boxContactShape([1,1,1])}));
   if(spec.collinear)for(const cell of cells){const h=cell.collisionHull;cell.collisionHull={...h,vertices:Float32Array.from([...h.vertices,-1,-1,0]),faces:[[0,8,4,6,2],...h.faces.slice(1)]};}
   const buffers=[],allocate=(label,typed,extra=0)=>{const b=device.createBuffer({label,size:Math.max(16,typed.byteLength),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|extra});device.queue.writeBuffer(b,0,typed);buffers.push(b);return b;};
   const poses=new Float32Array(spec.count*4),quats=new Float32Array(spec.count*4),jointData=new Uint32Array(spec.bonds.length*44),pairCount=spec.count*(spec.count-1)/2;
   for(let i=0;i<spec.count;i++){poses.set([i*.01,0,0,1],i*4);quats.set([0,0,0,1],i*4);}spec.alive.forEach((alive,i)=>jointData[i*44+3]=alive);
   const contacts=allocate('Native topology conformance contacts',new Float32Array(pairCount*4*36),GPUBufferUsage.COPY_SRC),stage=await createConvexBodyContacts(device,{cells,bonds:spec.bonds,positions:allocate('Test poses',poses),quaternions:allocate('Test rotations',quats),joints:allocate('Test live bonds',jointData),contacts,friction:.5});
   const read=device.createBuffer({size:contacts.size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
   try{
    stage.encode(renderer);const encoder=device.createCommandEncoder();encoder.copyBufferToBuffer(contacts,0,read,0,contacts.size);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);const data=new Float32Array(read.getMappedRange());
    topologyCases.push({name:spec.name,expected:contactEligibility(contactTopology(cells,spec.bonds),spec.alive),observed:Array.from({length:pairCount},(_,pair)=>data[pair*4*36+2]>0),finite:Array.from(data).every(Number.isFinite),...(spec.collinear||spec.pairIdentity?{contactRows:Array.from(data)}:{}),...(spec.pairIdentity?{expectedPairs:contactTopology(cells,spec.bonds).pairs.map(p=>[p.i,p.j]),contactPairs:Array.from({length:pairCount},(_,pair)=>Array.from({length:4},(_,slot)=>Array.from(data.slice((pair*4+slot)*36,(pair*4+slot)*36+2))))}:{})});
   }finally{read.destroy();stage.dispose();buffers.forEach(b=>b.destroy());}
  }
  const freeSteps=async(model,count)=>{let maps=0;const originalMap=GPUBuffer.prototype.mapAsync;GPUBuffer.prototype.mapAsync=function(){maps++;throw Error('Live fixed stepping attempted readback');};try{for(let i=0;i<count;i++)model.step();}finally{GPUBuffer.prototype.mapAsync=originalMap;}return maps;};
  const stable=await createCoarseFractureDynamics({...whole,config:{...whole.config}},renderer);let unloaded;
  try{const liveMaps=await freeSteps(stable,12);await stable.acquire();const s=stable.snapshot();unloaded={liveMaps,broken:s.broken,maxDisplacement:Math.max(...s.bodies.map((b,i)=>Math.hypot(...['x','y','z'].map((k,j)=>b.position[k]-whole.cells[i].position[j]))))};}finally{stable.dispose();}
  const floor=[];
  for(const mode of ['legacy','candidate']){
   const fixture={...whole,cells:[{index:0,id:'floor-drop',position:[0,1,0],halfExtents:[.5,.5,.5],mass:1,volume:1,pinned:false,...(mode==='candidate'?{collisionHull:boxContactShape([.5,.5,.5])}:{})}],bonds:[],floorY:0,config:{...whole.config}};
   const model=await createCoarseFractureDynamics(fixture,renderer);
   try{const liveMaps=await freeSteps(model,48);await model.acquire();const s=model.snapshot();floor.push({mode,liveMaps,position:s.bodies[0].position,velocity:s.bodies[0].velocity,shape:s.residency.contactShape});}finally{model.dispose();}
  }
  const stickyFixture={...whole,cells:[0,1].map(index=>({index,id:'sticky:'+index,position:[0,index,0],halfExtents:[.5,.5,.5],mass:index===0?0:1,volume:1,pinned:index===0,collisionHull:boxContactShape([.5,.5,.5])})),bonds:[],config:{...whole.config}};
  const stickyModel=await createCoarseFractureDynamics(stickyFixture,renderer);let sticking;
  try{
   await freeSteps(stickyModel,12);await stickyModel.acquire();const before=stickyModel.snapshot();
   const native=currentEngine,contactBuffer=renderer.backend.get(native.pairContactsAttr).buffer,bytes=4*9*16;
   const trace=device.createBuffer({label:'Explicit native pre/post contact-generation conformance trace',size:bytes*2*whole.config.substeps,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
   const stage=native.externalBodyContactGenerator,encode=stage.encode;let substep=0;
   stage.encode=function(r){const offset=substep++*bytes*2;encodeCoarseExternalCompute(r,e=>e.copyBufferToBuffer(contactBuffer,0,trace,offset,bytes));encode.call(stage,r);encodeCoarseExternalCompute(r,e=>e.copyBufferToBuffer(contactBuffer,0,trace,offset+bytes,bytes));};
   try{
    const velocities=renderer.backend.get(native.getResidentAttributes().velocities).buffer;
    // A fixed small tangential impulse; no observed pose drives this input.
    device.queue.writeBuffer(velocities,16,new Float32Array([.01,0,0,0]));
    const liveMaps=await freeSteps(stickyModel,1);stage.encode=encode;
    await trace.mapAsync(GPUMapMode.READ);const data=trace.getMappedRange(),floats=Array.from(new Float32Array(data)),words=Array.from(new Uint32Array(data));
    await freeSteps(stickyModel,12);await stickyModel.acquire();sticking={liveMaps,before,after:stickyModel.snapshot(),substep,floats,words};
   }finally{stage.encode=encode;trace.destroy();}
  }finally{stickyModel.dispose();}
  await device.queue.onSubmittedWorkDone();renderer.dispose();
  return {adapter,errors,fixture:{cells:whole.cells,bonds:whole.bonds,config:whole.config},legacy,candidate,rotated,topologyCases,unloaded,floor,sticking};
 });
 assert.equal(report.errors.length,0);assert.equal(report.result.errors.length,0);
 assert.equal(report.result.candidate.effectiveShape,'complete-source-convex-hulls','Requested hull contact must not silently fall back to box contacts');
 assert.equal(report.result.candidate.liveMaps,0);
 assert.ok(report.result.legacy.peakPenetration>.02,'Legacy control must expose material crossing at the oblique attachment');
 assert.ok(report.result.candidate.peakPenetration<.02,`Oblique cut must support contact without first passing through its neighbor: peak=${report.result.candidate.peakPenetration}`);
 assert.equal(report.result.rotated.liveMaps,0);assert.ok(report.result.rotated.peakPenetration<.02,'Rotated resident quaternions must preserve the same material contact');
 for(const row of report.result.topologyCases){assert.deepEqual(row.observed,row.expected,row.name+' must use actual full live topology');assert.equal(row.finite,true,row.name+' must produce finite native contact records');if(row.expectedPairs)for(let p=0;p<row.expectedPairs.length;p++)for(const pair of row.contactPairs[p])assert.deepEqual(pair,row.expectedPairs[p],'Every native row must retain its distinct triangular pair identity');}
 assert.equal(report.result.unloaded.liveMaps,0);assert.equal(report.result.unloaded.broken,0);assert.ok(report.result.unloaded.maxDisplacement<.005);
 for(const row of report.result.floor){assert.equal(row.liveMaps,0);assert.ok(Math.abs(row.position.y-.5)<.02,'Native floor must support body');assert.ok(Math.abs(row.velocity.y)<.1,'Resting floor body must not launch');}
 assert.deepEqual(report.result.floor[0].position,report.result.floor[1].position,'External body contact hook must preserve native floor behavior');
 const sticky=report.result.sticking;let reused=0;
 for(let step=0;step<sticky.substep;step++)for(let row=0;row<4;row++){
  const at=step*288+row*36,meta=sticky.words[at+3];if(sticky.floats[at+2]<=0||!(meta&(1<<17)))continue;
  const feature=meta&511;let after=-1;for(let slot=0;slot<4;slot++){const b=step*288+144+slot*36;if(sticky.floats[b+2]>0&&(sticky.words[b+3]&511)===feature){after=b;break;}}
  if(after<0)continue;reused++;
  assert.ok(sticky.words[after+3]&(1<<17),'Exact matched contact must carry its immediately preceding native stick state');
  assert.ok(sticky.words[after+3]&(1<<18),'Sticking correspondence must mark native material-anchor reuse');
  assert.deepEqual(sticky.words.slice(after+8,after+11),sticky.words.slice(at+8,at+11),'Sticking anchor on A must stay material-local');
  assert.deepEqual(sticky.words.slice(after+12,after+15),sticky.words.slice(at+12,at+15),'Sticking anchor on B must stay material-local');
  const oldN=sticky.floats.slice(at+4,at+7),newN=sticky.floats.slice(after+4,after+7);
  if(oldN.every((x,i)=>Math.abs(x-newN[i])<1e-7))for(const k of [17,18])assert.ok(Math.abs(sticky.floats[after+k]-sticky.floats[at+k])<1e-6,'Exact contact transports its tangential constraint history');
 }
 assert.ok(reused>0,'Native solver must establish sticking before the controlled tangential impulse');
 assert.equal(sticky.liveMaps,0);assert.ok(Math.abs(sticky.after.bodies[1].position.x-sticky.before.bodies[1].position.x)<.003,'Static-friction sample must arrest the small tangential impulse');
 report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.failurePhase=report.phase;report.error=error.stack;process.exitCode=1;}finally{
 save();const cleanupErrors=[];
 if(context)try{await context.close();}catch(error){cleanupErrors.push(error.stack);}
 if(server?.listening)try{await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}catch(error){cleanupErrors.push(error.stack);}
 if(cleanupErrors.length){report.cleanupErrors=cleanupErrors;if(report.status!=='failed'){report.status='failed';report.failurePhase='cleanup';process.exitCode=1;}}save();
}
console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,candidate:report.result?.candidate.peakPenetration,legacy:report.result?.legacy.peakPenetration}));
