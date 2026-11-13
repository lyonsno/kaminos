// kaminos-test: manual — production WebGPU training/export/adjoint conformance; Greenroom admission.
import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
import {createNeumipStudent,createNeumipTraining,neumipTrainingLayout} from '../neumip-training.mjs';
import {writeNeumipModel,readNeumipModel} from '../neumip-model.mjs';import {referenceNeumip} from './neumip-reference.mjs';import {withKaminosGpu} from './shader-herder.mjs';
const [out]=process.argv.slice(2);if(!out)throw Error('Usage: node tools/neumip-spatial-training-check.mjs OUTPUT_DIR');await fs.mkdir(out,{recursive:true});
const report={status:'running',phase:'start',repoRoot:process.cwd(),queueJob:process.env.GREENROOM_JOB_ID??null,recipe:'author-web-spatial-v1',oracle:'Independent periodic Gaussian convolution per pinned straintensor/NeuMIP c1e2f2aa3488b7460cbf19f5bf6d1c4343926178 utils/tensor.py, plus finite differences through existing CPU material evaluator'};
const publish=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await publish();
const near=(a,b,label,atol=2e-6,rtol=.02)=>{assert.equal(a.length,b.length,label);for(let i=0;i<a.length;i++)assert.ok(Number.isFinite(a[i])&&Math.abs(a[i]-b[i])<=atol+rtol*Math.abs(b[i]),`${label}[${i}]: ${a[i]} vs ${b[i]}`);};
// Independent oracle, not a call to the production filter. Periodic boundaries
// and sigma per mip follow the pinned author implementation.
function filtered(raw,step=0,{constantSigma=null}={}){const model=structuredClone(raw),sigma=Math.max(.1,8*2**(-step/(10000/3)));
 for(const [level,f]of [model.offset,...model.mips].entries()){
  const s=constantSigma!==null?(level===0?0:constantSigma):(level===0?Math.max(1,sigma):sigma/2**(level-1));if(s<.2)continue;
  const radius=Math.ceil(3*s),weights=Array.from({length:2*radius+1},(_,i)=>Math.exp(-.5*((i-radius)/s)**2)),sum=weights.reduce((a,b)=>a+b,0);for(let i=0;i<weights.length;i++)weights[i]/=sum;
  for(const vertical of [true,false]){const input=f.data,out=new Float32Array(input.length);for(let y=0;y<f.height;y++)for(let x=0;x<f.width;x++)for(let c=0;c<f.channels;c++){
   let v=0;for(let k=-radius;k<=radius;k++){const xx=(x+(vertical?0:k)+f.width*radius)%f.width,yy=(y+(vertical?k:0)+f.height*radius)%f.height;v+=input[(yy*f.width+xx)*f.channels+c]*weights[k+radius];}out[(y*f.width+x)*f.channels+c]=v;
  }f.data=out;}
 }return model;
}
const rows=[[.99,.03,.31,-.22,.3,.2,.4,0],[.31,.73,-.2,.3,-.1,.4,.75,0]],targets=new Float32Array([.1,.2,.3,.25,.14,.19]);
const response=m=>rows.flatMap(([u,v,vx,vy,lx,ly,lod])=>referenceNeumip(m,[u,v],[vx,vy],[lx,ly],lod));const loss=m=>response(m).reduce((s,v,i)=>s+.5*(v-targets[i])**2,0);
try{
 report.source=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();report.sourceStatus=execFileSync('git',['status','--porcelain'],{encoding:'utf8'});report.sourceFiles={};
 for(const name of ['neumip-training.mjs','neumip-spatial-training.mjs','tools/neumip-spatial-training-check.mjs','tools/neumip-reference.mjs']){const data=await fs.readFile(name);report.sourceFiles[name]=createHash('sha256').update(data).digest('hex');await fs.writeFile(path.join(out,path.basename(name)),data);}
 const raw=createNeumipStudent({resolution:32,seed:37});for(const f of [raw.offset,...raw.mips]){f.height=Math.max(1,f.height/2);f.data=Float32Array.from({length:f.width*f.height*f.channels},(_,i)=>Math.sin(Math.floor(i/f.channels)%f.width*2*Math.PI/f.width)*.15+Math.cos(Math.floor(i/f.channels/f.width)*2*Math.PI/f.height)*.08+(i%f.channels)*.01);}
 for(const l of raw.layers){l.weights.fill(l.name.startsWith('main.mpl3')?.025:.08);l.biases.fill(.02);}
 const reference=filtered(raw),layout=neumipTrainingLayout(raw);report.fixture={fields:[raw.offset,...raw.mips].map(({width,height,channels})=>({width,height,channels})),step:0,sigma:8};
 const access=index=>{for(const net of Object.values(layout.networks))for(const l of net.layers){if(index>=l.weightsOffset&&index<l.biasesOffset)return[l.weights,index-l.weightsOffset];if(index>=l.biasesOffset&&index<l.biasesOffset+l.output)return[l.biases,index-l.biasesOffset];}for(const f of layout.fields)if(index>=f.offset&&index<f.offset+f.data.length)return[f.data,index-f.offset];throw Error('bad parameter');};
 const indices=Object.values(layout.networks).flatMap(n=>n.layers.map(l=>l.biasesOffset));for(const f of layout.fields)indices.push(f.offset,f.offset+f.channels,f.offset+f.data.length-1);
 const expected=indices.map(i=>{const [a,k]=access(i),old=a[k],eps=.002;a[k]=old+eps;const hi=loss(filtered(raw)),xhi=a[k];a[k]=old-eps;const lo=loss(filtered(raw)),xlo=a[k];a[k]=old;return(hi-lo)/(xhi-xlo);});
 report.phase='native-spatial';await publish();
 await withKaminosGpu(async ctx=>{report.adapter=ctx.adapterInfo;let gpu,baseline,reloaded;
 const read=async b=>{const t=ctx.device.createBuffer({size:b.size,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});try{const e=ctx.device.createCommandEncoder();e.copyBufferToBuffer(b,0,t,0,b.size);ctx.device.queue.submit([e.finish()]);await t.mapAsync(GPUMapMode.READ);return new Float32Array(t.getMappedRange().slice(0));}finally{t.destroy();}};
 try{
  gpu=await createNeumipTraining(ctx.device,raw,{batchSize:rows.length,trainingRecipe:report.recipe});gpu.setQueries(new Float32Array(rows.flat()));gpu.setTargets(targets);
  const exported=await gpu.exportModel();for(const [i,f]of [exported.offset,...exported.mips].entries())near([...f.data],[...[reference.offset,...reference.mips][i].data],'baked filtered field '+i,3e-6,1e-5);
  const actual=await gpu.gradients();near([...actual.rgb],response(reference),'filtered forward',3e-5,.001);near(indices.map(i=>actual.values[i]),expected,'raw-field adjoint',2e-6,.025);report.gradients={indices,actual:indices.map(i=>actual.values[i]),expected};assert.ok(Math.abs(expected[3])>1e-7,'the offset prediction must receive a nonzero spatial gradient');
  assert.ok(expected.slice(8).some(v=>Math.abs(v)>2e-6),'field-gradient fixture must exercise the spatial support');
  assert.throws(()=>near(new Array(expected.length).fill(0),expected,'zero adjoint',2e-6,.025));report.zeroAdjointRejected=true;
  reloaded=await createNeumipTraining(ctx.device,readNeumipModel(writeNeumipModel(exported)),{batchSize:rows.length});reloaded.setQueries(new Float32Array(rows.flat()));near([...(await reloaded.evaluate()).rgb],[...actual.rgb],'export runtime parity',3e-5,.001);
  baseline=await createNeumipTraining(ctx.device,raw,{batchSize:rows.length,trainingRecipe:'legacy-unsmoothed-v1'});baseline.setQueries(new Float32Array(rows.flat()));near([...(await baseline.evaluate()).rgb],response(raw),'explicit unsmoothed baseline',3e-5,.001);
  assert.ok(response(raw).some((v,i)=>Math.abs(v-actual.rgb[i])>1e-5),'missing-smoothing route must differ from the fixture');
  report.phase='raw-damping-native';await publish();
  const damped=structuredClone(raw),smooth=filtered(raw,0,{constantSigma:1.03});for(let m=0;m<damped.mips.length;m++)for(let i=0;i<damped.mips[m].data.length;i++)damped.mips[m].data[i]=.9*damped.mips[m].data[i]+.1*smooth.mips[m].data[i];
  const zero=ctx.device.createCommandEncoder();gpu.encodeUpdate(zero,{lrWeights:0,lrFields:0});ctx.device.queue.submit([zero.finish()]);await ctx.device.queue.onSubmittedWorkDone();const afterDamp=await read(gpu.buffers.parameters),expectedDamp=neumipTrainingLayout(damped).values;
  near([...afterDamp],[...expectedDamp],'raw appearance damping',3e-6,1e-5);near([...afterDamp.subarray(0,layout.fields[1].offset)],[...layout.values.subarray(0,layout.fields[1].offset)],'damping leaves offset and networks unchanged',0,0);assert.throws(()=>near([...layout.values],[...expectedDamp],'missing damping',3e-6,1e-5));
  const noDamp=ctx.device.createCommandEncoder();gpu.encodeUpdate(noDamp,{lrWeights:0,lrFields:0});ctx.device.queue.submit([noDamp.finish()]);await ctx.device.queue.onSubmittedWorkDone();near([...(await read(gpu.buffers.parameters))],[...afterDamp],'no damping between scheduled steps',0,0);report.dampingVerified=true;
  const before=(await gpu.gradients()).loss;const encoder=ctx.device.createCommandEncoder();gpu.encodeUpdate(encoder,{lrWeights:.0001,lrFields:.0001});ctx.device.queue.submit([encoder.finish()]);await ctx.device.queue.onSubmittedWorkDone();const after=(await gpu.gradients()).loss;assert.ok(after<before,'native optimizer must improve the smoothed objective');report.learning={before,after};
  report.phase='freeze-native';await publish();
  // Test the production optimizer freeze input independently of the CPU
  // schedule boundary, without spending ten thousand updates on this fixture.
  const beforeRaw=await read(gpu.buffers.parameters);const e=ctx.device.createCommandEncoder();gpu.encodeUpdate(e,{lrWeights:.0001,lrFields:.0001});assert.ok(gpu.buffers.config,'native freeze fixture requires actual optimizer uniform');ctx.device.queue.writeBuffer(gpu.buffers.config,20,new Uint32Array([1]));ctx.device.queue.submit([e.finish()]);await ctx.device.queue.onSubmittedWorkDone();const afterRaw=await read(gpu.buffers.parameters),offset=layout.fields[0];near([...afterRaw.subarray(offset.offset,offset.offset+offset.data.length)],[...beforeRaw.subarray(offset.offset,offset.offset+offset.data.length)],'frozen raw offset',0,0);assert.ok(afterRaw.slice(0,layout.weightCount).some((v,i)=>v!==beforeRaw[i]));report.freezeVerified=true;
 }finally{gpu?.dispose();baseline?.dispose();reloaded?.dispose();}
 },{onEvidence:e=>report.evidence=e});report.status='passed';report.phase='complete';
}catch(e){report.status='failed';report.error=e.stack;process.exitCode=1;}finally{await publish();console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,report:path.join(out,'report.json')}));}
