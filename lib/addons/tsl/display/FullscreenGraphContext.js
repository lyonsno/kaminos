// A fullscreen producer is built from many receiving material builders. Reuse
// its graph when the shared shader context and explicit node version agree.
export function fullscreenGraphContext(previous, builder, version) {
  const shared=builder.getSharedContext(),renderer=builder.renderer;
  // These belong to the receiving mesh builder, not the fullscreen quad.
  // Retaining them both captures the wrong geometry and invalidates the same
  // estimator for every receiving material. The quad supplies its own values.
  for(const key of ['setupNormal','setupPositionView','setupModelViewProjection','position','clipSpace'])delete shared[key];
  const logDepth=renderer.logarithmicDepthBuffer;
  if(previous && previous.renderer===renderer && previous.version===version && previous.logDepth===logDepth) {
    const keys=Object.keys(shared),old=previous.shared;
    if(keys.length===Object.keys(old).length && keys.every(key=>Object.hasOwn(old,key)&&old[key]===shared[key]))return previous;
  }
  return {renderer,version,logDepth,shared};
}
