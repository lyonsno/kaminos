// kaminos-test: manual — explicit author model and persistent output path; native GPU.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readNeumipModel} from '../neumip-model.mjs';
import {buildNeumipWGSL} from '../neumip-shader.mjs';
import {withKaminosGpu,evalWgslBatch} from './shader-herder.mjs';
const [file,out]=process.argv.slice(2);if(!file||!out)throw Error('Author model path and output directory required');
await fs.mkdir(out,{recursive:true});const report={status:'running',phase:'source',file,repoRoot:process.cwd(),route:'native WebGPU production neural functions'};
const publish=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await publish();
// Independent scalar evaluation follows author-export matrix rows and activations.
function cpu(model,prefix,input){let a=input;for(let k=0;k<4;k++){const l=model.layers.find(x=>x.name===`${prefix}.mpl${k}`);a=Array.from({length:l.output},(_,j)=>{let n=l.biases[j]??0;for(let i=0;i<l.input;i++)n+=l.weights[j*l.input+i]*a[i];return l.relu?Math.max(0,n):n;});}return a;}
function rgb(v){const c=[v[0]+1.13983*v[2],v[0]-.39465*v[1]-.58060*v[2],v[0]+2.03211*v[1]];return c.map((n,i)=>(Math.exp(n)-1)*(.1+1/(1+Math.exp(-v[i+3]))));}
function near(actual,expected){assert.equal(actual.length,expected.length);for(let i=0;i<actual.length;i++)for(let j=0;j<expected[i].length;j++)assert.ok(Math.abs(actual[i][j]-expected[i][j])<1e-4+Math.abs(expected[i][j])*2e-4,`NeuMIP oracle mismatch ${i}/${j}: ${actual[i][j]} vs ${expected[i][j]}`);}
try{
 const bytes=await fs.readFile(file),model=readNeumipModel(bytes);report.sha256=createHash('sha256').update(bytes).digest('hex');report.bytes=bytes.length;
 const shader=buildNeumipWGSL(model),inputs=[[.1,.2,-.1,-.3],[-.2,.4,.3,-.1],[.01,-.2,.1,.2]];
 const f0=[.11,-.12,.13,.14],f1=[.15,.16,-.17,.18];
 const expected=inputs.map(([vx,vy,lx,ly])=>rgb(cpu(model,'main',[lx,ly,vx,vy,...f0,...f1])));
 const expectedOffset=inputs.map(([vx,vy])=>[cpu(model,'offset_network',[...f0,...f1.slice(0,2),vx,vy])[0]]);
 report.phase='shader-execution';await publish();
 await withKaminosGpu(async ctx=>{
  report.adapter=ctx.adapterInfo;
  const args={argTypes:['f32','f32','f32','f32'],inputs};
  const body='return neumipMain(vec4<f32>(0.11,-0.12,0.13,0.14),vec4<f32>(0.15,0.16,-0.17,0.18),vec2<f32>(arg0,arg1),vec2<f32>(arg2,arg3));';
  const actual=await evalWgslBatch(ctx,{...args,preamble:shader.main,returnType:'vec3<f32>',body});near(actual,expected);
  const offsets=await evalWgslBatch(ctx,{...args,preamble:shader.offset,returnType:'f32',body:'return neumipOffset(vec4<f32>(0.11,-0.12,0.13,0.14),vec4<f32>(0.15,0.16,0.0,0.0),vec2<f32>(arg0,arg1));'});
  near(offsets.map(x=>[x]),expectedOffset);
  const fault={...model,layers:model.layers.map(l=>({...l,biases:l.biases.slice()}))};fault.layers.find(l=>l.name==='main.mpl3').biases[0]+=1;
  const bad=await evalWgslBatch(ctx,{...args,preamble:buildNeumipWGSL(fault).main,returnType:'vec3<f32>',body});assert.throws(()=>near(bad,expected),/oracle mismatch/);
  report.numerics={actual,expected,offsets,expectedOffset,validShaderFaultRejected:true};
 },{onEvidence:e=>report.evidence=e});
 report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.error=error.stack;process.exitCode=1;}finally{await publish();console.log(JSON.stringify(report));}
