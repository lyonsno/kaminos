// Isolated experiment: the existing geometry evaluator retains acceptance authority.
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const families = ['pairwisePenetration','skeletalPenetration','compartmentEscape','endpointDrift','maximumRelativeVolumeError'];
function runSubproblem(python, input) {
  return new Promise((resolve,reject)=>{
    const child=spawn(python,[fileURLToPath(new URL('./tools/packing-inequality-subproblem.py',import.meta.url))],{stdio:['pipe','pipe','pipe']});
    let stdout='',stderr='';
    child.stdout.on('data',x=>{stdout+=x;}); child.stderr.on('data',x=>{stderr+=x;});
    child.on('error',reject); child.stdin.on('error',reject);
    child.on('close',code=>{
      if(code!==0) return reject(new Error(`subproblem exit ${code}: ${stderr}\n${stdout}`));
      try { resolve({...JSON.parse(stdout),stderr}); } catch(error) {reject(error);}
    });
    child.stdin.end(JSON.stringify(input));
  });
}

export async function solvePackingInequalityStep({problem,startVector,stateEvaluator,config}) {
  const {radius,finiteDifferenceStep:h,translationBounds:bounds,backtrackingScales,python}=config;
  const n=startVector.length;
  if(!python || !(radius>0) || !(h>0) || !Number.isFinite(radius+h) || n!==problem.variables.length
    || !startVector.every(x=>Number.isFinite(x)&&x>=bounds[0]&&x<=bounds[1])
    || !backtrackingScales?.length || !backtrackingScales.every(x=>Number.isFinite(x)&&x>0&&x<=1)) throw new Error('invalid experimental step configuration');
  let evaluationCount=0,expectedRows=null;
  const evaluate=vector=>{
    const state=stateEvaluator({problem,vector}); evaluationCount++;
    if(!families.every(k=>Number.isFinite(state.metrics[k])) || !state.rows.every(r=>Number.isFinite(r.signedGap))) throw new Error('nonfinite evaluator output');
    if(families.some(k=>state.metrics[k]<0)) throw new Error('invalid physical metric: negative residual');
    const identities=state.rows.map(r=>`${r.kind}:${r.key}`).sort();
    if(new Set(identities).size!==identities.length || (expectedRows!==null&&JSON.stringify(identities)!==JSON.stringify(expectedRows))) throw new Error('contact row identity changed');
    expectedRows??=identities;
    return {...state,vector:[...vector]};
  };
  const start=evaluate(startVector);
  const metricGuards=['compartmentEscape','endpointDrift','maximumRelativeVolumeError'];
  const useRawVolume=Number.isFinite(problem.admission?.maximumRelativeVolumeError)&&Number.isFinite(start.metrics.rawMaximumRelativeVolumeError);
  const values=state=>{
    const byKey=new Map(state.rows.map(r=>[r.key,r]));
    if(byKey.size!==start.rows.length) throw new Error('contact row identity changed');
    return [...start.rows.map(r=>{
      const row=byKey.get(r.key);
      if(!row || row.kind!==r.kind) throw new Error('contact row identity changed');
      return row.signedGap+(r.kind==='skeletal-clearance'?start.metrics.skeletalPenetration:0);
    }),...metricGuards.map(k=>k==='maximumRelativeVolumeError'&&useRawVolume
      ? problem.admission.maximumRelativeVolumeError-state.metrics.rawMaximumRelativeVolumeError
      : start.metrics[k]-state.metrics[k])];
  };
  const gaps=values(start),jacobian=gaps.map(()=>Array(n).fill(0));
  for(let j=0;j<n;j++){
    const plus=[...startVector],minus=[...startVector];
    plus[j]=Math.min(bounds[1],plus[j]+h); minus[j]=Math.max(bounds[0],minus[j]-h);
    const span=plus[j]-minus[j]; if(!(span>0)) throw new Error('zero finite difference span');
    const vp=values(evaluate(plus)),vm=values(evaluate(minus));
    for(let i=0;i<gaps.length;i++) jacobian[i][j]=(vp[i]-vm[i])/span;
  }
  const subproblem={gaps,jacobian,pair:[...start.rows.map(r=>r.kind==='pairwise-clearance'?1:0),...metricGuards.map(()=>0)],radius,bounds:startVector.map(x=>[bounds[0]-x,bounds[1]-x])};
  if(!subproblem.pair.includes(1)) throw new Error('experiment requires pairwise rows');
  const solver=await runSubproblem(python,subproblem);
  const candidates=[]; let selected=start;
  if(solver.status==='solved') {
    if(solver.direction?.length!==n || !solver.direction.every(Number.isFinite) || Math.hypot(...solver.direction)>radius+1e-8) throw new Error('invalid subproblem direction');
    for(const scale of backtrackingScales){
      const vector=startVector.map((x,j)=>x+scale*solver.direction[j]);
      if(!vector.every(x=>x>=bounds[0]-1e-10&&x<=bounds[1]+1e-10)) throw new Error('subproblem violates parameter bounds');
      const state=evaluate(vector);
      const regressions=families.filter(k=>state.metrics[k]>start.metrics[k]+1e-12);
      const improves=state.metrics.pairwisePenetration<start.metrics.pairwisePenetration-1e-12;
      candidates.push({scale,vector,metrics:state.metrics,regressions,admissible:!regressions.length,improves});
      if(!regressions.length&&improves&&state.metrics.pairwisePenetration<selected.metrics.pairwisePenetration) selected=state;
    }
  }
  return {schema:'kaminos.experimental-packing-inequality-step.v0',status:solver.status!=='solved'?'subproblem-failed':selected===start?'no-admissible-improvement':'improved',config,start,selected,subproblem,solver,candidates,evaluationCount};
}
