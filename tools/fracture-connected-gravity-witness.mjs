import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const [output,sourceRoot=process.cwd()]=process.argv.slice(2),root=process.cwd(),out=path.resolve(output),frozenRoot=path.resolve(sourceRoot);fs.mkdirSync(out,{recursive:true});
const report={status:'running',phase:'launch',root,frozenRoot,revision:null,dirty:null,browserLaunched:false,served:{},errors:[],claim:'Two-cell connected freefall correctness control with unchanged authored elasticity, no contacts or hand, and no live state maps. Not a whole-arm or performance claim.'};
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
  const gpu=await requestKaminosSharedWebGpuDevice(),renderer=new T.WebGPURenderer({device:gpu.device});await renderer.init();
  const device=renderer.backend.device,adapter={vendor:gpu.adapter.info.vendor,architecture:gpu.adapter.info.architecture,fallback:gpu.adapter.info.isFallbackAdapter},errors=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
  if(adapter.vendor!=='apple'||adapter.fallback)throw Error('Expected native Apple WebGPU route');
  const face=[[-1,1,-1],[1,-1,-1],[0,0,1]],points=[...face,[-2,-2,0],...face,[2,2,0]],indices=[];
  for(let body=0;body<2;body++){const start=body*4,center=[0,1,2].map(k=>points.slice(start,start+4).reduce((s,p)=>s+p[k],0)/4);
   for(const ids of [[0,1,2],[0,3,1],[1,3,2],[2,3,0]]){const p=ids.map(i=>points[start+i]),u=p[1].map((x,k)=>x-p[0][k]),v=p[2].map((x,k)=>x-p[0][k]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    indices.push(...(n.reduce((s,x,k)=>s+x*(p[0][k]-center[k]),0)>0?ids:[ids[0],ids[2],ids[1]]).map(i=>start+i));}
  }
  const whole=prepareWholeFracture({positions:Float32Array.from(points.flat()),indices:Uint32Array.from(indices)},{labels:Int32Array.from([0,0,0,0,1,1,1,1]),boundaries:[]},{cellExtent:10,strength:1e20,elasticModulus:1e9});
  whole.floorY=-100;whole.cells.forEach(c=>{c.pinned=false;c.mass=1;});whole.config.collisions='none';

  const cases=[];
  for(const mode of ['unbonded','connected','pinned']){
   const input={...whole,cells:whole.cells.map((c,i)=>({...c,pinned:mode==='pinned'&&i===0,mass:mode==='pinned'&&i===0?0:1})),bonds:mode==='unbonded'?[]:whole.bonds,config:{...whole.config}};
   const model=await createCoarseFractureDynamics(input,renderer);let liveMaps=0;
   try{
    await model.acquire();const before=model.snapshot(),map=GPUBuffer.prototype.mapAsync;GPUBuffer.prototype.mapAsync=function(){liveMaps++;throw Error('Live freefall attempted readback');};
    try{for(let i=0;i<12;i++)model.step();}finally{GPUBuffer.prototype.mapAsync=map;}
    await model.acquire();const after=model.snapshot(),duration=(after.step-before.step)*input.config.timeStep,mass=after.bodies.reduce((s,b)=>s+b.mass,0),meanY=after.bodies.reduce((s,b)=>s+b.mass*b.velocity.y,0)/mass,expected=-input.config.gravity*duration;
    const maxDisplacement=Math.max(...after.bodies.map((b,i)=>Math.hypot(...['x','y','z'].map(k=>b.position[k]-before.bodies[i].position[k]))));cases.push({mode,liveMaps,before,after,duration,expected,meanY,fraction:meanY/expected,maxDisplacement,reaction:after.bonds[0]?.reaction??null,reactionExpected:input.config.gravity});
   }finally{model.dispose();}
  }
  renderer.dispose();return {adapter,errors,cases};
 });
 assert.equal(report.errors.length,0);assert.equal(report.result.errors.length,0);
 for(const row of report.result.cases){assert.equal(row.liveMaps,0);assert.equal(row.after.broken,0);if(row.mode==='pinned'){assert.ok(row.maxDisplacement<.005,'Supported material must remain stable under its unchanged load');assert.ok(Math.abs(row.reaction/row.reactionExpected-1)<.01,'Connection reaction must carry the unchanged weight');}else assert.ok(Math.abs(row.fraction-1)<.01,`Internal attachments must preserve net gravitational acceleration; ${row.mode} fraction=${row.fraction}`);}
 report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.failurePhase=report.phase;report.error=error.stack;process.exitCode=1;}finally{
 save();const cleanupErrors=[];
 if(context)try{await context.close();}catch(error){cleanupErrors.push(error.stack);}
 if(server?.listening)try{await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}catch(error){cleanupErrors.push(error.stack);}
 if(cleanupErrors.length){report.cleanupErrors=cleanupErrors;if(report.status!=='failed'){report.status='failed';report.failurePhase='cleanup';process.exitCode=1;}}save();
}
console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,cases:report.result?.cases.map(({mode,meanY,expected,fraction})=>({mode,meanY,expected,fraction}))}));
