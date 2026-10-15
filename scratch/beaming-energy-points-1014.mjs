import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const [out,origin='http://127.0.0.1:18596']=process.argv.slice(2);
if(!out)throw Error('explicit output directory required');
await fs.mkdir(out,{recursive:true});
const report={status:'running',phase:'start',origin,repoRoot:process.cwd(),errors:[],claim:'native reduction conformance, not performance'};
const write=()=>fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));await write();let browser;
try{
 report.source=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 const local=await fs.readFile('scene-point-regions.mjs'),served=Buffer.from(await (await fetch(origin+'/scene-point-regions.mjs')).arrayBuffer());
 assert.deepEqual(served,local,'served source must equal reviewed checkout');report.moduleSHA256=createHash('sha256').update(served).digest('hex');
 const {chromium}=await import(process.env.KAMINOS_PLAYWRIGHT_MODULE||'playwright');
 report.executable='/Users/noahlyons/.local/state/kaminos/browsers/chrome-for-testing-154.0.8037.92/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
 browser=await chromium.launch({executablePath:report.executable,headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal']});
 const page=await browser.newPage();page.on('pageerror',e=>report.errors.push(e.message));await page.goto(origin+'/tests/');
 report.phase='native-reduction';await write();
 report.result=await page.evaluate(async()=>{
  const adapter=await navigator.gpu.requestAdapter();if(!adapter||adapter.info.isFallbackAdapter||/software|swiftshader/i.test(adapter.info.description))throw Error('native GPU unavailable');
  const device=await adapter.requestDevice();device.pushErrorScope('validation');
  const {createPointRegions,reducePointRegionsReference}=await import('/scene-point-regions.mjs');
  const cases=[],points=createPointRegions(device,{count:2,partition:'energy'});
  for(const [name,dims]of [['compact',[2,8,2]],['dark',[2,8,2]],['tall',[4,13,4]],['single-layer',[2,8,2]]]){
   const values=new Float32Array(dims.reduce((a,b)=>a*b,4));
   if(name==='compact'){values.set([3,0,0,99],0);values.set([0,1,0,0],12);}
   if(name==='tall')for(let i=0;i<values.length;i+=4){values[i]=(i%19)/19;values[i+1]=(i%7)/7;values[i+2]=(i%11)/11;}
   if(name==='single-layer')values.set([1,2,3,100],0);
   const texture=device.createTexture({size:dims,dimension:'3d',format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
   device.queue.writeTexture({texture},values,{bytesPerRow:dims[0]*16,rowsPerImage:dims[1]},dims);
   points.encode({status:'encoded',texture,dimensions:dims,gain:2,generation:cases.length+1,frame:cases.length+1});
   const actual=await points.readback(),expected=reducePointRegionsReference(values,dims,2,2,'energy');
   for(let i=0;i<2;i++)for(const key of ['position','energy','radiusSquared']){
    const a=[actual.regions[i][key]].flat(),b=[expected[i][key]].flat();
    if(a.some((v,j)=>!Number.isFinite(v)||Math.abs(v-b[j])>2e-5*Math.max(1,Math.abs(b[j]))))throw Error('native reduction mismatch '+JSON.stringify({name,key,actual,expected}));
   }
   cases.push({name,dims,input:Array.from(values),actual,expected});texture.destroy();
  }
  points.destroy();const error=await device.popErrorScope();if(error)throw Error(error.message);
  const info={vendor:adapter.info.vendor,architecture:adapter.info.architecture,description:adapter.info.description};device.destroy();return {info,cases};
 });assert.deepEqual(report.errors,[]);report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.failure={phase:report.phase,message:error.message,stack:error.stack};process.exitCode=1;}
finally{await browser?.close();await write();console.log(JSON.stringify({status:report.status,failure:report.failure}));}
