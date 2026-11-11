export const AMBIENT_BOUNDARY_DEFAULT_EXCHANGE_TIME=-1/Math.log(.2);
export const AMBIENT_BOUNDARY_KEYS=['widthWorld','exchangeTime','velocityDamping'];
export function ambientBoundarySettings(input={}) {
 const value=(key,fallback)=>{const v=input[key]??fallback;if(!Number.isFinite(v)||v<0)throw Error('Invalid ambient boundary '+key);return v;};
 const widthWorld=input.widthWorld??null;if(widthWorld!==null&&(!Number.isFinite(widthWorld)||widthWorld<0))throw Error('Invalid ambient boundary widthWorld');
 return {widthWorld,exchangeTime:value('exchangeTime',AMBIENT_BOUNDARY_DEFAULT_EXCHANGE_TIME),velocityDamping:value('velocityDamping',1)};
}
export function resolveAmbientBoundary(controls={},context={}) {
 const settings=ambientBoundarySettings({widthWorld:controls.ambientBoundaryWidth,exchangeTime:controls.ambientBoundaryExchangeTime,velocityDamping:controls.ambientBoundaryVelocityDamping});
 const scale=Math.abs(context.scale??1);if(!Number.isFinite(scale)||scale<=0)throw Error('Ambient boundary requires a positive world scale');
 const widthLocal=settings.widthWorld===null?.14:settings.widthWorld/scale;
 if(!Number.isFinite(Math.fround(widthLocal))||!Number.isFinite(Math.fround(settings.velocityDamping)))throw Error('Ambient boundary value exceeds GPU float32 range');
 const rawPower=settings.exchangeTime===0?-1:AMBIENT_BOUNDARY_DEFAULT_EXCHANGE_TIME/settings.exchangeTime;
 const exchangePower=Number.isFinite(Math.fround(rawPower))?rawPower:-1;
 const reason=!context.reactant?'requires-reactant-law':context.joined||context.open?'exterior-owns-boundary':widthLocal===0?'zero-contact-width':null;
 return {identity:'kaminos.ambient-boundary.v1',settings,effective:{applied:reason===null,reason,widthWorld:widthLocal*scale,widthLocal,exchangePower,velocityDamping:settings.velocityDamping,faces:['sides','floor'],top:'passive-outflow',sourceExemptions:true},uniforms:[widthLocal,exchangePower,settings.velocityDamping,0],domain:{scale,translate:[...(context.translate??[0,0,0])],dims:[...(context.dims??[6,6,6])]},view:'geometric-envelope; source openings remain simulation-owned'};
}
export function ambientBoundaryControlPatch(settings) {
 return {ambientBoundaryWidth:settings.widthWorld,ambientBoundaryExchangeTime:settings.exchangeTime,ambientBoundaryVelocityDamping:settings.velocityDamping};
}
export function ambientBoundaryEnvelope(boundary) {
 const w=boundary.effective.widthLocal,top=2*boundary.domain.dims[1]/boundary.domain.dims[0]-1;
 const inner=Math.max(0,1-w),floor=Math.min(top,-1+w),p=[];
 const line=(a,b)=>p.push(...a,...b);
 const corners=[[-inner,-inner],[inner,-inner],[inner,inner],[-inner,inner]],outer=[[-1,-1],[1,-1],[1,1],[-1,1]];
 for(let i=0;i<4;i++){const [x,z]=corners[i],[nx,nz]=corners[(i+1)%4];line([x,floor,z],[nx,floor,nz]);line([x,floor,z],[x,top,z]);line([x,floor,z],[outer[i][0],-1,outer[i][1]]);}
 return new Float32Array(p);
}

export const AMBIENT_BOUNDARY_WGSL=`
fn ambientMaterialWallFade(wall:f32,cellWidth:f32,bandWidth:f32)->f32 {
  if(bandWidth<=0.0){return 1.0;}
  let width=max(cellWidth,1e-6);
  let lo=(wall-0.5*width-(1.0-bandWidth))/bandWidth;
  let hi=(wall+0.5*width-(1.0-bandWidth))/bandWidth;
  // The cell average converges to its point value below float precision.
  if(width/bandWidth<1e-4){return 1.0-smoothstep(1.0-bandWidth,1.0,wall);}
  let a=clamp(lo,0.0,1.0);let b=clamp(hi,0.0,1.0);
  let lower=a*a*a*(1.0-0.5*a)+max(lo-1.0,0.0);
  let upper=b*b*b*(1.0-0.5*b)+max(hi-1.0,0.0);
  return clamp(1.0-bandWidth*(upper-lower)/width,0.0,1.0);
}
fn ambientRateSurvival(base:f32,fade:f32,power:f32)->f32 {
  if(fade>=1.0||power==0.0){return 1.0;}
  if(power<0.0){return 0.0;}
  let survival=mix(base,1.0,fade);
  if(power==1.0){return survival;}
  return pow(survival,power);
}
`;
