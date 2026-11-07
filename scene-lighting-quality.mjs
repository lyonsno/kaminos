// Source, receiver, traversal and camera reconstruction are independent budgets.
export function normalizeLightingTransport(value={}){
  const next={emptySkip:true,shadowCutoff:0,fineSteps:0,worldSteps:8,worldGrid:8,worldDirections:0,fineRefinement:4,worldRefinement:4,...value};
  for(const key of ['fineSteps','worldDirections'])if(!Number.isSafeInteger(next[key])||next[key]<0)throw Error(`${key} requires a nonnegative integer`);
  for(const key of ['worldSteps','worldGrid','fineRefinement','worldRefinement'])if(!Number.isSafeInteger(next[key])||next[key]<1)throw Error(`${key} requires a positive integer`);
  if(next.worldDirections&& (next.worldDirections<2||next.worldDirections%2))throw Error('World directions require zero (inherit) or an even count');
  if(typeof next.emptySkip!=='boolean')throw Error('Empty-space skipping must be boolean');
  if(!Number.isFinite(next.shadowCutoff)||next.shadowCutoff<0||next.shadowCutoff>1)throw Error('Shadow visibility cutoff must be between zero and one');
  return next;
}
