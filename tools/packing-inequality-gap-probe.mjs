// Counterfactual intercept-only diagnostic. Does not modify the geometry evaluator.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {evaluateAuthoredPackingExactResidualState} from '../authored-packing-sweep-core.mjs';
const [input,output,python]=process.argv.slice(2);
if(!input||!output||!python) throw new Error('usage: INPUT_DIR OUTPUT_JSON PYTHON');
let phase='read-source';
try{
  const bytes=await fs.readFile(path.join(input,'candidate.json'));
  const previous=JSON.parse(bytes),problem=JSON.parse(await fs.readFile(path.join(input,'problem.json'),'utf8'));
  const subproblem=structuredClone(previous.subproblem),changes=[];
  previous.start.rows.forEach((row,i)=>{
    if(row.signedGap>0&&row.maximumPenetration>0){
      changes.push({key:row.key,before:subproblem.gaps[i],after:-row.maximumPenetration});
      subproblem.gaps[i]=-row.maximumPenetration;
    }
  });
  if(!changes.length) throw new Error('no sign-inconsistent contact rows in source');
  phase='solve-modified-intercepts';
  const solver=await new Promise((resolve,reject)=>{
    const c=spawn(python,[fileURLToPath(new URL('./packing-inequality-subproblem.py',import.meta.url))]);
    let out='',err=''; c.stdout.on('data',x=>out+=x);c.stderr.on('data',x=>err+=x);c.on('error',reject);
    c.stdin.on('error',reject);c.on('close',code=>{try{if(code!==0)throw new Error(err+out);resolve(JSON.parse(out));}catch(e){reject(e);}});
    c.stdin.end(JSON.stringify(subproblem));
  });
  phase='evaluate-unchanged-nonlinear-geometry';
  if(solver.status!=='solved') throw new Error(JSON.stringify(solver));
  const vector=previous.start.vector.map((x,i)=>x+solver.direction[i]);
  const state=evaluateAuthoredPackingExactResidualState({problem,vector});
  const regressions=problem.constraintFamilyMetricKeys.filter(k=>state.metrics[k]>previous.start.metrics[k]+1e-12);
  await fs.writeFile(output,JSON.stringify({status:'diagnostic-completed',claim:'intercept-only counterfactual, not a general gap repair or production solver',sourceSha256:createHash('sha256').update(bytes).digest('hex'),changes,subproblem,solver,start:previous.start.metrics,regressions,state},null,2)+'\n');
  console.log(JSON.stringify({changes,regressions,metrics:state.metrics}));
}catch(error){await fs.writeFile(output,JSON.stringify({status:'failed',phase,error:error.stack})+'\n');process.exitCode=1;console.error(error);}
