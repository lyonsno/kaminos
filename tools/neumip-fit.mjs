// kaminos-test: manual — explicit teacher, output, iteration count; Greenroom GPU job.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readNeumipModel,writeNeumipModel} from '../neumip-model.mjs';
import {createNeumipStudent,createNeumipTraining,neumipTrainingLayout,neumipTrainingBufferSizes} from '../neumip-training.mjs';
import {checkedNeumipTrainingRecipe} from '../neumip-spatial-training.mjs';
import {withKaminosGpu,withGpuErrorScopes} from './shader-herder.mjs';

const [file,out,...flags]=process.argv.slice(2);
if(!file||!out)throw Error('Usage: node tools/neumip-fit.mjs AUTHOR_MODEL OUTPUT_DIR [--training-recipe author-web-spatial-v1 --steps 30000 --batch 2048 --resolution 64 --seed 2718]');
const options={steps:30000,batch:2048,resolution:64,seed:2718,trainingRecipe:'author-web-spatial-v1'};
for(let i=0;i<flags.length;i+=2){const flag=flags[i]?.replace(/^--/,''),name=flag==='training-recipe'?'trainingRecipe':flag;if(!(name in options))throw Error(`Unknown option ${flags[i]}`);if(i+1>=flags.length)throw Error(`Missing value for ${flags[i]}`);options[name]=name==='trainingRecipe'?checkedNeumipTrainingRecipe(flags[i+1]):Number(flags[i+1]);}
for(const [key,value] of Object.entries(options))if(key!=='trainingRecipe'&&(!Number.isSafeInteger(value)||value<1))throw Error(`Invalid ${key}`);
await fs.mkdir(out,{recursive:true});
const report={status:'running',phase:'input',repoRoot:process.cwd(),queueJob:process.env.GREENROOM_JOB_ID??null,teacher:file,options,progress:[],
  claim:'Randomly initialized directional student distilled from frozen author network; not an independent microgeometry reproduction',
  training:{recipe:options.trainingRecipe,loss:'linear RGB half-squared difference',deviations:'Frozen model distillation; objective, optimizer rates and exposure differ from full author recipe'},
  scheduling:'One fenced optimizer update followed by a 16ms host yield; caller/Greenroom owns admission',
  source:null};
