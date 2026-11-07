// Source, receiver, traversal and camera reconstruction are independent budgets.
export function normalizeLightingTransport(value={}){
  const next={sourceSamplesPerAxis:2,sourceAxisPreference:.15,sourceSplitHysteresis:.75,importanceBankMultiplier:2,importanceExploration:.25,importanceHistoryDecay:.98,importanceHistoryBlend:.25,emptySkip:true,shadowCutoff:0,fineSteps:0,worldSteps:8,worldGrid:8,worldDirections:0,fineRefinement:4,worldRefinement:4,...value};
  for(const key of ['fineSteps','worldDirections'])if(!Number.isSafeInteger(next[key])||next[key]<0)throw Error(`${key} requires a nonnegative integer`);
  for(const key of ['worldSteps','worldGrid','fineRefinement','worldRefinement','sourceSamplesPerAxis','importanceBankMultiplier'])if(!Number.isSafeInteger(next[key])||next[key]<1)throw Error(`${key} requires a positive integer`);
  if(next.worldDirections&& (next.worldDirections<2||next.worldDirections%2))throw Error('World directions require zero (inherit) or an even count');
  if(typeof next.emptySkip!=='boolean')throw Error('Empty-space skipping must be boolean');
  if(!Number.isFinite(next.shadowCutoff)||next.shadowCutoff<0||next.shadowCutoff>1)throw Error('Shadow visibility cutoff must be between zero and one');
  if(next.sourceSamplesPerAxis**3>0xffffffff)throw Error('Source quadrature sample count exceeds the shader uint32 representation');
  for(const key of ['sourceAxisPreference','sourceSplitHysteresis'])if(!Number.isFinite(Math.fround(next[key]))||next[key]<0)throw Error(`${key} requires a finite nonnegative float32 value`);
  for(const key of ['importanceExploration','importanceHistoryDecay','importanceHistoryBlend'])if(!Number.isFinite(next[key])||next[key]<0||next[key]>1)throw Error(`${key} must be between zero and one`);
  if(next.importanceExploration===0)throw Error('Positive importance exploration preserves support for previously unseen light');
  return next;
}

export function lightingSourceSampleWork(dimensions,samplesPerAxis){
  normalizeLightingTransport({sourceSamplesPerAxis:samplesPerAxis});
  if(dimensions==null)return null;
  if(!Array.isArray(dimensions)||dimensions.length!==3||!dimensions.every(n=>Number.isSafeInteger(n)&&n>0))
    throw Error('Source workload needs the actual positive integer XYZ dimensions');
  const sourceCells=dimensions.reduce((n,value)=>n*BigInt(value),1n),samplesPerCell=samplesPerAxis**3;
  return {dimensions:[...dimensions],samplesPerAxis,samplesPerCell,sourceCells:String(sourceCells),
    materialSamples:String(sourceCells*BigInt(samplesPerCell)),relativeToDefault:samplesPerCell/8};
}
