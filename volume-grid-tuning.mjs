import {fineGridPlan} from './volume-fine-grid.mjs';
import {resolveWorldRegions} from './volume-region-controls.mjs';
import {resolveGridHeight} from './volume-grid-shape.mjs';

// One planning operation shared by the inspector and runtime admission.
export const GRID_TUNING_GROUPS = [
 {name:'Fine · flame',fields:[['resolution','volume-resolution','Material detail'],['gridHeightRatio','volume-grid-height-ratio','Height / width'],['fineVelocity','volume-fine-velocity','Velocity detail'],['finePressure','volume-fine-pressure','Pressure detail'],['pressureSolverIterations','volume-pressure-solver-iterations','Pressure iterations']]},
 {name:'Intermediate · transition',fields:[['worldSmokeIntermediate','volume-world-smoke-intermediate','Mode'],['intermediateExtent','volume-intermediate-extent','Width / fine width'],['intermediateMaterial','volume-intermediate-material','Material detail'],['intermediateFlow','volume-intermediate-flow','Velocity detail'],['intermediatePressure','volume-intermediate-pressure','Pressure detail'],['intermediateIterations','volume-intermediate-iterations','Pressure iterations']]},
 {name:'World · plume',fields:[['worldSmoke','volume-world-smoke','Enabled'],['worldSmokeExtent','volume-world-smoke-extent','Width / fine width'],['worldSmokeMaterial','volume-world-smoke-material','Material detail'],['worldSmokeFlow','volume-world-smoke-flow','Velocity detail'],['worldSmokePressure','volume-world-smoke-pressure','Pressure detail'],['worldSmokeIterations','volume-world-smoke-iterations','Pressure iterations']]},
];
export const GRID_TUNING_FIELDS=GRID_TUNING_GROUPS.flatMap(g=>g.fields);
const cells=d=>d.reduce((a,b)=>a*b,1);
export function gridTuningPlan(c,limits={}) {
 const width=Number(c.resolution??64),shape=resolveGridHeight(c,width);
 const fine=fineGridPlan({materialDims:[width,shape.heightCells,width],velocity:Number(c.fineVelocity??0),pressure:Number(c.finePressure??0)});
 const iterations=Number(c.pressureSolverIterations??60);
 if(!Number.isInteger(iterations)||iterations<0)throw Error('Fine pressure iterations must be a nonnegative integer');
 const regions=c.worldSmoke==='on'?resolveWorldRegions(c,fine.materialDims):null;
 const rows=[{name:'Fine',...fine,flowDims:fine.velocityDims,materialPitch:2/width,flowPitch:2/fine.velocityDims[0],pressurePitch:2/fine.pressureDims[0],iterations}];
 if(regions?.middle)rows.push({name:'Intermediate',...regions.middle,iterations:regions.middleIterations});
 if(regions)rows.push({name:'World',...regions.world,iterations:regions.worldIterations});
 for(const r of rows) {
  const fine=r.name==='Fine';
  for(const [kind,dims,bytesPerCell] of [['material',r.materialDims,fine?64:32],['velocity',r.flowDims,fine?64:16],['pressure',r.pressureDims,fine?64:8]]) {
   if(!dims)continue; // The legacy middle flow borrows world material.
   if(dims.some(n=>n>(limits.maxTextureDimension3D??Infinity)) || (fine&&3*width>(limits.maxTextureDimension3D??Infinity)))throw Error(`${r.name} ${kind} dimensions exceed this GPU's texture limit`);
   if(cells(dims)*bytesPerCell>Math.min(limits.maxStorageBufferBindingSize??Infinity,limits.maxBufferSize??Infinity))throw Error(`${r.name} ${kind} buffer exceeds this GPU's storage limit; reduce its width or extent height`);
  }
 }
 return {fine,shape,regions,rows};
}
export function gridWidthChoices(c,key) {
 const width=Number(c.resolution),shape=resolveGridHeight(c,width);
 if(key==='fineVelocity'||key==='finePressure') {
  const parent=key==='fineVelocity'?width:Number(c.fineVelocity)||width;
  return Array.from({length:parent},(_,i)=>i+1).filter(n=>n>=2&&parent%n===0&&width%n===0&&shape.heightCells%(width/n)===0);
 }
 if(key==='worldSmokePressure')return Array.from({length:Number(c.worldSmokeFlow)},(_,i)=>i+1).filter(n=>n>=2&&Number(c.worldSmokeFlow)%n===0);
 return [8,12,16,24,32,48,64,96,128].filter(n=>{
  try {gridTuningPlan({...c,[key]:n});return true;} catch{return false;}
 });
}
export function gridTuningSummary(row, fineWidth) {
 const count=n=>n.toLocaleString('en-US'),pitch=n=>Number(n.toPrecision(4));
 const entries=[['Material',row.materialDims,row.materialPitch],['Velocity',row.flowDims,row.flowPitch],['Pressure',row.pressureDims,row.pressurePitch??row.flowPitch*row.flowDims[0]/row.pressureDims[0]]];
 return entries.filter(([,d])=>d).map(([name,d,p])=>`${name}: ${d.join(' × ')} · ${count(cells(d))} cells · cell width ${pitch(p/(2/fineWidth))}× fine material`).join('\n')+`\nPressure work: ${count(cells(row.pressureDims)*row.iterations)} cell-iterations / step`;
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
