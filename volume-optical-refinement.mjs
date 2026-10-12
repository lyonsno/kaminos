import {composeTransfers,constantTransfer,integrateProbes,estimateProbeError} from './volume-optical-trace.mjs';
import {validateOpticalRegion} from './volume-optical-region.mjs';

const difference=(a,b)=>a.map((v,i)=>Math.abs(v-b[i]));
const identity=()=>[0,0,0,1];
const nonnegativeFour=v=>Array.isArray(v)&&v.length===4&&[0,1,2,3].every(i=>Number.isFinite(v[i])&&v[i]>=0);

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

export function refineOpticalHierarchy(hierarchy,{policy,tolerances,calibration=[1,1,1,1],predictError,
  regionBounds,suffixRadianceBound=[0,0,0]}) {
  if(!['numerical','teacher-informed','predicted','regional'].includes(policy))throw new Error('unknown refinement policy');
  if(!nonnegativeFour(tolerances)||!nonnegativeFour(calibration))throw new Error('four finite nonnegative tolerances/calibration values required');
  if(policy==='predicted'&&typeof predictError!=='function')throw new Error('prediction function required');
  if(policy==='regional'&&typeof regionBounds!=='function')throw new Error('region bounds function required');
  if(!Array.isArray(suffixRadianceBound)||suffixRadianceBound.length!==3||
    ![0,1,2].every(i=>Number.isFinite(suffixRadianceBound[i])&&suffixRadianceBound[i]>=0)) {
    throw new Error('three finite nonnegative suffix radiance bounds required');
  }
  let transfer=identity(),unresolvedLeafCount=0,unresolvedReferenceCount=0;
  let metadataQueryCount=0;
  const regionAuthorities=new Set();
  const seen=new Set(),accepted=[];
  const visit=node=>{
    const midpoint=Math.floor(node.indices.length/2);
    const indices=policy==='regional'?[node.indices[midpoint]]:node.indices;
    indices.forEach(i=>seen.add(i));
    let candidate=policy==='regional'?constantTransfer(node.probes[midpoint],node.h):node.candidate;
    let region;
    // The prediction callback receives observations, never refined labels or a suffix teacher.
    let error=policy==='predicted'?predictError({probes:node.probes,h:node.h,start:node.start}):
      policy==='teacher-informed'?node.teacherError:node.numericalError.map((v,i)=>v*calibration[i]);
    if(policy==='regional') {
      // No teacher values enter this callback. Metadata creation/refresh cost
      // is external to this replay and must be charged by a native comparison.
      region=regionBounds({start:node.start,end:node.end,h:node.h});
      metadataQueryCount++;
      error=validateOpticalRegion(region,{...node,probes:[node.probes[midpoint]]});
      regionAuthorities.add(region.authority);
    }
    if(!nonnegativeFour(error))throw new Error('invalid error prediction');
    const incoming=transfer[3];
    const weightedError=error.map((v,i)=>incoming*(v+(i<3?error[3]*suffixRadianceBound[i]:0)));
    const needsRefinement=weightedError.some((v,i)=>v>tolerances[i]);
    if(needsRefinement&&node.children.length) {node.children.forEach(visit);return;}
    if(needsRefinement) {
      unresolvedLeafCount++;
      // At the retained hierarchy's floor use all available candidate probes,
      // rather than silently accepting a midpoint that can miss the sheet.
      if(policy==='regional') {
        node.indices.forEach(i=>seen.add(i));
        validateOpticalRegion(region,node);
        candidate=node.candidate;
      }
    }
    const referenceUnresolved=node.teacherDisagreement.some((v,i)=>
      incoming*(v+(i<3?node.teacherDisagreement[3]*suffixRadianceBound[i]:0))>tolerances[i]);
    if(referenceUnresolved)unresolvedReferenceCount++;
    accepted.push({start:node.start,end:node.end,h:node.h,incoming,error:[...error],weightedError,
      referenceDisagreement:[...node.teacherDisagreement],referenceUnresolved,needsRefinement});
    transfer=composeTransfers(transfer,candidate);
  };
  hierarchy.roots.forEach(visit);
  return {identity:'optical-refinement-replay-v0',policy,tolerances:[...tolerances],calibration:[...calibration],
    toleranceSemantics:'per-segment E_RGB plus T error times supplied suffix radiance bound, and T error, weighted by incoming transmission; not a global tolerance',
    suffixRadianceBound:[...suffixRadianceBound],metadataQueryCount,regionAuthorities:[...regionAuthorities],
    regionalAuthority:policy==='regional'?'conditional on supplied continuous coefficient envelopes; observations only check contradictions':null,
    costAuthority:'unique retained probes and metadata query counts only; excludes metadata construction, refresh and GPU execution',
    teacherAuthority:'finite retained trace; successive disagreement is not a convergence certificate',
    transfer,error:difference(transfer,hierarchy.teacher),uniqueProbeCount:seen.size,
    observedIndices:[...seen].sort((a,b)=>a-b),accepted,unresolvedLeafCount,unresolvedReferenceCount};
}
