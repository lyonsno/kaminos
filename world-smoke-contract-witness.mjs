// Explicit tiny native GPU contract probe; no production readback or frame loop.
export async function probeWorldSmokeContracts() {
  const {createWorldSmoke,worldSmokePlan}=await import('./volume-world-smoke.mjs');
  const adapter=await navigator.gpu.requestAdapter();
  const device=await adapter.requestDevice();const errors=[];
  device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
  const results=[];
  try {
    for(const fineVelocityMode of ['collocated','staggered']) {
      const owned=[];const proxy=new Proxy(device,{get(target,key){
        if(key==='createBuffer')return desc=>{const b=target.createBuffer(desc);owned.push({b,label:desc.label});return b;};
        const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
      }});
      const plan=worldSmokePlan({flow:8,material:8,extent:2});
      const transform={translate:[0,0,0],scale:1};
      const field=createWorldSmoke(proxy,plan,transform);
      const fine=device.createBuffer({size:8*16*8*64,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
      const values=new Float32Array(8*16*8*16);
      for(let z=0;z<8;z++)for(let y=0;y<16;y++)for(let x=0;x<8;x++)values[(x+8*(y+16*z))*16]=x;
      device.queue.writeBuffer(fine,0,values);
      const reaction=device.createTexture({size:[8,16,8],dimension:'3d',format:'rg32float',usage:GPUTextureUsage.TEXTURE_BINDING});
      const encoder=device.createCommandEncoder();
      const receipt=field.encode(encoder,{fineBuffer:fine,reactionTexture:reaction,fineDims:[8,16,8],fineVelocityMode,transform,time:{dtScale:0,backtraceScale:0},iterations:0});
      const read=device.createBuffer({size:plan.flowCells*16,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
      encoder.copyBufferToBuffer(owned.find(x=>x.label==='world smoke flow 0').b,0,read,0,plan.flowCells*16);
      device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);
      const observed=new Float32Array(read.getMappedRange())[(3+8*(5+16*3))*4];
      const expected=fineVelocityMode==='collocated'?.875:.75;
      results.push({fineVelocityMode,observed,expected,velocityPass:Math.abs(observed-expected)<1e-6,receipt,emptyCollisionPass:receipt.collision==='empty-fallback'});
      read.unmap();read.destroy();fine.destroy();reaction.destroy();field.destroy();
    }
    await device.queue.onSubmittedWorkDone();
    return {results,errors,passed:errors.length===0&&results.every(r=>r.velocityPass&&r.emptyCollisionPass)};
  }finally{device.destroy();}
}
if(typeof window==='undefined'){
  const fs=await import('node:fs/promises');const {execFileSync}=await import('node:child_process');
  const [origin,out,executable,playwright]=process.argv.slice(2);
  const report={status:'running',phase:'launch',source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),root:process.cwd(),executable};
  await fs.mkdir(out,{recursive:true});let browser;
  try{
    const {chromium}=await import(playwright);
    browser=await chromium.launch({executablePath:executable,headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});
    const page=await browser.newPage();report.runtime=await(await page.request.get(origin+'/api/runtime-config')).json();
    if(report.runtime.source.commit!==report.source||report.runtime.source.repoRoot!==report.root)throw Error('Source mismatch');
    await page.goto(origin+'/volume-world-smoke.mjs');report.phase='native-contracts';
    report.probe=await page.evaluate(async()=>{const m=await import('/world-smoke-contract-witness.mjs');return m.probeWorldSmokeContracts();});
    report.status=report.probe.passed?'passed':'failed';report.phase='complete';if(!report.probe.passed)process.exitCode=1;
  }catch(error){report.status='failed';report.error=String(error.stack||error);process.exitCode=1;}
  finally{await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));await browser?.close();}
  console.log(JSON.stringify(report));
}
