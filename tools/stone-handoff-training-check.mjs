// kaminos-test: manual — Greenroom-admitted production WGSL numerical checks.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {withKaminosGpu,evalWgslBatch} from './shader-herder.mjs';
import {createNeumipStudent,createNeumipTraining,neumipTrainingLayout} from '../neumip-training.mjs';
import {buildHandoffMath,handoffWeight} from '../stone-handoff-model.mjs';
import {buildNeumipWGSL} from '../neumip-shader.mjs';
import {SurfaceMaterialTeacher} from '../surface-material-teacher.mjs';
const out=process.argv[2];if(!out)throw Error('Output directory required');await fs.mkdir(out,{recursive:true});
const report={status:'running',phase:'configuration',job:process.env.GREENROOM_JOB_ID,repoRoot:process.cwd(),sourceRevision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),checks:[]};
const publish=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
const close=(actual,expected,tol=2e-5)=>assert.ok(Math.abs(actual-expected)<tol,`${actual} != ${expected}`);
try{
 await publish();if(!report.job)throw Error('Production numerical checks require Greenroom admission');
 const handoff={cheapResolution:64,routing:{width:.7,depth:.7,inner:.08,collar:.04},material:{color:[.4,.35,.3],roughness:.8,metalness:0}};
 const model=createNeumipStudent({resolution:64,seed:41,handoff}),math=buildHandoffMath(model.handoff,64);
 report.phase='hardware';await publish();
 await withKaminosGpu(async ctx=>{
  report.adapter=ctx.adapterInfo;
  const cases=[[.25,.25,0],[0,0,0],[.25,.25,5],[.99,.02,1.5],[-.01,1.02,1.5]];
  const weights=await evalWgslBatch(ctx,{preamble:math.weight,argTypes:['f32','f32','f32'],returnType:'f32',body:'return stoneHandoffWeight(vec2<f32>(arg0,arg1),arg2);',inputs:cases});
  weights.forEach((w,i)=>close(w,handoffWeight(cases[i].slice(0,2),cases[i][2],64,handoff.routing)));assert.equal(weights[0],0);report.checks.push({name:'analytic footprint routing',weights});
  const directions=[[0,0,.5,.3],[.75,.2,-.5,.5],[.2,-.3,.1,.1]];
  const flat=await evalWgslBatch(ctx,{preamble:math.flat,argTypes:['f32','f32','f32','f32'],returnType:'vec3<f32>',body:'return stoneFlatResponse(vec2<f32>(arg0,arg1),vec2<f32>(arg2,arg3));',inputs:directions});
  const a=[-3,0,-3],b=[3,0,-3],c=[3,0,3],d=[-3,0,3];const teacher=new SurfaceMaterialTeacher(ctx.device,{triangles:[{a,b:c,c:b,materialIndex:0},{a,b:d,c,materialIndex:0}],materials:[handoff.material],lights:[],environment:0,bounces:1});
  try{const q=Float32Array.from(directions.flatMap(x=>[.5,.5,...x,0,0])),reference=await teacher.evaluateMaterial(q,{tileSize:.7,referenceHeight:.01,resolution:64,samples:1});flat.flat().forEach((v,i)=>close(v,reference[i]));report.checks.push({name:'cheap GGX matches actual flat transport teacher',flat,reference:Array.from(reference)});}finally{teacher.dispose();}
  const head=model.layers.find(l=>l.name==='main.mpl3');head.biases.set([.1,-.02,.03]);
  const learner=await createNeumipTraining(ctx.device,model,{batchSize:3});
  try{
   const q=Float32Array.from([[.25,.25,0,0,.5,.3,0,0],[0,0,0,0,.5,.3,0,0],[.25,.25,0,0,.5,.3,5,0]].flat());learner.setQueries(q);
   const result=(await learner.evaluate()).rgb,base=(await learner.evaluate({richEnabled:false})).rgb;
   for(let i=0;i<3;i++)for(let ch=0;ch<3;ch++)close(result[i*3+ch],base[i*3+ch]+weights[i]*head.biases[ch]);
   const actualMain=buildNeumipWGSL(model).main,consumer=await evalWgslBatch(ctx,{preamble:actualMain,argTypes:[],returnType:'vec3<f32>',body:'return neumipMain(vec4<f32>(0.0),vec4<f32>(0.0),vec2<f32>(0.0),vec2<f32>(0.0));',inputs:[[]]});consumer[0].forEach((v,i)=>close(v,head.biases[i]));
   report.checks.push({name:'signed residual, zero-support endpoint and consumer head',result:Array.from(result),base:Array.from(base)});
   const targets=Float32Array.from(result,x=>x+.01);learner.setTargets(targets);const grad=await learner.gradients();const layout=neumipTrainingLayout(model),index=layout.networks.main.layers[3].biasesOffset;
   close(grad.values[index],-.01*(weights[0]+weights[1]+weights[2]),1e-5);
   const eps=.0005,loss=rgb=>rgb.reduce((s,x,i)=>s+.5*(x-targets[i])**2,0);
   ctx.device.queue.writeBuffer(learner.buffers.parameters,index*4,new Float32Array([head.biases[0]+eps]));const plus=loss((await learner.evaluate()).rgb);ctx.device.queue.writeBuffer(learner.buffers.parameters,index*4,new Float32Array([head.biases[0]-eps]));const minus=loss((await learner.evaluate()).rgb);ctx.device.queue.writeBuffer(learner.buffers.parameters,index*4,new Float32Array([head.biases[0]]));close((plus-minus)/(2*eps),grad.values[index],1e-5);
   report.checks.push({name:'composed-loss gradient finite difference',analytic:grad.values[index],numerical:(plus-minus)/(2*eps)});
   let before=neumipTrainingLayout(await learner.exportModel()).values.slice();const split=layout.fields[layout.cheapStartField].offset;
   const update=async options=>{learner.setQueries(q);learner.setTargets(targets);const e=ctx.device.createCommandEncoder();learner.encodeUpdate(e,options);ctx.device.queue.submit([e.finish()]);await ctx.device.queue.onSubmittedWorkDone();};
   await update({trainRich:false,trainCheap:true});let after=neumipTrainingLayout(await learner.exportModel()).values;assert.deepEqual(after.subarray(0,split),before.subarray(0,split));assert.ok(after.subarray(split).some((v,i)=>v!==before[split+i]));
   learner.resetOptimizer();before=after.slice();await update({trainRich:true,trainCheap:false});after=neumipTrainingLayout(await learner.exportModel()).values;assert.deepEqual(after.subarray(split),before.subarray(split));assert.ok(after.subarray(0,split).some((v,i)=>v!==before[i]));
   report.checks.push({name:'phase freezing preserves parameters exactly'});
  }finally{learner.dispose();}
 },{requiredLimits:{maxStorageBufferBindingSize:128*1024**2,maxBufferSize:256*1024**2},onEvidence:e=>report.evidence=e});
 report.phase='complete';report.status='passed';
}catch(e){report.status='failed';report.error=e.stack;process.exitCode=1;}
finally{await publish();console.log(JSON.stringify(report));}
