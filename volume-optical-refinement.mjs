import {composeTransfers,integrateProbes,estimateProbeError} from './volume-optical-trace.mjs';

const difference=(a,b)=>a.map((v,i)=>Math.abs(v-b[i]));
const identity=()=>[0,0,0,1];
const nonnegativeFour=v=>Array.isArray(v)&&v.length===4&&[0,1,2,3].every(i=>Number.isFinite(v[i])&&v[i]>=0);

// Offline saved-weight evaluation. Float32 layer boundaries, double dot-product
// accumulation: requires comparison with MLX, not claimed bit-identical to it.
export function frozenOpticalPredictor(artifact) {
  const model=structuredClone(artifact),n=model.probeCount,width=9*n+8;
  const conditioned=model.identity==='optical-error-mlp-v1'&&model.conditioning==='source-max-abs-v1';
  const raw=model.identity==='optical-error-mlp-v0'&&model.conditioning===undefined;
  const finiteVector=(v,size)=>Array.isArray(v)&&v.length===size&&Array.from(v).every(Number.isFinite);
  if((!raw&&!conditioned)||![3,5].includes(n)||
    JSON.stringify(model.architecture)!==JSON.stringify([width,32,32,4])||
    JSON.stringify(model.activations)!==JSON.stringify(['relu','relu','softplus'])||
    !finiteVector(model.mean,width)||!finiteVector(model.scale,width)||!model.scale.every(v=>v>0)||
    !finiteVector(model.targetScale,4)||!model.targetScale.every(v=>v>0)||model.layers?.length!==3) {
    throw new Error('invalid frozen optical model');
  }
  model.layers.forEach((layer,i)=>{
    const input=model.architecture[i],output=model.architecture[i+1];
    if(!finiteVector(layer.bias,output)||!Array.isArray(layer.weights)||layer.weights.length!==output||
      !Array.from(layer.weights).every(row=>finiteVector(row,input)))throw new Error('invalid frozen layer');
  });
  return features=>{
    if(!finiteVector(features,width))throw new Error('invalid optical features');
    let x=features.map(Math.fround),sourceScale=1;
    if(!x.every(Number.isFinite))throw new Error('nonfinite float32 optical features');
    if(conditioned) {
      let amplitude=0;
      for(let j=0;j<n;j++)for(let k=1;k<=6;k++)amplitude=Math.max(amplitude,Math.abs(x[9*j+k]));
      // No observed emission does not prove that the interval is source-free.
      sourceScale=amplitude===0?1:amplitude;
      for(let j=0;j<n;j++)for(let k=1;k<=6;k++)x[9*j+k]=Math.fround(x[9*j+k]/sourceScale);
    }
    x=x.map((v,i)=>Math.fround(Math.fround(v-model.mean[i])/model.scale[i]));
    model.layers.forEach((layer,i)=>{
      x=layer.weights.map((weights,j)=>{
        let sum=0;for(let k=0;k<weights.length;k++)sum+=weights[k]*x[k];
        const z=Math.fround(Math.fround(sum)+layer.bias[j]);
        return i<2?Math.max(0,z):Math.fround(Math.max(z,0)+Math.log1p(Math.exp(-Math.abs(z))));
      });
    });
    const result=x.map((v,i)=>Math.fround(Math.fround(v*model.targetScale[i])*(i<3?sourceScale:1)));
    if(!nonnegativeFour(result))throw new Error('nonfinite frozen optical prediction');
    return result;
  };
}

