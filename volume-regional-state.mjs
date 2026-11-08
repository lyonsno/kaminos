import {constantTransfer,composeTransfers,integrateProbes,OPTICAL_TRACE_STRIDE} from './volume-optical-trace.mjs';

export const REGIONAL_DATASET_IDENTITY='native-regional-transfer-diagnostic-v0';
const triple=(v,name)=>{
  if(!Array.isArray(v)||v.length!==3||!v.every(Number.isFinite))throw Error(`${name} requires three finite values`);
};
const integer=(v,name,min=1)=>{if(!Number.isSafeInteger(v)||v<min)throw Error(`${name} must be an integer >= ${min}`);};

// A finite assay configuration, not a renderer limit. Every requested region,
// context point and quadrature point is retained in the returned plan.
export function regionalQueryPlan({bounds,tiles,contextSide,queriesPerRegion,subdivisions,seed}) {
  triple(bounds?.lo,'bounds.lo');triple(bounds?.hi,'bounds.hi');triple(tiles,'tiles');
  bounds.lo.forEach((v,i)=>{if(bounds.hi[i]<=v)throw Error('positive regional bounds required');});
  tiles.forEach(v=>integer(v,'tiles'));integer(contextSide,'contextSide',2);
  integer(queriesPerRegion,'queriesPerRegion');integer(subdivisions,'subdivisions',2);
  if(subdivisions%2)throw Error('even subdivisions required for nested convergence comparison');
  integer(seed,'seed',0);
  let randomState=seed>>>0;
  const random=()=>{randomState=(Math.imul(randomState,1664525)+1013904223)>>>0;return randomState/4294967296;};
  const regions=[],points=[],segments=[];
  const extent=bounds.hi.map((v,i)=>v-bounds.lo[i]);
  for(let z=0;z<tiles[2];z++)for(let y=0;y<tiles[1];y++)for(let x=0;x<tiles[0];x++) {
    const index=[x,y,z],lo=index.map((v,i)=>bounds.lo[i]+extent[i]*v/tiles[i]);
    const hi=index.map((v,i)=>bounds.lo[i]+extent[i]*(v+1)/tiles[i]);
    const region={id:regions.length,index,lo,hi,contextOffset:points.length,contextCount:contextSide**3};
    regions.push(region);
    for(let k=0;k<contextSide;k++)for(let j=0;j<contextSide;j++)for(let i=0;i<contextSide;i++) {
      points.push({position:[i,j,k].map((v,a)=>lo[a]+(hi[a]-lo[a])*v/(contextSide-1)),direction:[0,0,1]});
    }
    for(let q=0;q<queriesPerRegion;q++) {
      // Independent boundary faces give oriented oblique intervals. A region's
      // queries include paired reversals so optical ordering is observable.
      let entry,exit;
      if(q%2) {entry=segments.at(-1).exit.slice();exit=segments.at(-1).entry.slice();}
      else {
        const a=Math.floor(random()*3),b=(a+1+Math.floor(random()*2))%3;
        entry=[random(),random(),random()];exit=[random(),random(),random()];
        entry[a]=random()<.5?0:1;exit[b]=random()<.5?0:1;
      }
      const delta=exit.map((v,i)=>(v-entry[i])*(hi[i]-lo[i]));
      const length=Math.hypot(...delta);
      if(length<=0)throw Error('degenerate regional interval');
      const direction=delta.map(v=>v/length),pointOffset=points.length;
      for(let s=0;s<=subdivisions;s++)points.push({
        position:entry.map((v,i)=>lo[i]+(v+(exit[i]-v)*s/subdivisions)*(hi[i]-lo[i])),direction});
      segments.push({id:segments.length,region:region.id,entry,exit,direction,length,pointOffset,pointCount:subdivisions+1});
    }
  }
  return {identity:REGIONAL_DATASET_IDENTITY,bounds,tiles,contextSide,queriesPerRegion,subdivisions,seed,
    regions,segments,points,pointCount:points.length};
}

export function opticalChannels(rows,index) {
  const at=index*OPTICAL_TRACE_STRIDE;
  return [rows[at+16],...rows.subarray(at+17,at+23)];
}

