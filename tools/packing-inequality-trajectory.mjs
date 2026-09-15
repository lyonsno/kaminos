import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import * as authored from '../authored-packing-sweep-core.mjs';
import {solvePackingInequalityStep} from '../packing-inequality-step.mjs';

const [outputArg,python,variant,stepsArg]=process.argv.slice(2);
if(!outputArg) throw new Error('OUTPUT_DIR required');
const output=path.resolve(outputArg),runId=randomUUID(),started=new Date().toISOString();
await fs.mkdir(output,{recursive:true});
const artifacts={};
const hash=x=>createHash('sha256').update(x).digest('hex');
const save=async(name,value)=>{
  const bytes=JSON.stringify(value,null,2)+'\n',target=path.join(output,name),tmp=target+`.${runId}.tmp`;
  await fs.writeFile(tmp,bytes); await fs.rename(tmp,target); artifacts[name]=hash(bytes);
};
let phase='validate-invocation',lastTrustworthyEvidence=null;
try{
  await save('result.json',{status:'running',runId,started});
  const steps=Number(stepsArg);
  if(!['mild','severe'].includes(variant)) throw new Error('variant must be mild or severe');
  if(!python||!Number.isSafeInteger(steps)||steps<1) throw new Error('explicit positive step budget and Python executable required');
  phase='construct-problem';
  const manifestBytes=await fs.readFile(new URL('../fixtures/authored-packing/packing-fixture-v001.json',import.meta.url),'utf8');
  const manifest=JSON.parse(manifestBytes);
  const authorityProfile=authored.createAuthoredPackingAuthorityProfile({manifest,observedVariantId:manifest.variants[variant].id,intentVariantId:manifest.variants.clean.id,policy:'restoration-to-reference'});
  const bridge=authored.createAuthoredPackingRingCageBridge({manifest,authorityProfile});
  const expectedParent=authored.createAuthoredPackingRealizationOriginParentEnvelope({bridge});
  const problem=authored.createAuthoredPackingExactResidualProblem({manifest,authorityProfile,bridge,expectedParent,initialCarrier:bridge.solverCarrier});
  await save('problem.json',problem);
  const originalConfig=authored.createAuthoredPackingExactResidualStepConfig();
  const config={radius:originalConfig.trustRegionRadii[0],finiteDifferenceStep:originalConfig.finiteDifferenceStep,translationBounds:originalConfig.translationBounds,backtrackingScales:originalConfig.trustRegionRadii.map(r=>r/originalConfig.trustRegionRadii[0]),python};
  const route='experimental-source-gap-authored-inequality-trajectory';
  const sourceFiles={};
  for(const file of ['authored-packing-sweep-core.mjs','packing-inequality-step.mjs','tools/packing-inequality-subproblem.py','tools/packing-inequality-trajectory.mjs']) sourceFiles[file]=hash(await fs.readFile(new URL('../'+file,import.meta.url)));
  const provenance={runId,started,variant,requestedRoute:route,effectiveRoute:route,sourceFiles,manifestSha256:hash(manifestBytes),problemSha256:problem.identity.sha256,requestedSteps:steps,config,initialization:'canonical restoration-to-reference bridge; zero sine coefficients, not unmodified authored mesh',objective:'minimize pairwise overlap; do not worsen skeletal/compartment/endpoint/admitted-volume residuals'};
  await save('provenance.json',provenance);
  let state=authored.evaluateAuthoredPackingExactResidualState({problem,vector:Array(problem.variables.length).fill(0)});
  const start=state,history=[];
  await save('start.json',start); lastTrustworthyEvidence='start.json';
  let termination='step-budget-exhausted',evaluationCount=1;
  for(let index=0;index<steps;index++){
    if(state.metrics.pairwisePenetration===0){termination=state.metrics.skeletalPenetration===0?'contact-residuals-zero':'pair-objective-zero-with-bone-residual';break;}
    phase=`step-${index+1}`;
    const result=await solvePackingInequalityStep({problem,startVector:state.vector,stateEvaluator:authored.evaluateAuthoredPackingExactResidualState,config});
    const file=`step-${String(index+1).padStart(3,'0')}.json`;
    await save(file,result); lastTrustworthyEvidence=file;
    state=result.selected; evaluationCount+=result.evaluationCount;
    const row={step:index+1,status:result.status,metrics:state.metrics,evaluationCount:result.evaluationCount,selectedScale:result.candidates.find(c=>JSON.stringify(c.vector)===JSON.stringify(state.vector))?.scale??null};
    history.push(row); console.log(JSON.stringify(row));
    if(result.status!=='improved'){termination=result.status;break;}
  }
  if(state.metrics.pairwisePenetration===0) termination=state.metrics.skeletalPenetration===0?'contact-residuals-zero':'pair-objective-zero-with-bone-residual';
  await save('selected.json',state); lastTrustworthyEvidence='selected.json';
  const displacement=state.carrier.cages.map((c,ci)=>({constructionId:c.constructionId,maximumNodeDisplacement:Math.max(...c.manifest.nodes.map((n,i)=>Math.hypot(...n.currentPosition.map((x,j)=>x-start.carrier.cages[ci].manifest.nodes[i].currentPosition[j]))))}));
  delete artifacts['result.json'];
  await save('result.json',{status:'experiment-completed',runId,started,finished:new Date().toISOString(),provenance,termination,attemptedSteps:history.length,acceptedSteps:history.filter(s=>s.status==='improved').length,evaluationCount,start:start.metrics,selected:state.metrics,displacement,history,artifacts:{...artifacts}});
}catch(error){
  const failure={status:'failed',runId,started,phase,lastTrustworthyEvidence,artifacts:{...artifacts},error:error.stack};
  await save('failure.json',failure);await save('result.json',failure);console.error(error);process.exitCode=1;
}