// All indices refer to retained, evenly spaced observations. No synthesized teacher probes.
export function buildOpticalHierarchy(probes,{length,rootSpan,probeCount}) {
  if(![3,5].includes(probeCount))throw new Error('three or five probes required');
  if(!(Number.isFinite(length)&&length>0))throw new Error('positive finite ray length required');
  const intervals=probes.length-1,minSpan=2*(probeCount-1);
  if(!Number.isSafeInteger(rootSpan)||rootSpan<minSpan||!Number.isInteger(Math.log2(rootSpan))) {
    throw new Error('root span must be a power of two with independently finer teacher panels');
  }
  if(intervals<minSpan||intervals%minSpan!==0)throw new Error('trace must cover complete finest candidate intervals');
  const spacing=length/intervals;
  const node=(start,span)=>{
    const end=start+span,h=spacing*span;
    const indices=Array.from({length:probeCount},(_,i)=>start+i*span/(probeCount-1));
    const observed=indices.map(i=>probes[i]);
    const estimate=estimateProbeError(observed,h);
    const dense=probes.slice(start,end+1);
    const teacher=integrateProbes(dense,h);
    const coarserTeacher=integrateProbes(dense.filter((_,i)=>i%2===0),h);
    return {start,end,h,indices,probes:observed,candidate:estimate.fine,
      numericalError:estimate.error,teacher,teacherError:difference(estimate.fine,teacher),
      teacherDisagreement:difference(teacher,coarserTeacher),
      children:span>minSpan?[node(start,span/2),node(start+span/2,span/2)]:[]};
  };
  const roots=[];
  for(let start=0;start<intervals;) {
    const span=2**Math.floor(Math.log2(Math.min(rootSpan,intervals-start)));
    roots.push(node(start,span));start+=span;
  }
  return {identity:'retained-optical-hierarchy-v0',probeCount,spacing,length,rootSpan,minSpan,roots,
    teacher:roots.reduce((t,n)=>composeTransfers(t,n.teacher),identity())};
}

export function refineOpticalHierarchy(hierarchy,{policy,tolerances,calibration=[1,1,1,1],predictError}) {
  if(!['numerical','teacher-informed','predicted'].includes(policy))throw new Error('unknown refinement policy');
  if(!nonnegativeFour(tolerances)||!nonnegativeFour(calibration))throw new Error('four finite nonnegative tolerances/calibration values required');
  if(policy==='predicted'&&typeof predictError!=='function')throw new Error('prediction function required');
  let transfer=identity(),unresolvedLeafCount=0,unresolvedReferenceCount=0;
  const seen=new Set(),accepted=[];
  const visit=node=>{
    node.indices.forEach(i=>seen.add(i));
    // The prediction callback receives observations, never refined labels or a suffix teacher.
    const error=policy==='predicted'?predictError({probes:node.probes,h:node.h,start:node.start}):
      policy==='teacher-informed'?node.teacherError:node.numericalError.map((v,i)=>v*calibration[i]);
    if(!nonnegativeFour(error))throw new Error('invalid error prediction');
    const incoming=transfer[3];
    const needsRefinement=error.some((v,i)=>incoming*v>tolerances[i]);
    if(needsRefinement&&node.children.length) {node.children.forEach(visit);return;}
    if(needsRefinement)unresolvedLeafCount++;
    const referenceUnresolved=node.teacherDisagreement.some((v,i)=>incoming*v>tolerances[i]);
    if(referenceUnresolved)unresolvedReferenceCount++;
    accepted.push({start:node.start,end:node.end,h:node.h,incoming,error:[...error],
      referenceDisagreement:[...node.teacherDisagreement],referenceUnresolved,needsRefinement});
    transfer=composeTransfers(transfer,node.candidate);
  };
  hierarchy.roots.forEach(visit);
  return {identity:'optical-refinement-replay-v0',policy,tolerances:[...tolerances],calibration:[...calibration],
    toleranceSemantics:'per-segment absolute E_RGB/T disagreement weighted by incoming transmission; not a global bound',
    teacherAuthority:'finite retained trace; successive disagreement is not a convergence certificate',
    transfer,error:difference(transfer,hierarchy.teacher),uniqueProbeCount:seen.size,
    observedIndices:[...seen].sort((a,b)=>a-b),accepted,unresolvedLeafCount,unresolvedReferenceCount};
}
