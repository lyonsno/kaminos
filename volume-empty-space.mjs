// Exact-zero certificates for the physical material actually integrated by
// the camera. Raw moving air is not optical support. Unknown reconstruction
// footprints and mixed domain ownership remain uncertified.
export const EMPTY_SPACE_WGSL=/* wgsl */`
var<private> emptyCertificateSupportTests:u32;
fn emptyIntervalOverlaps(a:f32,b:f32,hit:vec2<f32>)->bool{
 return hit.y>hit.x&&b>=hit.x&&a<=hit.y;
}
fn emptyWorldBoundValid(bound:vec4<f32>,node:vec4<f32>)->bool{
 return node.w>0.0&&bound.w==1.0&&bound.z==0.0;
}
fn emptyWorldLeafEnd(ro:vec3<f32>,rd:vec3<f32>,node:vec4<f32>)->f32{
 let lo=worldRender.loPitch.xyz+node.xyz*worldRender.loPitch.w;
 let hi=min(worldRender.hiEnabled.xyz,lo+vec3<f32>(4.0*node.w*worldRender.loPitch.w));
 var stop=1.0e30;
 for(var axis=0u;axis<3u;axis++){
  if(rd[axis]!=0.0){stop=min(stop,(select(lo[axis],hi[axis],rd[axis]>0.0)-ro[axis])/rd[axis]);}
 }
 return stop;
}
fn emptyWorldInterval(ro:vec3<f32>,rd:vec3<f32>,a:f32,b:f32)->bool{
 var cursor=a;
 loop{
  if(cursor>=b){break;}
  var q=(ro+rd*cursor-worldRender.loPitch.xyz)/worldRender.loPitch.w;
  for(var axis=0u;axis<3u;axis++){
   if(rd[axis]<0.0&&q[axis]==worldRender.atlas[axis+1u]){q[axis]=bitcast<f32>(bitcast<u32>(q[axis])-1u);}
  }
  var node=vec4<f32>(0);var bound=worldResidentLeafBoundsAtGrid(q,&node);if(RAY_STEP_STATS){emptyCertificateSupportTests++;}
  if(!emptyWorldBoundValid(bound,node)){return false;}
  var stop=min(b,emptyWorldLeafEnd(ro,rd,node));
  if(stop<=cursor){
   // Check both face owners; shifting the lookup one ULP does not advance
   // the ray or leave an unchecked interval between its certificates.
   for(var axis=0u;axis<3u;axis++){
    if(rd[axis]>0.0&&q[axis]>=0.0){q[axis]=bitcast<f32>(bitcast<u32>(q[axis])+1u);}
    if(rd[axis]<0.0&&q[axis]>0.0){q[axis]=bitcast<f32>(bitcast<u32>(q[axis])-1u);}
   }
   bound=worldResidentLeafBoundsAtGrid(q,&node);if(RAY_STEP_STATS){emptyCertificateSupportTests++;}
   if(!emptyWorldBoundValid(bound,node)){return false;}
   stop=min(b,emptyWorldLeafEnd(ro,rd,node));
   if(stop<=cursor){return false;}
  }
  cursor=stop;
 }
 let q=(ro+rd*b-worldRender.loPitch.xyz)/worldRender.loPitch.w;
 if(all(q>=vec3<f32>(0))&&all(q<worldRender.atlas.yzw)){
  var node=vec4<f32>(0);let bound=worldResidentLeafBoundsAtGrid(q,&node);if(RAY_STEP_STATS){emptyCertificateSupportTests++;}
  if(!emptyWorldBoundValid(bound,node)){return false;}
 }
 return true;
}
fn emptyFineFootprint(c:vec3<i32>)->bool{
 if(RAY_STEP_STATS){emptyCertificateSupportTests++;}
 for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){
  let cell=clampCell(c+vec3<i32>(x,y,z));let index=index3(cell);
  let material=fluidSrc[index*SLOTS_PER_CELL+1u];
  // Physics emission/extinction depend on soot and fresh burn. Finite heat
  // remains required: zero multiplied by a nonfinite LUT lookup is not zero.
  if(!(material.x<=0.0)||!(abs(material.y)<=3.402823466e38)){return false;}
  if(reactantLawOn()&&!(textureLoad(reactantSrc,vec3<i32>(cell),0).y<=0.0)){return false;}
 }}}
 return true;
}
fn emptyFineCellEnd(ro:vec3<f32>,rd:vec3<f32>,cursor:f32,q:vec3<f32>,c:vec3<i32>,end:f32)->f32{
 let origin=worldToCell(ro)-vec3<f32>(0.5);let slope=rd*(0.5*f32(GRID));
 let raw=worldToCell(ro+rd*cursor)-vec3<f32>(0.5);
 let upper=vec3<f32>(f32(GRID)-1.001,f32(GRID_Y)-1.001,f32(GRID)-1.001);
 var stop=end;
 for(var axis=0u;axis<3u;axis++){
  if(slope[axis]==0.0){continue;}
  if((slope[axis]<0.0&&raw[axis]<=0.0)||(slope[axis]>0.0&&raw[axis]>=upper[axis])){continue;}
  let face=f32(c[axis])+select(0.0,1.0,slope[axis]>0.0);
  stop=min(stop,(face-origin[axis])/slope[axis]);
 }
 return stop;
}
fn emptyFineInterval(ro:vec3<f32>,rd:vec3<f32>,a:f32,b:f32)->bool{
 let upper=vec3<f32>(f32(GRID)-1.001,f32(GRID_Y)-1.001,f32(GRID)-1.001);
 var cursor=a;
 loop{
  if(cursor>=b){break;}
  var q=clamp(worldToCell(ro+rd*cursor)-vec3<f32>(0.5),vec3<f32>(0),upper);
  var c=vec3<i32>(floor(q));if(!emptyFineFootprint(c)){return false;}
  var stop=emptyFineCellEnd(ro,rd,cursor,q,c,b);
  if(stop<=cursor){
   for(var axis=0u;axis<3u;axis++){
    if(rd[axis]>0.0&&q[axis]>=0.0){q[axis]=bitcast<f32>(bitcast<u32>(q[axis])+1u);}
    if(rd[axis]<0.0&&q[axis]>0.0){q[axis]=bitcast<f32>(bitcast<u32>(q[axis])-1u);}
   }
   q=clamp(q,vec3<f32>(0),upper);c=vec3<i32>(floor(q));
   if(!emptyFineFootprint(c)){return false;}
   stop=emptyFineCellEnd(ro,rd,cursor,q,c,b);if(stop<=cursor){return false;}
  }
  cursor=stop;
 }
 return emptyFineFootprint(vec3<i32>(floor(clamp(worldToCell(ro+rd*b)-vec3<f32>(0.5),vec3<f32>(0),upper))));
}
fn emptyOpticalInterval(ro:vec3<f32>,rd:vec3<f32>,a:f32,b:f32,sampleT:f32,worldActive:bool,nearHit:vec2<f32>,middleHit:vec2<f32>)->bool{
 if(!(u.occupancy_controls.x>0.0)||!(b>a&&sampleT>=a&&sampleT<=b)){return false;}
 if(worldActive&&!emptyIntervalOverlaps(a,b,nearHit)){
  if(worldRender.atlas.x<0.5||emptyIntervalOverlaps(a,b,middleHit)){return false;}
  return emptyWorldInterval(ro,rd,a,b);
 }
 if(worldActive){
  if(a<nearHit.x||b>nearHit.y){return false;}
  if(worldSmokeBlendWeight(ro+rd*a)>0.0||worldSmokeBlendWeight(ro+rd*b)>0.0){return false;}
 }
 if(!(u.emissive_physics.x>0.5)||displayReconstructionActive()||u.reconstruction_kernel_controls.x>0.0){return false;}
 return emptyFineInterval(ro,rd,a,b);
}
`;

export function emptySpaceAdmission({strength=0,emissive=false,mode='current',preparedFine=false,flowKernel=0,worldBound=null}={}){
 const active=emissive&&strength>0&&['fixed','fixed-dense','numerical','budgeted','joins','history'].includes(mode);
 return {identity:'exact-physical-optical-empty-interval-v1',requested:strength>0,active,
  fine:active&&!preparedFine&&!(flowKernel>0)?'physical-soot-fresh-burn-trilinear-interval':'uncertified',
  world:active&&worldBound?.version===1?'versioned-current-leaf-coefficients':'uncertified',
  cutoff:0,simulationBypass:false,scope:'full-interval-optical-zero;ownership-and-reconstruction-may-refuse'};
}
