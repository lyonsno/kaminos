import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const digest=b=>createHash('sha256').update(b).digest('hex');
export function validateCarrierCapture(raw,metadata,capture,commit){
 if(capture.status!=='passed'||capture.expectedCommit!==commit)throw Error('Capture revision or terminal state differs from requested source');
 const e=metadata.effective;
 if(!metadata.available||metadata.frame?.ok!==true||e?.effective!=='world-optical-particles'||e.recordFloats!==24||e.settings?.materialStateVersion!==1)throw Error('Capture did not exercise current-composition particle route');
 if(!Number.isSafeInteger(e.slots)||e.slots<1||raw.length!==e.slots*96||metadata.records?.bytes!==raw.length||metadata.records.sha256!==digest(raw))throw Error('Incomplete or changed carrier population');
 const records=new Float32Array(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));let active=0,emissive=0;
 for(let i=0;i<records.length;i++){if(!Number.isFinite(records[i]))throw Error('Nonfinite carrier data');if(i%24===3&&records[i]>0){active++;if(records[i+5]>0||records[i+6]>0||records[i+7]>0)emissive++;}}
 if(!active||!emissive)throw Error('Blank or nonemissive held population');
 return {slots:e.slots,active,emissive,sha256:digest(raw),step:metadata.state?.simStepCount,sourceCommit:commit,records};
}

export async function runParticleLightWitness({snapshot,capture,sourceCommit,out,dims=[16,24,16],direction=[0,0,1]}){
 await fs.mkdir(out,{recursive:true});const report={schema:'kaminos.particle-light-sweep.v1',status:'running',phase:'source',snapshot,capture,sourceCommit,requested:{dims,direction},lastTrustworthy:null};
 const save=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');await save();
 try{
  const metadata=JSON.parse(await fs.readFile(snapshot)),sourceReport=JSON.parse(await fs.readFile(capture)),raw=await fs.readFile(metadata.records.path),source=validateCarrierCapture(raw,metadata,sourceReport,sourceCommit);
  await fs.writeFile(path.join(out,'source.records.f32'),raw);await fs.copyFile(snapshot,path.join(out,'source.snapshot.json'));await fs.copyFile(capture,path.join(out,'source.capture.json'));
  report.source={...source,records:undefined,path:metadata.records.path};report.lastTrustworthy='complete captured current-composition population verified and retained';report.phase='device';await save();
  const [{withKaminosGpu,withGpuErrorScopes},{createParticleLightSweep},{readLightBuffer,readLightCoefficients,referenceLightAt}]=await Promise.all([import('./shader-herder.mjs'),import('../volume-particle-light-sweep.mjs'),import('./particle-light-reference.mjs')]);
  await withKaminosGpu(async ctx=>withGpuErrorScopes(ctx.device,'held particle shared illumination',async()=>{
   report.adapter=ctx.adapterInfo;report.effectiveRoute='native-apple/particle-Gaussian-slab-deposit/opposite-interior-sweeps';report.phase='deposition';await save();
   const d=ctx.device,s=metadata.effective.settings,controls=metadata.state.controls;
   const owner=createParticleLightSweep(d,{dims,origin:[-1,-1,-1],extent:[2,3,2],direction,settings:{radius:s.radius,stretch:s.stretch,flowAlignment:s.flowAlignment,expansion:s.expansion,supportFloor:s.supportFloor,gain:s.gain,extinction:controls.density*controls.physicalSmokeExtinction*s.generatedSmokeGain*s.opacity,stateLife:s.stateLife,lifeFade:s.lifeFade}});
   const particles=d.createBuffer({size:raw.length,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});
   try{
    d.queue.writeBuffer(particles,0,new Uint8Array(raw));report.plan=owner.plan;report.arms=[];
    for(const blocked of [false,true]){
     const solids=new Uint32Array(owner.plan.cells);if(blocked)for(let y=0;y<dims[1];y++)for(let x=0;x<dims[0];x++)solids[x+dims[0]*(y+dims[1]*Math.floor(dims[2]/2))]=1;
     d.queue.writeBuffer(owner.solids,0,solids);const encoder=d.createCommandEncoder();owner.deposit(encoder,{particles,slots:source.slots});owner.sweep(encoder);d.queue.submit([encoder.finish()]);
     const [c,p,m,held]=await Promise.all([readLightCoefficients(d,owner),readLightBuffer(d,owner.positive),readLightBuffer(d,owner.negative),readLightBuffer(d,particles)]);
     if(!Buffer.from(held.buffer).equals(raw))throw Error('Lighting mutated the retained carriers');
     if(![...c,...p,...m].every(Number.isFinite)||!c.some((v,i)=>i%4!==3&&v>0))throw Error('Nonfinite or blank optical field');
     let maxAbsoluteError=0,maxScaledError=0;
     for(let z=0;z<dims[2];z++)for(let y=0;y<dims[1];y++)for(let x=0;x<dims[0];x++){
      const i=x+dims[0]*(y+dims[1]*z);for(const [values,reverse]of [[p,false],[m,true]]){
       const expected=solids[i]?[0,0,0,0]:referenceLightAt(c,solids,dims,[x,y,z],reverse);
       for(let k=0;k<4;k++){const error=Math.abs(values[4*i+k]-expected[k]);maxAbsoluteError=Math.max(maxAbsoluteError,error);maxScaledError=Math.max(maxScaledError,error/Math.max(1,Math.abs(expected[k])));}
      }
     }
     if(maxScaledError>4e-5)throw Error('Shared transport differs from independent receiver integrals: '+maxScaledError);
     const name=blocked?'wall':'open';for(const [key,values]of Object.entries({coefficients:c,positive:p,negative:m,solids}))await fs.writeFile(path.join(out,name+'.'+key+(key==='solids'?'.u32':'.f32')),new Uint8Array(values.buffer));
     report.arms.push({name,maxAbsoluteError,maxScaledError,receivers:owner.plan.cells,directions:2,recordsExact:true,sourceSha256:source.sha256});report.lastTrustworthy=name+' native receiver comparison passed';await save();
    }
   }finally{owner.dispose();particles.destroy();}
  }));
  report.status='passed';report.phase='complete';report.claim='Two shared current-frame directions equal independent per-receiver integrals over the deposited Gaussian slab medium. Actual complete held population retained; no timing, full angular illumination, real-scene geometry voxelization or live renderer adoption claim.';
 }catch(error){report.status='failed';report.error=error.stack??String(error);throw error;}finally{await save();}
 return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [snapshot,capture,sourceCommit,out]=process.argv.slice(2);
 if(!out)throw Error('Usage: particle-light-witness.mjs snapshot.json capture-report.json source-commit output-dir');
 await runParticleLightWitness({snapshot,capture,sourceCommit,out});
}

