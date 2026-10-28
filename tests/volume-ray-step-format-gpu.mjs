// kaminos-test: manual — explicit served worktree and independent browser; tiny untimed GPU check
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const [origin,out,executable,playwright]=process.argv.slice(2);
assert.ok(origin&&out&&executable&&playwright,'origin, output, independent browser and Playwright required');
await fs.mkdir(out,{recursive:true});
const report={status:'running',phase:'launch',origin,executable,source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),errors:[]};
const save=()=>fs.writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
await save();let browser;
try {
  assert.ok(!executable.includes('/Google Chrome.app/'),'independent browser required');
  const {chromium}=await import(playwright);
  browser=await chromium.launchPersistentContext(`${out}/profile`,{executablePath:executable,headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});
  const page=await browser.newPage();page.on('pageerror',e=>report.errors.push(String(e)));
  await page.goto(`${origin}/api/runtime-config`);
  report.runtime=await page.evaluate(()=>JSON.parse(document.body.innerText));
  assert.equal(report.runtime.source.repoRoot,process.cwd());assert.equal(report.runtime.source.commit,report.source);
  report.phase='native-format';await save();
  report.signal=await page.evaluate(async()=>{
    const {RAY_STEP_TELEMETRY_WGSL,RAY_STEP_SUMMARY_BYTES}=await import('/volume-ray-step-telemetry.mjs');
    const adapter=await navigator.gpu.requestAdapter();if(!adapter||adapter.isFallbackAdapter)throw Error('native GPU required');
    const info={vendor:adapter.info.vendor,architecture:adapter.info.architecture};if(/swiftshader|software/i.test(JSON.stringify(info)))throw Error('software GPU');
    const device=await adapter.requestDevice(),errors=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));device.pushErrorScope('validation');
    const rows=[],glyphOffset=12+3*256,columns=(RAY_STEP_SUMMARY_BYTES/4-glyphOffset)/6;
    try {
      const module=device.createShaderModule({code:RAY_STEP_TELEMETRY_WGSL});
      const layout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}}]});
      const pipeline=device.createComputePipeline({layout:device.createPipelineLayout({bindGroupLayouts:[layout]}),compute:{module,entryPoint:'selectQuantiles',constants:{BYTE_SHIFT:0}}});
      const samples=device.createBuffer({size:4,usage:GPUBufferUsage.STORAGE});
      const summary=device.createBuffer({size:RAY_STEP_SUMMARY_BYTES,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC});
      const read=device.createBuffer({size:RAY_STEP_SUMMARY_BYTES,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
      const group=device.createBindGroup({layout,entries:[{binding:0,resource:{buffer:samples}},{binding:1,resource:{buffer:summary}}]});
      for(const [population,total,quantiles] of [[163980,'491940',[3,999,1000]],[4294967294,'18446744073709551615',[9,1000000,4294967294]],[1,'0',[0,0,0]],[0,'0',[0,0,0]]]) {
        const input=new Uint32Array(RAY_STEP_SUMMARY_BYTES/4),big=BigInt(total);input.set([population,Number(big&0xffffffffn),Number(big>>32n)]);
        for(let q=0;q<3;q++){input[3+q]=quantiles[q]&0xffffff00;input[6+q]=1;input[12+q*256+(quantiles[q]&255)]=1;}
        device.queue.writeBuffer(summary,0,input);const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(1);pass.end();encoder.copyBufferToBuffer(summary,0,read,0,RAY_STEP_SUMMARY_BYTES);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);
        const raw=Array.from(new Uint32Array(read.getMappedRange()));read.unmap();rows.push({population,total,quantiles,raw,text:Array.from({length:6},(_,r)=>String.fromCharCode(...raw.slice(glyphOffset+r*columns,glyphOffset+(r+1)*columns)))});
      }
      const validation=await device.popErrorScope();return {info,columns,rows,errors,validation:validation?.message??null};
    }finally{device.destroy();}
  });await save();
  assert.equal(report.signal.validation,null);assert.deepEqual(report.signal.errors,[]);
  const labels=['p50:','p95:','p99:','TOTAL:','RAYS:'];
  for(const row of report.signal.rows){
    const values=[...row.quantiles.map(v=>row.population?BigInt(v).toLocaleString('en-US'):'-'),BigInt(row.total).toLocaleString('en-US'),BigInt(row.population).toLocaleString('en-US')];
    values.forEach((value,i)=>assert.equal(row.text[i+1],labels[i]+value.padStart(report.signal.columns-labels[i].length),'grouped value right-aligned without clipping'));
  }
  assert.deepEqual(report.errors,[]);report.status='passed';report.phase='complete';
}catch(e){report.status='failed';report.error=e.stack;process.exitCode=1;}
finally{await browser?.close();report.browserClosed=true;await save();}
console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,out}));
