import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import * as authored from '../authored-packing-sweep-core.mjs';
import {hashMuscleCompartmentRingCageCanonicalJson as hashCarrier} from '../muscle-compartment-ring-cage-core.mjs';
import {solveNBodyActiveRowTrustRegionStep} from '../nbody-packing-restoration.mjs';
import {solvePackingInequalityStep} from '../packing-inequality-step.mjs';

const [outputArgument,python,mode='compare']=process.argv.slice(2);
if(!outputArgument) throw new Error('OUTPUT_DIR required');
const output=path.resolve(outputArgument);
await fs.mkdir(output,{recursive:true});
let phase='validate-invocation';
const runId=randomUUID();
const save=async(name,value)=>{const target=path.join(output,name),tmp=target+`.${runId}.tmp`;await fs.writeFile(tmp,JSON.stringify(value,null,2)+'\n');await fs.rename(tmp,target);};
const started=new Date().toISOString();
try {
  await save('result.json',{status:'running',runId,started});
  if(!python || !['compare','prepare'].includes(mode)) throw new Error('usage: node tools/packing-inequality-comparison.mjs OUTPUT_DIR PYTHON [compare|prepare]');
  phase='load-source';
  const htmlPath=new URL('../artifacts/authored-packing-exact-repeated-convergence-v0/index.html',import.meta.url);
  const html=await fs.readFile(htmlPath,'utf8');
  const line=html.split('\n').find(x=>/const payload\s*=/.test(x));
  if(!line) throw new Error('missing saved trajectory payload');
  const payload=JSON.parse(line.replace(/^.*?const payload\s*=\s*/,'').replace(/;\s*$/,''));
  const saved=payload.arms[0];
  const manifest=JSON.parse(await fs.readFile(new URL('../fixtures/authored-packing/packing-fixture-v001.json',import.meta.url),'utf8'));
  const authorityProfile=authored.createAuthoredPackingAuthorityProfile({manifest,observedVariantId:manifest.variants.mild.id,intentVariantId:manifest.variants.clean.id,policy:'restoration-to-reference'});
  const bridge=authored.createAuthoredPackingRingCageBridge({manifest,authorityProfile});
  const expectedParent=authored.createAuthoredPackingRealizationOriginParentEnvelope({bridge});
  const initialCarrier=structuredClone(bridge.solverCarrier);
  phase='reconstruct-saved-coordinates';
  for(const cage of initialCarrier.cages){
    const source=saved.initialCages.find(c=>c.constructionId===cage.constructionId);
    if(!source || source.positions.length!==cage.manifest.nodes.length) throw new Error('saved cage mismatch');
    const fixed=new Set(cage.manifest.constraints.boundaryMasks.filter(x=>x.fixed).map(x=>x.nodeId));
    cage.manifest.nodes.forEach((node,i)=>{
      if(!source.positions[i]?.every(Number.isFinite)) throw new Error('invalid saved position');
      if(fixed.has(node.id)&&Math.hypot(...node.currentPosition.map((x,j)=>x-source.positions[i][j]))>1e-9) throw new Error('saved fixed endpoint mismatch');
      node.currentPosition=[...source.positions[i]];
    });
  }
  delete initialCarrier.identity;
  initialCarrier.identity={domain:'canonical-json-self-excluding-top-level-identity',sha256:hashCarrier(initialCarrier)};
  phase='construct-problem';
  const problem=authored.createAuthoredPackingExactResidualProblem({manifest,authorityProfile,bridge,expectedParent,initialCarrier:bridge.solverCarrier});
  const startVector=[];
  let maximumReconstructionError=0;
  for(const [ci,cage] of bridge.solverCarrier.cages.entries()) {
    const indices=cage.manifest.nodes.map(node=>Number(/:section:(\d{4}):/.exec(node.id)[1]));
    const last=Math.max(...indices), weights=indices.map(i=>Math.sin(Math.PI*i/last));
    const denominator=weights.reduce((s,w)=>s+w*w,0);
    const coefficients=[0,1,2].map(j=>weights.reduce((s,w,i)=>s+w*(initialCarrier.cages[ci].manifest.nodes[i].currentPosition[j]-cage.manifest.nodes[i].currentPosition[j]),0)/denominator);
    startVector.push(...coefficients);
    cage.manifest.nodes.forEach((node,i)=>{
      maximumReconstructionError=Math.max(maximumReconstructionError,Math.hypot(...node.currentPosition.map((x,j)=>x+weights[i]*coefficients[j]-initialCarrier.cages[ci].manifest.nodes[i].currentPosition[j])));
    });
  }
  if(maximumReconstructionError>1e-8) throw new Error(`saved state not representable in original basis: ${maximumReconstructionError}`);
  const baselineConfig=authored.createAuthoredPackingExactResidualStepConfig();
  const candidateConfig={radius:baselineConfig.trustRegionRadii[0],finiteDifferenceStep:baselineConfig.finiteDifferenceStep,translationBounds:baselineConfig.translationBounds,backtrackingScales:baselineConfig.trustRegionRadii.map(r=>r/baselineConfig.trustRegionRadii[0]),python};
  const provenance={started,route:'experimental-same-state-inequality-comparison',sourceHtml:path.resolve(htmlPath.pathname),sourceHtmlSha256:createHash('sha256').update(html).digest('hex'),historicalInitialCarrierSha256:saved.identity.initialCarrierSha256,reconstructedCarrierSha256:initialCarrier.identity.sha256,startVector,maximumReconstructionError,note:'Recovered saved late-state coordinates as sine-basis coefficients relative to canonical original bridge. Both algorithms use the unchanged canonical problem and original volume allowance. Reconstruction and residual errors checked explicitly; no historical metadata identity asserted.',baselineConfig,candidateConfig};
  await save('provenance.json',provenance); await save('problem.json',problem);
  phase='validate-reconstructed-state';
  const start=authored.evaluateAuthoredPackingExactResidualState({problem,vector:startVector});
  await save('start.json',start);
  const historical=saved.exact.initial.summary;
  if(Math.abs(start.metrics.pairwisePenetration-historical.admittedMaximumPairwisePenetration)>1e-9 || Math.abs(start.metrics.skeletalPenetration-historical.admittedMaximumSkeletalPenetration)>1e-9) throw new Error('reconstructed residuals mismatch saved state');
  console.log(JSON.stringify({phase,metrics:start.metrics}));
  if(mode==='prepare') {await save('result.json',{status:'prepared-only',runId,provenance,metrics:start.metrics});}
  else {
    phase='baseline-step';
    const baseline=solveNBodyActiveRowTrustRegionStep({problem,startVector,requestedConfig:baselineConfig,stateEvaluator:authored.evaluateAuthoredPackingExactResidualState});
    await save('baseline.json',baseline);
    const baselineState=authored.evaluateAuthoredPackingExactResidualState({problem,vector:baseline.selected.vector});
    await save('baseline-state.json',baselineState);
    console.log(JSON.stringify({phase,metrics:baseline.selected.metrics}));
    phase='inequality-step';
    const candidate=await solvePackingInequalityStep({problem,startVector,stateEvaluator:authored.evaluateAuthoredPackingExactResidualState,config:candidateConfig});
    await save('candidate.json',candidate);
    function displacement(state){return state.carrier.cages.map((c,ci)=>({constructionId:c.constructionId,maximumNodeDisplacement:Math.max(...c.manifest.nodes.map((node,i)=>Math.hypot(...node.currentPosition.map((x,j)=>x-start.carrier.cages[ci].manifest.nodes[i].currentPosition[j]))))}));}
    const artifacts={};
    for(const name of ['problem.json','provenance.json','start.json','baseline.json','baseline-state.json','candidate.json']) artifacts[name]=createHash('sha256').update(await fs.readFile(path.join(output,name))).digest('hex');
    const result={status:'comparison-completed',runId,artifacts,provenance,finished:new Date().toISOString(),start:start.metrics,baseline:{status:baseline.status,metrics:baseline.selected.metrics,displacement:displacement(baselineState),evaluationCount:baseline.work.evaluationCount},candidate:{status:candidate.status,metrics:candidate.selected.metrics,displacement:displacement(candidate.selected),evaluationCount:candidate.evaluationCount,solver:candidate.solver}};
    await save('result.json',result); console.log(JSON.stringify(result));
  }
} catch(error) {
  const failure={status:'failed',runId,phase,started,error:error.stack};
  await save('failure.json',failure); await save('result.json',failure);
  console.error(error); process.exitCode=1;
}
