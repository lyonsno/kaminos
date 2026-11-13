export function assertHandObservation(row,previous=null) {
  const fail=message=>{throw Error(message);};
  const {state,view,model,side}=row;
  if(!state?.enabled||state.effectiveModel!==model||state.phase!=='tracking')fail('Requested model is not effectively tracking');
  if(model==='wilor'){
    if(state.identity?.model!=='wilor'||state.identity.backend!=='mlx-metal'||!/^\w{64}$/.test(state.identity.weightsSha256??''))fail('Full WiLoR Metal route is unverified');
  }else if(state.identity?.backend!=='webgpu-local'||state.identity?.mobrecon?.decoder!==model)fail('MobRecon decoder route differs');
  const hand=state.last?.hands?.find(h=>h.handedness===side&&h.hasHand);
  if(!hand||hand.verticesMeters?.length!==778*3||!Array.from(hand.verticesMeters).every(Number.isFinite))fail('Expected hand has no complete geometry');
  if(!state.last.captureId||!(state.last.frameId>0))fail('Source capture is unbound');
  if(previous&&(state.last.frameId<=previous.frameId||state.last.captureId===previous.captureId))fail('Hand stage reused an earlier source observation');
  if(!view?.visible||!view.sides.includes(side))fail('Expected tracked hand is not presented');
}

// CDP returnByValue otherwise serializes TypedArrays as numeric-key objects.
// Normalize before leaving the page; do not reinterpret arbitrary wire objects.
export function normalizeHandWitness(value) {
  if(ArrayBuffer.isView(value))return Array.from(value);
  if(Array.isArray(value))return value.map(normalizeHandWitness);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,entry])=>[key,normalizeHandWitness(entry)]));
  return value;
}
