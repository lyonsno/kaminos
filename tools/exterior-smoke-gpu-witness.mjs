// Small native conformance check; no benchmark or visual-acceptance claim.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const [out,repo]=process.argv.slice(2);
assert.ok(out&&repo,'output and explicit checkout required');
await fs.mkdir(out,{recursive:true});
const report={status:'running',phase:'launch',repoRoot:repo,errors:[]};
const save=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
let browser,server;
try{
 await save();report.commit=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
 report.executable=process.env.CHROME_EXECUTABLE;
 assert.ok(report.executable&&!report.executable.includes('/Applications/Google Chrome.app/'),'independent test browser required');
 server=http.createServer(async(req,res)=>{try{
  const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(name==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Exterior GPU conformance</title>');return;}
  const file=path.resolve(repo,'.'+name);if(!file.startsWith(path.resolve(repo)+'/'))throw Error('outside checkout');
  res.setHeader('Content-Type','text/javascript');res.end(await fs.readFile(file));
 }catch{res.statusCode=404;res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
 browser=await chromium.launchPersistentContext(path.join(out,'profile'),{executablePath:report.executable,headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});
 const page=await browser.newPage();page.on('pageerror',e=>report.errors.push(String(e)));
 await page.goto(`http://127.0.0.1:${server.address().port}/`);
 report.phase='native-gather';await save();
 report.signal=await page.evaluate(async()=>{
  const {createVolumeGather}=await import('/scene-volume-gather.mjs');
  const {buildTriangleVisibility}=await import('/scene-light-visibility.mjs');
  const {COMPOSED_SMOKE_WGSL}=await import('/scene-smoke-reconstruction.mjs');
  const adapter=await navigator.gpu.requestAdapter();if(!adapter||adapter.isFallbackAdapter)throw Error('native adapter required');
  const identity={vendor:adapter.info.vendor,architecture:adapter.info.architecture,description:adapter.info.description,fallback:adapter.isFallbackAdapter};
  if(/swiftshader/i.test(JSON.stringify(identity)))throw Error('software fallback refused');
  const device=await adapter.requestDevice(),errors=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
  device.pushErrorScope('validation');
  const geometry=buildTriangleVisibility([]).packGpu(),dimensions=[4,8,4],bounds={lo:[-3,-3,-3],hi:[3,9,3]};
  const texture=device.createTexture({dimension:'3d',size:dimensions,format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
  const medium=device.createTexture({dimension:'3d',size:dimensions,format:'r32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
  const middle=device.createTexture({dimension:'3d',size:dimensions,format:'r32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
  const fine=createVolumeGather(device,{geometry,receivers:[],volumeGrid:2,sourceDimensions:dimensions,directions:4,smokeRefinement:1,angularPattern:'source'});
  const coarse=createVolumeGather(device,{geometry,receivers:[],volumeGrid:2,sourceDimensions:dimensions,directions:4,smokeRefinement:1,angularPattern:'source',receiverBounds:bounds,exteriorMedium:true});
  const source={texture,dimensions,status:'encoded',generation:1,frame:1,exterior:{texture:medium,status:'encoded',generation:1,frame:1,localMin:bounds.lo,localMax:bounds.hi}};
  const rows=[];
  try{
   for(const [name,emission,sigma,middleSigma] of [['clear',1,0],['doubled',2,0],['attenuated',2,1],['dark',0,0],['middle-only',2,0,1],['same-medium',2,1,1],['removed-middle',2,0]]){
    const data=new Float32Array(4*8*4*4);for(let i=0;i<data.length;i+=4)data.set([emission,emission,emission,0],i);
    device.queue.writeTexture({texture},data,{bytesPerRow:64,rowsPerImage:8},dimensions);
    device.queue.writeTexture({texture:medium},new Float32Array(4*8*4).fill(sigma),{bytesPerRow:16,rowsPerImage:8},dimensions);
    source.exterior.middle=middleSigma===undefined?null:{texture:middle,dimensions,status:'encoded',generation:1,frame:1,localMin:bounds.lo,localMax:bounds.hi};
    if(middleSigma!==undefined)device.queue.writeTexture({texture:middle},new Float32Array(4*8*4).fill(middleSigma),{bytesPerRow:16,rowsPerImage:8},dimensions);
    fine.encode(source);coarse.encode(source);
    const f=await fine.readback(),c=await coarse.readback();
    rows.push({name,fine:Array.from(f.smoke.data),coarse:Array.from(c.smoke.data)});
   }
   const module=device.createShaderModule({code:COMPOSED_SMOKE_WGSL});
   const compilation=await module.getCompilationInfo();
   const validation=await device.popErrorScope();
   return {identity,rows,errors,validation:validation?.message??null,compilation:compilation.messages.map(m=>({type:m.type,message:m.message,line:m.lineNum}))};
  }finally{fine.destroy();coarse.destroy();texture.destroy();medium.destroy();middle.destroy();device.destroy();}
 });await save();
 assert.equal(report.signal.validation,null);assert.deepEqual(report.signal.errors,[]);assert.deepEqual(report.errors,[]);
 assert.ok(!report.signal.compilation.some(m=>m.type==='error'),JSON.stringify(report.signal.compilation));
 const [a,b,c,d,m,s,r]=report.signal.rows;assert.equal(report.signal.rows.length,7);
 for(const row of report.signal.rows)for(const field of ['fine','coarse'])assert.ok(row[field].length===64&&row[field].every(Number.isFinite),'complete finite raw receiver output');
 const rgb=values=>values.filter((_,i)=>i%4!==3);
 assert.ok(rgb(a.coarse).every(v=>v>0),'fine flame must illuminate all empty-scene exterior receivers');
 for(let i=0;i<a.coarse.length;i++)if(i%4!==3){assert.ok(Math.abs(b.coarse[i]-2*a.coarse[i])<1e-5,'live emission update');assert.ok(c.coarse[i]<b.coarse[i],'exterior attenuation');assert.equal(d.coarse[i],0,'zero-emission negative control');}
 assert.deepEqual(b.fine,c.fine,'coarse extinction does not change fine field');
 assert.ok(rgb(m.coarse).some((v,i)=>v<rgb(b.coarse)[i]),'middle-only density must attenuate light');
 for(let i=0;i<c.coarse.length;i++)assert.ok(Math.abs(c.coarse[i]-s.coarse[i])<1e-5,'overlapping equal media must blend, never double extinction');
 assert.deepEqual(r.coarse,b.coarse,'removing middle restores the unattenuated field');
 report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;}
finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));await save();}
console.log(JSON.stringify({status:report.status,phase:report.phase,out,error:report.error}));
