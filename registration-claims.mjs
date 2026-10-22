// Independent geometric claims. Implemented separately from their presentation.
export function classifyClaims(values, threshold=.5) {
 if(!Number.isFinite(threshold)||threshold<=0||threshold>1)throw Error('Threshold must be in (0,1]');
 const owners=[];
 for(let i=0;i<values.length;i++){
  const v=values[i];if(!Number.isFinite(v)||v<0||v>1)throw Error('Claim scores must be finite in [0,1]');
  if(v>=threshold)owners.push(i);
 }
 return {kind:owners.length>1?'overlap':owners.length?'single':'unclaimed',owners};
}
// Outside distance to a solid (zero inside), in the primitive's local units.
// These are geometric proposals, not semantic probabilities.
export function solidDistance({kind,parameters:p},[x,y,z]) {
 if(kind==='box')return Math.hypot(Math.max(0,Math.abs(x)-p.width/2),Math.max(0,Math.abs(y)-p.height/2),Math.max(0,Math.abs(z)-p.depth/2));
 if(kind==='cylinder')return Math.hypot(Math.max(0,Math.hypot(x,z)-p.radius),Math.max(0,Math.abs(y)-p.height/2));
 throw Error(`Unsupported claim primitive: ${kind}`);
}
