// CPU reference for the interval/box predicate used by the GPU certificate.
// Point support alone never certifies the rest of an integration interval.
export function certifyEmptyInterval({start,end,sample,lo,hi,support,threshold=0,strength=1}){
 const vectors=[start,end,sample,lo,hi];
 return vectors.every(v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite))
  &&[support,threshold,strength].every(Number.isFinite)&&support>=0&&threshold>=0&&strength>0&&strength<=1
  &&lo.every((v,i)=>hi[i]>v&&[start,end,sample].every(p=>p[i]>=v&&p[i]<=hi[i]))
  &&support<=threshold*strength;
}
export const EMPTY_SPACE_WGSL=/* wgsl */`
fn emptyBoxContains(a:vec3<f32>,b:vec3<f32>,p:vec3<f32>,lo:vec3<f32>,hi:vec3<f32>)->bool{
 return all(hi>lo)&&all(min(min(a,b),p)>=lo)&&all(max(max(a,b),p)<=hi);
}
fn emptyIntervalOverlaps(a:f32,b:f32,hit:vec2<f32>)->bool{
 // Closed interval: a quadrature endpoint on a join must not use the other region's certificate.
 return hit.y>hit.x&&b>=hit.x&&a<=hit.y;
}
// Walk the existing leaf geometry, accepting only empty bounds. There is no
// probe budget or sampling gap; floating-point non-progress refuses the skip.
fn emptyWorldLeafEnd(ro:vec3<f32>,rd:vec3<f32>,n:vec4<f32>)->f32{
 let lo=worldRender.loPitch.xyz+n.xyz*worldRender.loPitch.w;
 let hi=min(worldRender.hiEnabled.xyz,lo+vec3<f32>(4.0*n.w*worldRender.loPitch.w));
 var stop=1.0e30;
 for(var axis=0u;axis<3u;axis++){
  if(rd[axis]!=0.0){stop=min(stop,(select(lo[axis],hi[axis],rd[axis]>0.0)-ro[axis])/rd[axis]);}
 }
 return stop;
}
fn emptyWorldBoundValid(bound:vec4<f32>,n:vec4<f32>,cutoff:f32)->bool{
 return n.w>0.0&&bound.w>0.5&&bound.z>=0.0&&bound.z<=cutoff;
}
fn emptyWorldInterval(ro:vec3<f32>,rd:vec3<f32>,a:f32,b:f32,cutoff:f32)->bool{
 var cursor=a;
 loop{
  if(cursor>=b){break;}
  var q=(ro+rd*cursor-worldRender.loPitch.xyz)/worldRender.loPitch.w;
  // The upper outer face is outside atlas ownership and samples exactly zero.
  // A ray entering there must certify the outgoing interior leaf as well.
  for(var axis=0u;axis<3u;axis++){
   if(rd[axis]<0.0&&q[axis]==worldRender.atlas[axis+1u]){q[axis]=bitcast<f32>(bitcast<u32>(q[axis])-1u);}
  }
  var n=vec4<f32>(0);var bound=worldResidentLeafBoundsAtGrid(q,&n);
  if(!emptyWorldBoundValid(bound,n,cutoff)){return false;}
  var stop=min(b,emptyWorldLeafEnd(ro,rd,n));
  if(stop<=cursor){
   // At an exact negative-direction face, the default floor owns the leaf
   // behind the ray. Move one representable grid coordinate toward its exit;
   // require both face owners empty, and refuse if that still cannot advance.
   for(var axis=0u;axis<3u;axis++){
    if(rd[axis]>0.0&&q[axis]>=0.0){q[axis]=bitcast<f32>(bitcast<u32>(q[axis])+1u);}
    if(rd[axis]<0.0&&q[axis]>0.0){q[axis]=bitcast<f32>(bitcast<u32>(q[axis])-1u);}
   }
   bound=worldResidentLeafBoundsAtGrid(q,&n);
   if(!emptyWorldBoundValid(bound,n,cutoff)){return false;}
   stop=min(b,emptyWorldLeafEnd(ro,rd,n));
   if(stop<=cursor){return false;}
  }
  cursor=stop;
 }
 // Numerical quadrature includes its right endpoint. Check its actual owner,
 // including a different leaf at a face; the atlas exterior is exactly zero.
 let q=(ro+rd*b-worldRender.loPitch.xyz)/worldRender.loPitch.w;
 if(all(q>=vec3<f32>(0))&&all(q<worldRender.atlas.yzw)){
  var n=vec4<f32>(0);let bound=worldResidentLeafBoundsAtGrid(q,&n);
  if(!emptyWorldBoundValid(bound,n,cutoff)){return false;}
 }
 return true;
}
fn emptyOpticalInterval(ro:vec3<f32>,rd:vec3<f32>,a:f32,b:f32,sampleT:f32,worldActive:bool,nearHit:vec2<f32>,middleHit:vec2<f32>)->bool{
 let strength=clamp(u.occupancy_controls.x,0.0,1.0);
 if(strength<=0.0||b<=a||sampleT<a||sampleT>b){return false;}
 let cutoff=u.empty_space_controls.x*strength;
 let p=ro+rd*sampleT;let p0=ro+rd*a;let p1=ro+rd*b;
 if(worldActive&&!emptyIntervalOverlaps(a,b,nearHit)){
  if(worldRender.atlas.x<0.5||emptyIntervalOverlaps(a,b,middleHit)){return false;}
  return emptyWorldInterval(ro,rd,a,b,cutoff);
 }
 if(worldActive){
  if(a<nearHit.x||b>nearHit.y){return false;}
  // The distance to a convex Fine boundary is concave along a straight ray:
  // zero World blend at both endpoints also bounds the interior blend.
  if(worldSmokeBlendWeight(p0)>0.0||worldSmokeBlendWeight(p1)>0.0){return false;}
 }
 if(displayReconstructionActive()){
  let dims=vec3<f32>(textureDimensions(displayField));let scale=u.display_reconstruction.w;
  let cp=worldToCell(p);
  let mapped=select(cp*scale-0.5,(cp-0.5)*scale,u.display_interpolation.x>0.5);
  let c=vec3<i32>(floor(clamp(mapped,vec3<f32>(0),dims-1.0)));
  let m0=select(worldToCell(p0)*scale-0.5,(worldToCell(p0)-0.5)*scale,u.display_interpolation.x>0.5);
  let m1=select(worldToCell(p1)*scale-0.5,(worldToCell(p1)-0.5)*scale,u.display_interpolation.x>0.5);
  if(!emptyBoxContains(clamp(m0,vec3<f32>(0),dims-1.0),clamp(m1,vec3<f32>(0),dims-1.0),clamp(mapped,vec3<f32>(0),dims-1.0),vec3<f32>(c),vec3<f32>(c)+1.0)){return false;}
  var support=0.0;
  for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){
   let v=abs(textureLoad(displayField,min(c+vec3<i32>(x,y,z),vec3<i32>(dims)-1),0));
   support=max(support,max(max(v.x,v.y),max(v.z,v.w)));
  }}}
  return support<=cutoff;
 }
 // Raw Fine support is an exact-zero certificate, not a heuristic optical bound.
 // Flow-kernel reconstruction has a wider footprint and is not certified here.
 if(u.reconstruction_kernel_controls.x>0.0){return false;}
 let dims=vec3<f32>(f32(GRID),f32(GRID_Y),f32(GRID));
 let q=clamp(worldToCell(p)-0.5,vec3<f32>(0),dims-1.001);let c=vec3<i32>(floor(q));
 let q0=clamp(worldToCell(p0)-0.5,vec3<f32>(0),dims-1.001);
 let q1=clamp(worldToCell(p1)-0.5,vec3<f32>(0),dims-1.001);
 if(!emptyBoxContains(q0,q1,q,vec3<f32>(c),vec3<f32>(c)+1.0)){return false;}
 for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){
  let cell=clampCell(c+vec3<i32>(x,y,z));let index=index3(cell);
  for(var slot=0u;slot<4u;slot++){if(any(fluidSrc[index*SLOTS_PER_CELL+slot]!=vec4<f32>(0))){return false;}}
  if(frontSrc[index]!=0.0){return false;}
  if(reactantLawOn()&&textureLoad(reactantSrc,cell,0).y!=0.0){return false;}
 }}}
 return true;
}
`;
