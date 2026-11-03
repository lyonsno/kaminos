// Tiny native contracts: original material law versus work-elided law, plus
// measured outward handoff before/after the optional momentum collar.
export async function probeWorldTransition(referenceShader) {
 const {createWorldSmoke,worldSmokePlan}=await import('./volume-world-smoke.mjs');
 const {resolveReactantCombustionConfig}=await import('./volume-reactant-combustion.mjs');
 const adapter=await navigator.gpu.requestAdapter(),device=await adapter.requestDevice(),errors=[];
 device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
 const plan=worldSmokePlan({flow:8,material:16,extent:2}),transform={translate:[0,0,0],scale:1};
 const fine=device.createBuffer({size:8*16*8*64,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
 const reaction=device.createTexture({size:[8,16,8],dimension:'3d',format:'rg32float',usage:GPUTextureUsage.TEXTURE_BINDING});
 const values=new Float32Array(8*16*8*16);
 for(let i=0;i<8*16*8;i++){values[i*16]=4;values[i*16+4]=.4;values[i*16+5]=1.2;values[i*16+6]=.2;}
 device.queue.writeBuffer(fine,0,values);
 const common={fineBuffer:fine,reactionTexture:reaction,fineDims:[8,16,8],transform,time:{dtScale:.25,backtraceScale:.1},
   reactant:resolveReactantCombustionConfig({reactionLaw:'reactant-v0',volumeScene:'tall_plume',emitterSourceLaw:'immersed-source'}),iterations:16};
 const fields=[];
 function make(shader){
   const buffers=new Map();
   const proxy=new Proxy(device,{get(t,k){
     if(k==='createBuffer')return d=>{const b=t.createBuffer(d);buffers.set(d.label,b);return b;};
     if(k==='createShaderModule')return d=>t.createShaderModule(shader?{...d,code:shader}:d);
     const v=Reflect.get(t,k,t);return typeof v==='function'?v.bind(t):v;
   }});
   const field=createWorldSmoke(proxy,plan,transform);fields.push(field);return{field,buffers};
 }
 async function run(arm,transitionCells=0){
   let receipt;
   for(let i=0;i<24;i++){const enc=device.createCommandEncoder();receipt=arm.field.encode(enc,{...common,transitionCells});device.queue.submit([enc.finish()]);}
   const read=device.createBuffer({size:plan.materialCells*32,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
   const enc=device.createCommandEncoder();enc.copyBufferToBuffer(arm.buffers.get('world smoke material 0'),0,read,0,read.size);device.queue.submit([enc.finish()]);
   await read.mapAsync(GPUMapMode.READ);const gas=Array.from(new Float32Array(read.getMappedRange()));read.unmap();read.destroy();
   let exterior=0,donor=0;
   for(let z=0;z<16;z++)for(let y=0;y<32;y++)for(let x=0;x<16;x++){
     const soot=gas[(x+16*(y+32*z))*8],px=-2+(x+.5)*.25;
     if(px>1)exterior+=soot;
     if(x===8&&y===8&&z===8)donor=soot;
   }
   return{gas,receipt,exterior,donor};
 }
 try{
   const reference=await run(make(referenceShader)),baseline=await run(make());
   let maxDifference=0;
   for(let i=0;i<baseline.gas.length;i++)maxDifference=Math.max(maxDifference,Math.abs(baseline.gas[i]-reference.gas[i]));
   const collar=await run(make(),2);
   await device.queue.onSubmittedWorkDone();
   const finite=[reference,baseline,collar].every(x=>x.gas.every(Number.isFinite));
   const parity=finite&&maxDifference<2e-5&&baseline.donor>.39&&baseline.exterior>0&&baseline.receipt.materialLaw==='reactant-v0';
   const handoff=finite&&collar.exterior>baseline.exterior&&collar.receipt.transitionCells===2;
   return{adapter:adapter.info,errors,parity:{passed:parity,maxDifference,reference,baseline},handoff:{passed:handoff,collar},passed:errors.length===0&&parity&&handoff};
 }finally{for(const f of fields)f.destroy();fine.destroy();reaction.destroy();device.destroy();}
}
if(typeof window==='undefined'){
 const fs=await import('node:fs/promises'),{execFileSync}=await import('node:child_process'),{pathToFileURL}=await import('node:url');
 const [origin,out,executable,playwright]=process.argv.slice(2);
 const baseline='a76c7a8bcb9c596e47a801458f7ea7bb3b040781';
 const report={status:'failed',phase:'source',root:process.cwd(),source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),baseline,executable};
 await fs.mkdir(out,{recursive:true});let browser;
 try{
   const raw=execFileSync('git',['show',baseline+':volume-world-smoke.mjs'],{encoding:'utf8'});
   const source=raw.replace(/from '(\.\/[^']+)'/g,(_,p)=>'from '+JSON.stringify(pathToFileURL(process.cwd()+'/'+p).href));
   const reference=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
   const {chromium}=await import(playwright);
   browser=await chromium.launch({executablePath:executable,headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});
   const page=await browser.newPage();report.runtime=await(await page.request.get(origin+'/api/runtime-config')).json();
   if(report.runtime.source.repoRoot!==report.root||report.runtime.source.commit!==report.source)throw Error('Source mismatch');
   await page.goto(origin+'/volume-world-smoke.mjs');report.phase='native';
   report.probe=await page.evaluate(async shader=>(await import('/world-transition-witness.mjs')).probeWorldTransition(shader),reference.WORLD_SMOKE_WGSL);
   report.status=report.probe.passed?'passed':'failed';report.phase='complete';if(!report.probe.passed)process.exitCode=1;
 }catch(e){report.error=String(e.stack||e);process.exitCode=1;}
 finally{await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));await browser?.close();}
 console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,parity:report.probe?.parity.passed,handoff:report.probe?.handoff.passed,out}));
}
