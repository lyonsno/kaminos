import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {buildTriangleVisibility} from '../scene-light-visibility.mjs';
import {assertSofteningGpuSignal} from './scene-source-softening-gpu-evidence.mjs';
const [url,out]=process.argv.slice(2);assert.ok(url&&out);
await fs.mkdir(out,{recursive:true});
const executable='/Users/noahlyons/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const report={status:'running',phase:'launch',url,executable};
const save=()=>fs.writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
await save();let browser;
try{
  const {chromium}=await import('/private/tmp/beaming-smoke-deps-1001/node_modules/playwright/index.mjs');
  browser=await chromium.launch({executablePath:executable,headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal']});
  const page=await browser.newPage();await page.goto(new URL('/api/runtime-config',url).href);
  report.runtime=await page.evaluate(()=>JSON.parse(document.body.innerText));
  const plane=[{a:[0,-2,-2],b:[0,4,-2],c:[0,4,2]},{a:[0,-2,-2],b:[0,4,2],c:[0,-2,2]}];
  report.fixtures=Object.fromEntries(Object.entries({empty:[],plane,reversed:plane.map(t=>({...t,b:t.c,c:t.b}))}).map(([name,t])=>{
    const g=buildTriangleVisibility(t).packGpu();return [name,{nodeCount:g.nodeCount,nodeWords:Array.from(new Uint32Array(g.nodes.buffer)),triangles:Array.from(g.triangles)}];
  }));
  report.phase='production-kernel';await save();
  report.signal=await page.evaluate(async fixtures=>{
    const {createSourceSoftening}=await import('/scene-source-softening.mjs');
    const adapter=await navigator.gpu.requestAdapter();if(!adapter||adapter.isFallbackAdapter)throw new Error('native adapter required');
    const info={vendor:adapter.info.vendor,architecture:adapter.info.architecture,description:adapter.info.description};
    if(/swiftshader/i.test(JSON.stringify(info)))throw new Error('fallback forbidden');
    const device=await adapter.requestDevice(),errors=[],losses=[],rows=[];
    device.addEventListener('uncapturederror',e=>errors.push(e.error.message));device.lost.then(i=>{if(i.reason!=='destroyed')losses.push(i.message);});device.pushErrorScope('validation');
    const dims=[8,16,8],count=1024;
    for(const [name,g] of Object.entries(fixtures)){
      const owned=[];let filter;
      try{
        const upload=data=>{const b=device.createBuffer({size:Math.max(16,data.byteLength),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(b,0,data);owned.push(b);return b;};
        const nodes=upload(new Uint32Array(g.nodeWords)),triangles=upload(new Float32Array(g.triangles));
        const source=device.createTexture({dimension:'3d',size:dims,format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC});owned.push(source);
        filter=createSourceSoftening(device,{nodes,triangles,nodeCount:g.nodeCount,dimensions:dims});
        const data=new Float32Array(count*4);for(let i=0;i<count;i++)data[i*4+3]=i/1024;
        const peak=2+8*(8+16*4);data.set([8,4,2,data[peak*4+3]],peak*4);
        const outputs=[];
        for(const [passes,scale] of [[0,1],[1,1],[8,1],[16,1],[4,2],[0,2]]){
          const values=data.map((v,i)=>i%4===3?v:v*scale);device.queue.writeTexture({texture:source},values,{bytesPerRow:128,rowsPerImage:16},dims);
          const encoder=device.createCommandEncoder(),texture=filter.encode(encoder,source,passes);
          const read=device.createBuffer({size:256*16*8,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});owned.push(read);
          encoder.copyTextureToBuffer({texture},{buffer:read,bytesPerRow:256,rowsPerImage:16},dims);
          device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);
          const raw=new Float32Array(read.getMappedRange()),flat=[];for(let r=0;r<128;r++)flat.push(...raw.subarray(r*64,r*64+32));read.unmap();
          outputs.push({passes,scale,values:flat,identity:passes===0?texture===source:null});
        }
        const read=device.createBuffer({size:count*4,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});owned.push(read);
        const encoder=device.createCommandEncoder();encoder.copyBufferToBuffer(filter.masks,0,read,0,count*4);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);
        const occupied=Array.from(new Uint32Array(read.getMappedRange()));read.unmap();
        rows.push({name,dims,input:Array.from(data),occupied,outputs,metadata:{...filter.metadata}});
      }finally{filter?.destroy();for(const r of owned)r.destroy();}
    }
    const validation=await device.popErrorScope();device.destroy();return {info,rows,errors,losses,validation:validation?.message??null};
  },report.fixtures);await save();
  assertSofteningGpuSignal(report.signal);
  report.status='passed';report.phase='complete';
}catch(e){report.status='failed';report.error=String(e.stack||e);process.exitCode=1;}
finally{await save();await browser?.close();}
console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,out}));
