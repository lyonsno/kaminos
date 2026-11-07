// A parcel may predate the current resolution. One impact fills only locally
// supported receiving cells; remaining material stays airborne at that contact.
export const hierarchyImpactWGSL=`
 if(hit){
  hitCell.x=clamp(hitCell.x,0,i32(p.dims.x)-1);hitCell.z=clamp(hitCell.z,0,i32(p.dims.z)-1);
  let y0=max(0,hitCell.y);var stride=1u;var contactHeight=p.origin.y+f32(p.dims.y)*cell;
  if(y0<i32(p.dims.y)){
   let j0=index(vec3<u32>(u32(hitCell.x),u32(y0),u32(hitCell.z)));let c0=ash_cell(j0);stride=c0.size;
   contactHeight=p.origin.y+f32(c0.lower.y+i32(c0.size))*cell;
   if(solid[j0]==0u){amount-=put(j0,min(amount,ash_capacity(j0)*.32));}
   for(var dz=-1;dz<=1;dz++){for(var dx=-1;dx<=1;dx++){
    if((dx==0)==(dz==0)||amount<=0.0){continue;}
    let nx=hitCell.x+dx*i32(stride);let nz=hitCell.z+dz*i32(stride);
    if(nx<0||nz<0||nx>=i32(p.dims.x)||nz>=i32(p.dims.z)){continue;}
    let nj=index(vec3<u32>(u32(nx),u32(y0),u32(nz)));if(nj==j0||solid[nj]!=0u){continue;}
    let nc=ash_cell(nj);var supported=nc.lower.y==0;
    if(!supported){let bj=index(vec3<u32>(u32(nx),u32(nc.lower.y-1),u32(nz)));supported=solid[bj]!=0u||bitcast<f32>(atomicLoad(&density[bj]))>ash_capacity(bj)*.1;}
    if(supported){amount-=put(nj,min(amount,ash_capacity(nj)*.17));}
   }}
  }
  if(amount>0.0){
   let bounceSeed=i+atomicLoad(&state[2])*747796405u+u32(hitCell.x)*374761393u+u32(hitCell.z)*668265263u;
   let angle=random(bounceSeed)*6.2831853;let direction=vec2<f32>(cos(angle),sin(angle));
   let deflected=clamp(vec2<f32>(p.origin.x+f32(hitCell.x)*cell,p.origin.z+f32(hitCell.z)*cell)+direction*(cell*f32(stride)*2.0),low,high);
   nextPosition=vec3<f32>(deflected.x,contactHeight+cell*.5,deflected.y);velocity=vec3<f32>(direction.x*.04,-.08,direction.y*.04);
  }
 }
`;
