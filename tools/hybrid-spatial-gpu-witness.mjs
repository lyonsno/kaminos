import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {reducePointRegionsReference} from '../scene-point-regions.mjs';
const [url,out]=process.argv.slice(2);
assert(url&&out,'runtime URL and output directory required');await fs.mkdir(out,{recursive:true});
const report={status:'running',phase:'launch',url,executable:process.env.KAMINOS_TEST_BROWSER,fixtures:[]};
const save=()=>fs.writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await save();let browser;
try{
 const {chromium}=await import(process.env.KAMINOS_TEST_PLAYWRIGHT);
 browser=await chromium.launch({executablePath:report.executable,headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});
 const page=await browser.newPage();await page.goto(new URL('/api/runtime-config',url).href);report.runtime=await page.evaluate(()=>JSON.parse(document.body.innerText));
  assert.equal(report.runtime.source.repoRoot,process.cwd(),'runtime must serve the requested worktree');
 for(const axis of [0,1,2]){const a=[3,3,3],b=[3,3,3];a[axis]=1;b[axis]=6;report.fixtures.push({name:`axis${axis}`,count:2,cells:[[...a,4,0,0],[...b,0,0,4]]});}
 const cells=[[1,1,1,4,1,0],[1,6,1,3,0,1],[6,1,6,0,2,4],[6,6,6,1,4,3]];
 for(const count of [1,3,4,9])report.fixtures.push({name:`count${count}`,count,cells});
 report.fixtures.push({name:'dark',count:4,cells:[]},{name:'single-cell',count:9,cells:[[1,1,1,4,2,1]]});
 for(const f of report.fixtures){const values=new Float32Array(8**3*4);for(const [x,y,z,r,g,b]of f.cells)values.set([r,g,b,0],4*(x+8*(y+8*z)));f.values=Array.from(values);f.expected=reducePointRegionsReference(values,[8,8,8],f.count,1,'spatial');}
 report.phase='native-reduction';await save();
 report.signal=await page.evaluate(async fixtures=>{
  const {createPointRegions}=await import('/scene-point-regions.mjs');
  const adapter=await navigator.gpu.requestAdapter();if(!adapter||adapter.isFallbackAdapter)throw Error('native GPU required');
  const info={vendor:adapter.info.vendor,architecture:adapter.info.architecture,description:adapter.info.description};if(/swiftshader/i.test(JSON.stringify(info)))throw Error('fallback GPU');
  const device=await adapter.requestDevice(),errors=[],rows=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));device.pushErrorScope('validation');
  for(const f of fixtures){const texture=device.createTexture({dimension:'3d',size:[8,8,8],format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
   device.queue.writeTexture({texture},new Float32Array(f.values),{bytesPerRow:128,rowsPerImage:8},[8,8,8]);
   const reducer=createPointRegions(device,{count:f.count,partition:'spatial'});const outputs=[];
   for(let frame=0;frame<2;frame++){reducer.encode({status:'encoded',texture,dimensions:[8,8,8],gain:1,generation:1,frame});outputs.push(await reducer.readback());}
   rows.push({name:f.name,outputs});reducer.destroy();texture.destroy();
  }
  const error=await device.popErrorScope();device.destroy();return {info,errors,validation:error?.message??null,rows};
 },report.fixtures);await save();
 assert.equal(report.signal.validation,null);assert.deepEqual(report.signal.errors,[]);assert.equal(report.signal.rows.length,report.fixtures.length);
 for(let i=0;i<report.fixtures.length;i++)for(const output of report.signal.rows[i].outputs){assert.equal(output.partition,'spatial');assert.equal(output.regions.length,report.fixtures[i].count);
  output.regions.forEach((r,j)=>{const expected=report.fixtures[i].expected[j];for(const key of ['position','energy','radiusSquared']){const values=[r[key]].flat(),want=[expected[key]].flat();values.forEach((v,k)=>assert(Number.isFinite(v)&&Math.abs(v-want[k])<1e-5,`${report.fixtures[i].name} region${j} ${key} ${v} != ${want[k]}`));}});
 }
 report.status='passed';report.phase='complete';
}catch(e){report.status='failed';report.error=String(e.stack||e);process.exitCode=1;}
finally{await save();await browser?.close();}
console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,out}));
