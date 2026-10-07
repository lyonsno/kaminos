import {sourceInterval,integrateCellRay} from './scene-source-aware.mjs';
import {sourceGuidePdf,normalizeSourceGuide} from './scene-source-guide.mjs';

export function inspectSourceRays({inputs,field,metadata}){
  if(!Number.isFinite(metadata.surfaceGainFactor)||metadata.surfaceGainFactor<0)throw new Error('finite nonnegative inspection gain required');
  const guided=metadata.angularPattern==='guided'&&metadata.samplingLaw==='emitter-envelope-mixture-solid-angle-v1';
  if(!guided&&(metadata.angularPattern!=='source'||metadata.samplingLaw!=='progressive-volume-induced-solid-angle-v1'))return {status:'unsupported',reason:'CPU ray replay supports uniform source-aware and emitter-informed progressive sampling only'};
  if(guided)validateGuideIdentity(inputs,metadata);
  const dims=field.dimensions,values=field.data;
  if(!Array.isArray(dims)||dims.length!==3||!dims.every(x=>Number.isSafeInteger(x)&&x>0)||values.length!==4*dims.reduce((a,b)=>a*b,1)||!values.every(Number.isFinite))throw new Error('complete finite inspection source required');
  if(inputs.directions!==metadata.directions||inputs.points.length!==metadata.directions)throw new Error('inspection direction identity mismatch');
  const sample=cell=>{const i=4*(cell[0]+dims[0]*(cell[1]+dims[1]*cell[2]));return values.slice(i,i+4);};
  const rows=inputs.rows.map(row=>{
    if(row.position.length!==3||row.normal.length!==3||![...row.position,...row.normal].every(Number.isFinite)||Math.abs(Math.hypot(...row.normal)-1)>.0001||row.firstHits.length!==metadata.directions||row.firstHits.some(x=>!Number.isFinite(x)||x<=0))throw new Error('invalid/unwritten actual ray input');
    const front=[0,0,0],back=[0,0,0];
    const rays=inputs.points.map((point,a)=>{
      const v=point.map((x,k)=>x-row.position[k]),length=Math.hypot(...v),direction=length?v.map(x=>x/length):[0,1,0],span=sourceInterval(row.position,direction),[near,far]=span;
      const pdf=guided?sourceGuidePdf(row.position,direction,inputs.sourceGuide,metadata.directions):(far-near)*(far*far+far*near+near*near)/48;
      if(!Number.isFinite(pdf)||pdf<=0)throw new Error('inspection source density invalid');
      const cosine=row.normal.reduce((s,x,k)=>s+x*direction[k],0),side=row.twoSided&&cosine<0?'back':'front';
      const weight=(row.twoSided?Math.abs(cosine):Math.max(0,cosine))/(metadata.directions*pdf);
      const radiance=integrateCellRay(sample,dims,row.position,direction,row.firstHits[a]),unblocked=integrateCellRay(sample,dims,row.position,direction);
      const contribution=radiance.map(x=>x*weight*metadata.surfaceGainFactor),sum=side==='back'?back:front;
      for(let c=0;c<3;c++)sum[c]+=contribution[c];
      return {a,point,direction,span,pdf,cosine,weight,side,firstSolidDistance:row.firstHits[a],radiance,unblocked,contribution};
    });
    const error=Math.max(...front.map((x,c)=>Math.abs(x-row.front[c])),...back.map((x,c)=>Math.abs(x-row.back[c]))),scale=Math.max(1,...row.front,...row.back);
    return {...row,rays,cpuFront:front,cpuBack:back,error,status:error/scale<.0002?'matched':'mismatch'};
  });
  return {status:metadata.surfaceReconstruction?.passes?'reconstructed':rows.every(r=>r.status==='matched')?'matched':'mismatch',rows,model:'same-cell-source-CPU-replay',generation:metadata.generation};
}

export function validateInspectionSnapshot(snapshot){
  for(const generation of [snapshot.metadata?.generation,snapshot.sourceGeneration,snapshot.inputs?.generation])if(!Number.isSafeInteger(generation)||generation<0)throw new Error('present nonnegative integer inspection generation required');
  if(snapshot.status!=='captured'||snapshot.metadata.generation!==snapshot.sourceGeneration||snapshot.metadata.generation!==snapshot.inputs.generation)throw new Error('inspection snapshot is partial or mixed-generation');
  if(!snapshot.inputs.rows.length||snapshot.inputs.rows.some(r=>!r.front.every(Number.isFinite)||!r.back.every(Number.isFinite)))throw new Error('actual receiver output required');
  if(snapshot.metadata.angularPattern==='guided')validateGuideIdentity(snapshot.inputs,snapshot.metadata);
  return snapshot;
}
function validateGuideIdentity(inputs,metadata){
  const actual=normalizeSourceGuide(inputs.sourceGuide),reported=normalizeSourceGuide(metadata.sourceGuide);
  if(JSON.stringify([actual.lo,actual.hi])!==JSON.stringify([reported.lo,reported.hi]))throw new Error('actual GPU source guide differs from captured guide identity');
}
