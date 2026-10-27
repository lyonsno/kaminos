import {fineGridPlan} from './volume-fine-grid.mjs';
import {resolveWorldRegions} from './volume-region-controls.mjs';
import {resolveGridHeight} from './volume-grid-shape.mjs';
import {pressureResolutionPlan} from './volume-pressure-resolution.mjs';
import {resolvePressureSolverConfig} from './volume-core.js';

// One planning operation shared by the inspector and runtime admission.
export const GRID_TUNING_GROUPS = [
 {name:'Fine · flame',fields:[['resolution','volume-resolution','Material detail'],['gridHeightRatio','volume-grid-height-ratio','Height / width'],['fineVelocity','volume-fine-velocity','Velocity detail'],['finePressure','volume-fine-pressure','Pressure detail'],['pressureSolverIterations','volume-pressure-solver-iterations','Pressure iterations']]},
 {name:'Intermediate · transition',fields:[['worldSmokeIntermediate','volume-world-smoke-intermediate','Mode'],['intermediateExtent','volume-intermediate-extent','Width / fine width'],['intermediateMaterial','volume-intermediate-material','Material detail'],['intermediateFlow','volume-intermediate-flow','Velocity detail'],['intermediatePressure','volume-intermediate-pressure','Pressure detail'],['intermediateIterations','volume-intermediate-iterations','Pressure iterations']]},
 {name:'World · plume',fields:[['worldSmoke','volume-world-smoke','Enabled'],['worldSmokeExtent','volume-world-smoke-extent','Width / fine width'],['worldSmokeMaterial','volume-world-smoke-material','Material detail'],['worldSmokeFlow','volume-world-smoke-flow','Velocity detail'],['worldSmokePressure','volume-world-smoke-pressure','Pressure detail'],['worldSmokeIterations','volume-world-smoke-iterations','Pressure iterations'],['worldSmokeTransition','volume-world-smoke-transition','Momentum collar cells']]},
];
export const GRID_TUNING_FIELDS=GRID_TUNING_GROUPS.flatMap(g=>g.fields);
const cells=d=>d.reduce((a,b)=>a*b,1);
export function gridTuningPlan(c,limits={},context={}) {
 const width=Number(c.resolution??64),shape=resolveGridHeight(c,width);
 const fine=fineGridPlan({materialDims:[width,shape.heightCells,width],velocity:Number(c.fineVelocity??0),pressure:Number(c.finePressure??0)});
 const iterations=Number(c.pressureSolverIterations??60);
 if(!Number.isInteger(iterations)||iterations<0)throw Error('Fine pressure iterations must be a nonnegative integer');
 const solver=resolvePressureSolverConfig(c).effective;
 const pressure=pressureResolutionPlan({dims:fine.velocityDims,width:fine.materialPerVelocity!==1?(Number(c.finePressure)||fine.velocityDims[0]):Number(c.finePressure??0),mode:c.pressureResolution||'off',solver:solver.solver,inflow:c.emitterSourceLaw==='inflow-boundary',joined:context.joined===true});
 if(Number(c.finePressure)>0&&pressure.reason)throw Error(`Fine pressure: ${pressure.reason}`);
 const regions=c.worldSmoke==='on'?resolveWorldRegions(c,fine.materialDims):null;
 if(regions&&(!Number.isFinite(Number(c.worldSmokeTransition??0))||Number(c.worldSmokeTransition??0)<0))throw Error('Momentum collar must have a nonnegative finite reach');
 const rows=[{name:'Fine',...fine,pressureDims:pressure.pressureDims,pressureReason:pressure.reason,flowDims:fine.velocityDims,materialPitch:2/width,flowPitch:2/fine.velocityDims[0],pressurePitch:2/pressure.pressureDims[0],iterations:solver.iterations}];
 if(regions?.middle)rows.push({name:'Intermediate',...regions.middle,iterations:regions.middleIterations});
 if(regions)rows.push({name:'World',...regions.world,iterations:regions.worldIterations});
 for(const r of rows) {
  const fine=r.name==='Fine';
  if(fine&&Math.max(9*r.flowDims[0],r.flowDims[1])>(limits.maxTextureDimension3D??Infinity))throw Error('Fine velocity auxiliary textures exceed this GPU texture limit');
  for(const [kind,dims,bytesPerCell] of [['material',r.materialDims,fine?64:32],['velocity',r.flowDims,fine?64:16],['pressure',r.pressureDims,fine?64:8]]) {
   if(!dims)continue; // The legacy middle flow borrows world material.
   if(dims.some(n=>n>(limits.maxTextureDimension3D??Infinity)) || (fine&&3*width>(limits.maxTextureDimension3D??Infinity)))throw Error(`${r.name} ${kind} dimensions exceed this GPU's texture limit`);
   if(cells(dims)*bytesPerCell>Math.min(limits.maxStorageBufferBindingSize??Infinity,limits.maxBufferSize??Infinity))throw Error(`${r.name} ${kind} buffer exceeds this GPU's storage limit; reduce its width or extent height`);
  }
 }
 return {fine,shape,regions,rows,pressure};
}
export function gridWidthChoices(c,key) {
 const parent=key==='finePressure'?(Number(c.fineVelocity)||Number(c.resolution)):key==='fineVelocity'?Number(c.resolution):Number(c.worldSmokeFlow);
 return [...new Set([8,12,16,24,32,48,64,96,128,parent])].sort((a,b)=>a-b).filter(n=>{try{gridTuningPlan({...c,[key]:n});return true;}catch{return false;}});
}
export function gridTuningSummary(row, fineWidth) {
 const count=n=>n.toLocaleString('en-US'),pitch=n=>Number(n.toPrecision(4));
 const entries=[['Material',row.materialDims,row.materialPitch],['Velocity',row.flowDims,row.flowPitch],['Pressure',row.pressureDims,row.pressurePitch??row.flowPitch*row.flowDims[0]/row.pressureDims[0]]];
 return entries.filter(([,d])=>d).map(([name,d,p])=>`${name}: ${d.join(' × ')} · ${count(cells(d))} cells · cell width ${pitch(p/(2/fineWidth))}× fine material`).join('\n')+(row.iterations===null?'\nPressure work: legacy spatial tiers':`\nPressure work: ${count(cells(row.pressureDims)*row.iterations)} cell-iterations / step`)+(row.pressureReason?`\nPressure fallback: ${row.pressureReason}`:'');
}

// Cubic cells require height/width to be integral on all three lattices.
// Their gcd enumerates every compatible height, hence every finite extent > 1.
export function intermediateCoverageChoices(c) {
 const values=['intermediateMaterial','intermediateFlow','intermediatePressure'].map(k=>Number(c[k]));
 if(values.some(n=>!Number.isSafeInteger(n)||n<2))return [];
 const gcd=(a,b)=>b?gcd(b,a%b):a,g=values.reduce(gcd);
 const ratio=resolveGridHeight(c,Number(c.resolution)).ratio;
 if(ratio===1)return []; // Every extent tiles; no fitting is needed.
 const choices=[];
 for(let k=1;k<g*(ratio-1);k++){
  const extent=g*(ratio-1)/k;
  try{gridTuningPlan({...c,intermediateExtent:extent});choices.push(extent);}catch{}
 }
 return choices.sort((a,b)=>a-b);
}
