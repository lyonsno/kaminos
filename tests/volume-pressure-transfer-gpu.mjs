// Explicit native conformance witness, invoked through Greenroom.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {restrictPressureReference} from '../volume-pressure-resolution.mjs';
const [origin,out,executable,playwright]=process.argv.slice(2);
assert.ok(origin&&out&&executable&&playwright,'origin, output, independent browser and Playwright required');
await fs.mkdir(out,{recursive:true});
const report={status:'running',phase:'launch',origin,executable,source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),errors:[]};
const save=()=>fs.writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
await save();let browser;
try {
  assert.ok(!executable.includes('/Google Chrome.app/'),'independent browser required');
  const {chromium}=await import(playwright);
  browser=await chromium.launch({executablePath:executable,headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});
  const page=await browser.newPage();page.on('pageerror',e=>report.errors.push(String(e)));
  await page.goto(`${origin}/api/runtime-config`);
  report.runtime=await page.evaluate(()=>JSON.parse(document.body.innerText));
  assert.equal(report.runtime.source.repoRoot,process.cwd());assert.equal(report.runtime.source.commit,report.source);
  report.phase='native-transfer';await save();
  report.signal=await page.evaluate(async()=>{
    const {createPressureTransfer,pressureResolutionPlan}=await import('/volume-pressure-resolution.mjs');
    const adapter=await navigator.gpu.requestAdapter();if(!adapter||adapter.isFallbackAdapter)throw Error('native adapter required');
    const info={...adapter.info.toJSON?.(),vendor:adapter.info.vendor,architecture:adapter.info.architecture};
    if(/swiftshader|software/i.test(JSON.stringify(info)))throw Error('software adapter');
    const device=await adapter.requestDevice(),errors=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
    device.pushErrorScope('validation');const rows=[];
    try {
      for(const mode of ['equal','half'])for(const obstacle of [false,true]) {
        const dims=[4,8,4],count=128,data=new Float32Array(count*16),expansion=new Float32Array(count).fill(.25),solids=new Uint32Array(count);
        for(let z=0;z<4;z++)for(let y=0;y<8;y++)for(let x=0;x<4;x++) {
          const i=x+4*(y+8*z);data.set([.01*(x+1),.02*(y+1),.03*(z+1),.8],i*16);
          for(let s=4;s<16;s++)data[i*16+s]=s*.01;
        }
        if(obstacle)solids[21]=1;
        const owned=[],buffer=(size,usage)=>{const b=device.createBuffer({size,usage});owned.push(b);return b;};
        const fine=buffer(data.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC);device.queue.writeBuffer(fine,0,data);
        const tex=(format,values)=>{const t=device.createTexture({dimension:'3d',size:dims,format,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_DST});owned.push(t);device.queue.writeTexture({texture:t},values,{bytesPerRow:16,rowsPerImage:8},dims);return t;};
        const solid=tex('r32uint',solids),burn=tex('r32float',expansion),owner=createPressureTransfer(device,pressureResolutionPlan({dims,mode}));
        owner.prepare({fluid:fine,solidTexture:solid,burnTexture:burn,openTop:true,nonLegacy:true,maxSpeed:8});
        const size=owner.plan.pressureDims.reduce((a,b)=>a*b,1)*64;
        const read=buffer(size,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ),fineRead=buffer(data.byteLength,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ);
        const encoder=device.createCommandEncoder();owner.encode(encoder,'restrict');
        encoder.copyBufferToBuffer(owner.before,0,read,0,size);
        // Identical before/after means zero pressure correction. Boundary masks
        // still apply; all material words must survive the production prolong.
        encoder.copyBufferToBuffer(owner.before,0,owner.after,0,size);owner.encode(encoder,'prolong');
        encoder.copyBufferToBuffer(fine,0,fineRead,0,data.byteLength);device.queue.submit([encoder.finish()]);
        await Promise.all([read.mapAsync(GPUMapMode.READ),fineRead.mapAsync(GPUMapMode.READ)]);
        rows.push({mode,obstacle,dims,input:Array.from(data),expansion:Array.from(expansion),solids:Array.from(solids),restricted:Array.from(new Float32Array(read.getMappedRange())),prolonged:Array.from(new Float32Array(fineRead.getMappedRange()))});
        read.unmap();fineRead.unmap();owner.destroy();owned.forEach(x=>x.destroy());
      }
      const validation=await device.popErrorScope();return {info,rows,errors,validation:validation?.message??null};
    }finally{device.destroy();}
  });await save();
  assert.equal(report.signal.validation,null);assert.deepEqual(report.signal.errors,[]);assert.deepEqual(report.errors,[]);
  assert.equal(report.signal.rows.length,4);
  for(const row of report.signal.rows) {
    const expected=restrictPressureReference({dims:row.dims,divisor:row.mode==='half'?2:1,fluid:row.input,expansion:row.expansion,solids:row.solids});
    assert.equal(row.restricted.length,expected.fluid.length);
    row.restricted.forEach((v,i)=>assert.ok(Number.isFinite(v)&&Math.abs(v-expected.fluid[i])<1e-6,`restriction ${row.mode} ${row.obstacle} ${i}: ${v} != ${expected.fluid[i]}`));
    row.prolonged.forEach((v,i)=>{if(i%16>=3)assert.equal(v,row.input[i],`material word ${i}`);});
  }
  report.status='passed';report.phase='complete';
}catch(e){report.status='failed';report.error=String(e.stack||e);process.exitCode=1;}
finally{await save();await browser?.close();}
console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,out}));
