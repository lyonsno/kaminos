// kaminos-test: manual — native directional forward/backward and author checkpoint.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readNeumipModel} from '../neumip-model.mjs';
import {createNeumipStudent,neumipTrainingLayout,createNeumipTraining} from '../neumip-training.mjs';
import {referenceNeumip} from './neumip-reference.mjs';
import {withKaminosGpu} from './shader-herder.mjs';

const [authorPath,out]=process.argv.slice(2);
if(!authorPath||!out)throw Error('Usage: node tools/neumip-training-check.mjs AUTHOR_MODEL OUTPUT_DIR');
await fs.mkdir(out,{recursive:true});
const report={status:'running',phase:'input',repoRoot:process.cwd(),authorPath,queueJob:process.env.GREENROOM_JOB_ID??null};
const publish=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await publish();
const near=(a,b,label,{absolute=2e-5,relative=2e-3}={})=>{
  assert.equal(a.length,b.length,label);for(let i=0;i<a.length;i++)assert.ok(Number.isFinite(a[i])&&Math.abs(a[i]-b[i])<=absolute+relative*Math.abs(b[i]),`${label} at ${i}: ${a[i]} vs ${b[i]}`);
};
const rows=[ [.23,.37,.2,.1,.3,.2,.4,0],[.71,.61,-.12,.23,.2,-.31,.65,0] ];
const targets=new Float32Array([.1,.2,.3,.25,.14,.19]);
const reference=(model,queries)=>queries.flatMap(([u,v,vx,vy,lx,ly,lod])=>referenceNeumip(model,[u,v],[vx,vy],[lx,ly],lod));
const loss=model=>reference(model,rows).reduce((n,v,i)=>n+.5*(v-targets[i])**2,0);
try{
  report.source=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  report.sourceStatus=execFileSync('git',['status','--porcelain'],{encoding:'utf8'});report.sourceDirty=!!report.sourceStatus.trim();
  report.sourceFiles={};for(const file of ['neumip-training.mjs','neumip-spatial-training.mjs','neumip-model.mjs','tools/neumip-training-check.mjs','tools/neumip-reference.mjs']){
    const data=await fs.readFile(file);report.sourceFiles[file]=createHash('sha256').update(data).digest('hex');await fs.writeFile(path.join(out,path.basename(file)),data);
  }
  const bytes=await fs.readFile(authorPath);report.authorSha256=createHash('sha256').update(bytes).digest('hex');
  const author=readNeumipModel(bytes),student=createNeumipStudent({resolution:4,seed:37});
  if(process.env.NEUMIP_RECTANGULAR_FIXTURE==='1')for(const field of [student.offset,...student.mips]){
    field.height=Math.max(1,field.height/2);field.data=field.data.slice(0,field.width*field.height*field.channels);
  }
  report.fixtureFields=[student.offset,...student.mips].map(({width,height,channels})=>({width,height,channels}));
  for(const l of student.layers){l.weights.fill(l.name.startsWith('main.mpl3')?.025:.08);l.biases.fill(.02);}
  const layout=neumipTrainingLayout(student);
  const selections=[];for(const net of Object.values(layout.networks))for(const l of net.layers)selections.push(l.weightsOffset,l.biasesOffset);
  for(const f of layout.fields)selections.push(f.offset+Math.floor(f.data.length/2),f.offset+f.channels+1);
  const access=index=>{
    for(const net of Object.values(layout.networks))for(const l of net.layers){
      if(index>=l.weightsOffset&&index<l.biasesOffset)return [l.weights,index-l.weightsOffset];
      if(index>=l.biasesOffset&&index<l.biasesOffset+l.output)return [l.biases,index-l.biasesOffset];
    }
    for(const f of layout.fields)if(index>=f.offset&&index<f.offset+f.data.length)return [f.data,index-f.offset];
    throw Error('Unknown parameter');
  };
  const expected=selections.map(index=>{const [array,k]=access(index),original=array[k],eps=.001;
    array[k]=original+eps;const hi=loss(student),xhi=array[k];array[k]=original-eps;const lo=loss(student),xlo=array[k];array[k]=original;return (hi-lo)/(xhi-xlo);});
  report.phase='native-gradients';await publish();
  await withKaminosGpu(async ctx=>{
    report.adapter=ctx.adapterInfo;
    let gpu=null,teacher=null;
    try{
      gpu=await createNeumipTraining(ctx.device,student,{batchSize:rows.length,trainingRecipe:'legacy-unsmoothed-v1'});gpu.setQueries(new Float32Array(rows.flat()));gpu.setTargets(targets);
      const actual=await gpu.gradients();near([...actual.rgb],reference(student,rows),'student forward');
      const gradients=selections.map(i=>actual.values[i]);near(gradients,expected,'finite-difference gradients',{absolute:2e-6,relative:.015});
      assert.ok(Math.abs(actual.values[layout.networks.offset_network.layers[3].biasesOffset])>1e-7,'depth path must carry a nonzero appearance gradient');
      near([actual.loss*rows.length],[loss(student)],'loss');
      report.gradients={indices:selections,actual:gradients,expected,loss:actual.loss};
      const corrupted=gradients.map(()=>0);assert.throws(()=>near(corrupted,expected,'missing gradients',{absolute:2e-6,relative:.015}),/missing gradients/);
      report.zeroGradientFaultRejected=true;
      // Exercise the exact public author checkpoint as well as the small fixture.
      report.phase='author-conformance';await publish();
      const authorRows=[...rows,[1.23,-.1,.73,.12,-.4,.51,3.4,0],[.01,.99,-.2,.8,.8,-.1,7.8,0]];
      teacher=await createNeumipTraining(ctx.device,author,{batchSize:authorRows.length});teacher.setQueries(new Float32Array(authorRows.flat()));
      const authorActual=await teacher.teach();near([...authorActual],reference(author,authorRows),'author checkpoint',{absolute:2e-4,relative:3e-3});
      report.authorConformance={actual:[...authorActual],expected:reference(author,authorRows)};
      const inferred=await gpu.evaluate();assert.equal('loss' in inferred,false,'inference must not expose stale training loss');
      gpu.setQueries(new Float32Array(rows.flat()));
      await assert.rejects(gpu.gradients(),/targets.*current quer/i);
      gpu.setTargets(targets);report.staleTargetsRejected=true;report.inferenceHasNoStaleLoss=true;
      const before=actual.loss;
      const encoder=ctx.device.createCommandEncoder();gpu.encodeUpdate(encoder,{lrWeights:.0001,lrFields:.0001});ctx.device.queue.submit([encoder.finish()]);await ctx.device.queue.onSubmittedWorkDone();
      const fitted=await gpu.exportModel(),after=loss(fitted)/rows.length;assert.ok(after<before,`optimizer must decrease fixture loss: ${before} -> ${after}`);
      report.update={before,after};
      if(process.env.NEUMIP_LARGE_OPTIMIZER_FIXTURE==='1'){
        report.phase='large-optimizer-tail';await publish();
        const big=createNeumipStudent({resolution:512,seed:37});
        for(const field of [big.offset,...big.mips])field.data.fill(.05);
        for(const layer of big.layers){layer.weights.fill(.025);layer.biases.fill(.02);}
        const large=await createNeumipTraining(ctx.device,big,{batchSize:1,trainingRecipe:'legacy-unsmoothed-v1'});
        try{
          large.setQueries(new Float32Array([.6,.6,0,0,0,0,8,0]));large.setTargets(new Float32Array([.1,.2,.3]));
          const grad=await large.gradients(),tail=large.layout.count-1,g=grad.values[tail];
          assert.ok(Math.abs(g)>1e-7,'coarsest field tail needs a nonzero gradient');
          const before=big.mips.at(-1).data.at(-1),lr=.0001,expected=before-lr*g/(Math.abs(g)+1e-8);
          ctx.device.pushErrorScope('validation');
          const encoder=ctx.device.createCommandEncoder();large.encodeUpdate(encoder,{lrWeights:lr,lrFields:lr});ctx.device.queue.submit([encoder.finish()]);
          const validation=await ctx.device.popErrorScope();assert.equal(validation,null,validation?.message);await ctx.device.queue.onSubmittedWorkDone();
          const fitted=await large.exportModel(),after=fitted.mips.at(-1).data.at(-1);near([after],[expected],'large optimizer tail',{absolute:2e-7,relative:1e-6});
          report.largeOptimizer={parameters:large.layout.count,index:tail,gradient:g,before,after,expected};
        }finally{large.dispose();}
      }
    }finally{gpu?.dispose();teacher?.dispose();}
  },{onEvidence:e=>report.evidence=e});
  report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.error=error.stack;process.exitCode=1;}
finally{await publish();console.log(JSON.stringify(report));}
