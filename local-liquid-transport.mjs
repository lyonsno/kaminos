// Deterministic reference contracts for the host shader's supported metric path.
export function resolveLiquidTermination(exitPath,solidDistance=null) {
 if(!Number.isFinite(exitPath)||exitPath<0)throw Error('Liquid path must be finite and nonnegative');
 return typeof solidDistance==='number'&&Number.isFinite(solidDistance)&&solidDistance>=0&&solidDistance<=exitPath
  ? {kind:'solid',waterPath:solidDistance}:{kind:'exit',waterPath:exitPath};
}
export function liquidTransportWeights(path) {
 if(!Number.isFinite(path)||path<0)throw Error('Liquid path must be finite and nonnegative');
 const absorption=[1.1,.42,.18].map(k=>Math.exp(-k*path));
 return {absorption,scatter:[.055,.30,.42].map((c,i)=>c*(1-absorption[i]))};
}
export function liquidDepthNormal(center,left,right,up,down,viewToCamera) {
 const valid=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
 if(!valid(center)||!valid(viewToCamera))throw Error('Liquid normal needs finite geometry');
 const sub=(a,b)=>a.map((v,i)=>v-b[i]);
 const dx=valid(left)&&valid(right)?sub(right,left):valid(right)?sub(right,center):valid(left)?sub(center,left):null;
 const dy=valid(up)&&valid(down)?sub(down,up):valid(down)?sub(down,center):valid(up)?sub(center,up):null;
 const normalize=v=>{const length=Math.hypot(...v);if(!(length>0))throw Error('Liquid normal has no view direction');return v.map(x=>x/length);};
 const view=normalize(viewToCamera);
 if(!dx||!dy)return view;
 const lx=Math.hypot(...dx),ly=Math.hypot(...dy);if(!(lx>0&&ly>0))return view;
 const x=dx.map(v=>v/lx),y=dy.map(v=>v/ly);
 let n=[x[1]*y[2]-x[2]*y[1],x[2]*y[0]-x[0]*y[2],x[0]*y[1]-x[1]*y[0]];
 if(Math.hypot(...n)<1e-6)return view;
 n=normalize(n);return n.reduce((s,v,i)=>s+v*view[i],0)<0?n.map(v=>-v):n;
}
export const LOCAL_LIQUID_TRANSPORT_WGSL=/* wgsl */`
fn liquidDepthPoint(pixel: vec2<i32>, referenceDepth: f32, backSurface: bool) -> vec4<f32> {
  let dims = vec2<i32>(textureDimensions(surfaceAccumulation));
  if (any(pixel < vec2<i32>(0)) || any(pixel >= dims)) { return vec4<f32>(0.0); }
  let support = readAccum(pixel);
  let depth = select(readFrontDepth(pixel), readBackDepth(pixel), backSurface);
  let populated = (support.z > 0.018) && (support.x > 0.012) && (depth > 0.001) && (depth < 29.5);
  if (!populated || abs(depth - referenceDepth) >= 0.72) { return vec4<f32>(0.0); }
  return vec4<f32>(reconstructWorldPosition(pixel, depth), 1.0);
}
fn liquidWorldNormalAtRadius(pixel: vec2<i32>, requestedRadius: i32, backSurface: bool) -> vec3<f32> {
  let depth = select(readFrontDepth(pixel), readBackDepth(pixel), backSurface);
  let center = reconstructWorldPosition(pixel, depth);
  let viewOffset = params.cameraPosition.xyz - center;
  var viewToCamera = -params.cameraForward.xyz;
  if (length(viewOffset) > 0.000001) { viewToCamera = normalize(viewOffset); }
  var dx = vec3<f32>(0.0);
  var dy = vec3<f32>(0.0);
  var hasX = false;
  var hasY = false;
  let radii = array<i32, 3>(requestedRadius, min(requestedRadius, 3), 1);
  for (var index = 0u; index < 3u; index = index + 1u) {
    let radius = radii[index];
    if (!hasX) {
      let left = liquidDepthPoint(pixel + vec2<i32>(-radius, 0), depth, backSurface);
      let right = liquidDepthPoint(pixel + vec2<i32>(radius, 0), depth, backSurface);
      if (left.w > 0.5 && right.w > 0.5) { dx = right.xyz - left.xyz; hasX = true; }
      else if (right.w > 0.5) { dx = right.xyz - center; hasX = true; }
      else if (left.w > 0.5) { dx = center - left.xyz; hasX = true; }
    }
    if (!hasY) {
      let up = liquidDepthPoint(pixel + vec2<i32>(0, -radius), depth, backSurface);
      let down = liquidDepthPoint(pixel + vec2<i32>(0, radius), depth, backSurface);
      if (up.w > 0.5 && down.w > 0.5) { dy = down.xyz - up.xyz; hasY = true; }
      else if (down.w > 0.5) { dy = down.xyz - center; hasY = true; }
      else if (up.w > 0.5) { dy = center - up.xyz; hasY = true; }
    }
    if (hasX && hasY) { break; }
  }
  if (!hasX || !hasY || length(dx) <= 0.0 || length(dy) <= 0.0) { return viewToCamera; }
  let crossValue = cross(normalize(dx), normalize(dy));
  if (length(crossValue) < 0.000001) { return viewToCamera; }
  let normal = normalize(crossValue);
  return select(normal, -normal, dot(normal, viewToCamera) < 0.0);
}
fn liquidWorldDirectionToView(direction: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(dot(direction, params.cameraRight.xyz), dot(direction, params.cameraUp.xyz), -dot(direction, params.cameraForward.xyz));
}
`;
