// kaminos-test: manual — native directional forward/backward and author checkpoint.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
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
  const bytes=await fs.readFile(authorPath);report.authorSha256=createHash('sha256').update(bytes).digest('hex');
  const author=readNeumipModel(bytes),student=createNeumipStudent({resolution:4,seed:37});
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
      gpu=await createNeumipTraining(ctx.device,student,{batchSize:rows.length});gpu.setQueries(new Float32Array(rows.flat()));gpu.setTargets(targets);
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
      const before=actual.loss;
      const encoder=ctx.device.createCommandEncoder();gpu.encodeUpdate(encoder,{lrWeights:.0001,lrFields:.0001});ctx.device.queue.submit([encoder.finish()]);await ctx.device.queue.onSubmittedWorkDone();
      const fitted=await gpu.exportModel(),after=loss(fitted)/rows.length;assert.ok(after<before,`optimizer must decrease fixture loss: ${before} -> ${after}`);
      report.update={before,after};
    }finally{gpu?.dispose();teacher?.dispose();}
  },{onEvidence:e=>report.evidence=e});
  report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.error=error.stack;process.exitCode=1;}
finally{await publish();console.log(JSON.stringify(report));}