const publish=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await publish();
const hash=a=>createHash('sha256').update(a).digest('hex');
let state=options.seed>>>0;
const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return (state+.5)/4294967296;};
function queries(n,maxLod){
  const result=new Float32Array(n*8);
  for(let q=0;q<n;q++){
    const i=q*8;result[i]=random();result[i+1]=random();
    for(const k of [2,4]){const theta=random()*Math.PI*2,r=Math.sqrt(random()*.99);result[i+k]=r*Math.cos(theta);result[i+k+1]=r*Math.sin(theta);}
    result[i+6]=random()<.6?0:random()*maxLod;
  }
  return result;
}
const meanLoss=(a,b)=>a.reduce((sum,x,i)=>sum+.5*(x-b[i])**2,0)/(a.length/3);
try{
  if(!report.queueJob)throw Error('Directional fitting requires Greenroom admission');
  report.source=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  report.sourceStatus=execFileSync('git',['status','--porcelain'],{encoding:'utf8'});report.sourceDirty=!!report.sourceStatus.trim();
  for(const relative of ['neumip-training.mjs','neumip-spatial-training.mjs','neumip-model.mjs','tools/neumip-fit.mjs']){
    const data=await fs.readFile(relative);(report.sourceFiles??={})[relative]=hash(data);await fs.writeFile(path.join(out,path.basename(relative)),data);
  }
  const bytes=await fs.readFile(file),author=readNeumipModel(bytes),student=createNeumipStudent({resolution:options.resolution,seed:options.seed,trainingRecipe:options.trainingRecipe});
  report.teacherSha256=hash(bytes);
  const bias=Math.log2(author.mips[0].width/options.resolution);
  if(!Number.isInteger(bias)||bias<0)throw Error('Student resolution must divide teacher resolution by a power of two');
  report.footprint={teacherFinest:author.mips[0].width,studentFinest:options.resolution,teacherLodBias:bias,
    meaning:'Student LOD0 labels use author LOD bias for the same nominal base footprint. Author finest reference retained separately.'};
  const heldoutCount=Math.min(options.batch,512),trainingState=state;
  state=(options.seed^0x5a17bca9)>>>0;const heldout=queries(heldoutCount,student.mips.length-1);state=trainingState;
  const heldoutFinest=heldout.slice();for(let q=0;q<heldoutCount;q++)heldoutFinest[q*8+6]=0;
  const largestBinding=Math.max(...[author,student].flatMap(model=>Object.values(neumipTrainingBufferSizes(neumipTrainingLayout(model),options.batch,{trainingRecipe:model===student?options.trainingRecipe:'legacy-unsmoothed-v1'}))));
  report.requiredLimits={maxStorageBufferBindingSize:Math.max(128*1024**2,largestBinding)};
  report.phase='compile';await publish();
  await withKaminosGpu(async ctx=>{
    report.adapter=ctx.adapterInfo;report.effectiveLimits={maxStorageBufferBindingSize:ctx.device.limits.maxStorageBufferBindingSize,maxBufferSize:ctx.device.limits.maxBufferSize,maxComputeWorkgroupsPerDimension:ctx.device.limits.maxComputeWorkgroupsPerDimension};let teacher=null,learner=null;
    try{
      teacher=await createNeumipTraining(ctx.device,author,{batchSize:options.batch});
      learner=await createNeumipTraining(ctx.device,student,{batchSize:options.batch,trainingRecipe:options.trainingRecipe});
      report.parameters={count:learner.layout.count,weights:learner.layout.weightCount,fields:learner.layout.count-learner.layout.weightCount};
      teacher.setQueries(heldout);const labels=await teacher.teach({lodBias:bias});
      teacher.setQueries(heldoutFinest);const finest=await teacher.teach({lodBias:0});
      const checkpoint=async step=>{
        learner.setQueries(heldout);const {rgb}=await learner.evaluate();const entry={step,spatial:learner.spatialState(),heldoutLoss:meanLoss(rgb,labels),elapsedMs:performance.now()-started};
        report.progress.push(entry);console.log(JSON.stringify(entry));
        const fitted=await learner.exportModel(),archive=writeNeumipModel(fitted);
        const filename=`rocky-${options.resolution}-step-${step}.model`;await fs.writeFile(path.join(out,filename),archive);
        report.latest={step,file:filename,sha256:hash(archive),bytes:archive.length};
        await fs.writeFile(path.join(out,`heldout-${step}.json`),JSON.stringify({queries:[...heldout],student:[...rgb],teacher:[...labels],teacherFinestAtSamePoints:[...finest]}));
        await publish();
      };
      const started=performance.now();await checkpoint(0);report.phase='fit';await publish();
      for(let step=1;step<=options.steps;step++){
        const batch=queries(options.batch,student.mips.length-1);teacher.setQueries(batch);learner.setQueries(batch);
        report.lastAttemptedStep=step;
        const update=async()=>{
          const encoder=ctx.device.createCommandEncoder();teacher.encodeTeacher(encoder,{lodBias:bias});learner.copyTargetsFrom(encoder,teacher);
          learner.encodeUpdate(encoder,{lrWeights:.001,lrFields:.01});ctx.device.queue.submit([encoder.finish()]);await ctx.device.queue.onSubmittedWorkDone();
        };
        if(step===1)await withGpuErrorScopes(ctx.device,'neumip-fit-step-1',update);else await update();
        await new Promise(resolve=>setTimeout(resolve,16));
        if(step===1){report.step1ElapsedMs=performance.now()-started;console.log(JSON.stringify({step1ElapsedMs:report.step1ElapsedMs}));await publish();}
        if(step%250===0||step===options.steps)await checkpoint(step);
      }
      report.elapsedMs=performance.now()-started;
      const final=report.progress.at(-1).heldoutLoss,initial=report.progress[0].heldoutLoss;
      report.lossRatio=final/initial;
      if(!(Number.isFinite(final)&&final<initial))throw Error('Directional student did not improve on held-out queries');
      const matched=writeNeumipModel({...author,mips:author.mips.slice(bias),architecture:author.architecture});
      await fs.writeFile(path.join(out,'rocky-author-matched-footprint.model'),matched);
      report.matchedReference={sha256:hash(matched),bytes:matched.length,teacherLevelsRemoved:bias};
      report.samplerState=state;
    }finally{learner?.dispose();teacher?.dispose();}
  },{requiredLimits:report.requiredLimits,onEvidence:e=>report.evidence=e});
  report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.error=error.stack;process.exitCode=1;}
finally{await publish();console.log(JSON.stringify({status:report.status,phase:report.phase,latest:report.latest,lossRatio:report.lossRatio,error:report.error}));}