export function regionalDataset(plan,rows) {
  if(!(rows instanceof Float32Array)||rows.length!==plan.pointCount*OPTICAL_TRACE_STRIDE)
    throw Error('partial regional native coefficient population');
  for(let i=0;i<plan.pointCount;i++) {
    const at=i*OPTICAL_TRACE_STRIDE;
    if(rows[at+2]!==1||rows[at+3]!==1)throw Error('missing regional native point');
    for(let k=0;k<OPTICAL_TRACE_STRIDE;k++)if(!Number.isFinite(rows[at+k]))throw Error('nonfinite regional native point');
    if(rows[at+16]<0)throw Error('negative regional extinction');
    for(let k=0;k<3;k++)if(Math.abs(rows[at+8+k]-plan.points[i].position[k])>2e-6)
      throw Error('regional native point position changed');
  }
  const channels=7,contextWidth=plan.contextSide**3*channels;
  const context=new Float32Array(plan.regions.length*contextWidth);
  for(const region of plan.regions)for(let i=0;i<region.contextCount;i++)
    context.set(opticalChannels(rows,region.contextOffset+i),region.id*contextWidth+i*channels);
  const query=new Float32Array(plan.segments.length*7),target=new Float32Array(plan.segments.length*7);
  const coarse=new Float32Array(target.length),onePoint=new Float32Array(target.length);
  const sparse=new Float32Array(target.length),opticalDepth=new Float32Array(plan.segments.length);
  const regionIndex=new Uint32Array(plan.segments.length);
  const transfer=(probes,length)=>{
    const emitted=integrateProbes(probes.map(p=>({...p,scattered:[0,0,0]})),length);
    const scattered=integrateProbes(probes.map(p=>({...p,emission:[0,0,0]})),length);
    return [...emitted.slice(0,3),...scattered.slice(0,3),emitted[3]];
  };
  for(const segment of plan.segments) {
    const probes=Array.from({length:segment.pointCount},(_,i)=>{
      const c=opticalChannels(rows,segment.pointOffset+i);
      return {sigma:c[0],emission:c.slice(1,4),scattered:c.slice(4,7)};
    });
    const at=segment.id*7;
    regionIndex[segment.id]=segment.region;
    query.set([...segment.entry,...segment.exit,segment.length],at);
    target.set(transfer(probes,segment.length),at);
    coarse.set(transfer(probes.filter((_,i)=>i%2===0),segment.length),at);
    const middle=probes[plan.subdivisions/2];
    sparse.set([middle.sigma,...middle.emission,...middle.scattered],at);
    opticalDepth[segment.id]=probes.slice(1).reduce((sum,p,i)=>sum+(p.sigma+probes[i].sigma)*.5,0)*segment.length/plan.subdivisions;
    const e=constantTransfer({...middle,scattered:[0,0,0]},segment.length);
    const s=constantTransfer({...middle,emission:[0,0,0]},segment.length);
    onePoint.set([...e.slice(0,3),...s.slice(0,3),e[3]],at);
  }
  let maxNestedDifference=0,maxOrderingDifference=0;
  for(let i=0;i<target.length;i++)maxNestedDifference=Math.max(maxNestedDifference,Math.abs(target[i]-coarse[i]));
  for(const segment of plan.segments)if(segment.id%plan.queriesPerRegion%2)
    for(let k=0;k<6;k++)maxOrderingDifference=Math.max(maxOrderingDifference,Math.abs(target[segment.id*7+k]-target[(segment.id-1)*7+k]));
  return {identity:plan.identity,context,query,target,coarse,onePoint,sparse,opticalDepth,regionIndex,
    shape:{regions:plan.regions.length,contextWidth,queries:plan.segments.length,queryWidth:7,targetWidth:7},
    channels:['sigma','emission-r','emission-g','emission-b','scattered-r','scattered-g','scattered-b'],
    targets:['emitted-r','emitted-g','emitted-b','scattered-r','scattered-g','scattered-b','transmission'],
    observation:{source:'actual-native-midpoint-coefficients',channels:['sigma','emission-r','emission-g','emission-b','scattered-r','scattered-g','scattered-b'],
      freshMaterialEvaluationsPerQuery:1,depthFraction:.5},
    reference:{method:'ordered-trapezoid-native-coefficients',subdivisions:plan.subdivisions,
      nestedSubdivisions:plan.subdivisions/2,maxNestedDifference,maxOrderingDifference,
      authority:'finite-native-sample-reference; convergence must be judged from nested differences'}};
}

export function integrateRegionalPredictions(transfers) {
  return transfers.reduce((a,t)=>composeTransfers(a,[t[0]+t[3],t[1]+t[4],t[2]+t[5],t[6]]),[0,0,0,1]);
}

// Browser-evaluated predicate, shared with the capture harness test.
export function regionalSceneLoaded(expectedIds) {
  const message=document.getElementById('info-bar')?.textContent||'';
  if(/load failed/i.test(message))throw Error(message);
  const objects=window.kaminosSceneAuthoring?.read().objects;
  return !!objects&&expectedIds.every(id=>objects.some(object=>object.id===id));
}
