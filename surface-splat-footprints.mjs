// Covariance of each retained group's original points in its tangent plane.
// Layout: unit tangent U.xyz, sigmaU, unit tangent V.xyz, sigmaV. Centres/materials stay unchanged.
export function fitSurfaceFootprints(source,reduced,parent,radius,triangles){
 if(!(source instanceof Float32Array)||!(reduced instanceof Float32Array)||source.length%12||reduced.length%12||!(parent instanceof Uint32Array)||parent.length*12!==source.length||!(radius>0))throw Error('Invalid footprint source');
 const n=reduced.length/12,frames=new Float64Array(n*6),moments=new Float64Array(n*4),out=new Float32Array(n*8);
 for(let j=0;j<n;j++){
  const k=j*12,l=Math.hypot(...reduced.subarray(k+3,k+6));if(!Number.isFinite(l)||l<1e-12)throw Error('Invalid surface normal');
  const nx=reduced[k+3]/l,ny=reduced[k+4]/l,nz=reduced[k+5]/l;
  let ux,uy,uz;if(Math.abs(nz)<.9){ux=ny;uy=-nx;uz=0;}else{ux=0;uy=nz;uz=-ny;}
  const t=Math.hypot(ux,uy,uz);ux/=t;uy/=t;uz/=t;
  frames.set([ux,uy,uz,ny*uz-nz*uy,nz*ux-nx*uz,nx*uy-ny*ux],j*6);
 }
 for(let i=0;i<parent.length;i++){
  const j=parent[i];if(j===0xffffffff)continue;if(j>=n)throw Error('Parent outside retained field');
  const s=i*12,k=j*12,b=j*6,m=j*4,dx=source[s]-reduced[k],dy=source[s+1]-reduced[k+1],dz=source[s+2]-reduced[k+2];
  const u=dx*frames[b]+dy*frames[b+1]+dz*frames[b+2],v=dx*frames[b+3]+dy*frames[b+4]+dz*frames[b+5];
  moments[m]+=u*u;moments[m+1]+=u*v;moments[m+2]+=v*v;moments[m+3]++;
 }
 for(let j=0;j<n;j++){
  const m=j*4,b=j*6,k=j*8,count=moments[m+3];if(!count)throw Error('Retained group has no source support');
  const a=moments[m]/count,c=moments[m+1]/count,d=moments[m+2]/count,angle=.5*Math.atan2(2*c,a-d),co=Math.cos(angle),si=Math.sin(angle);
  const delta=Math.hypot(a-d,2*c),variance=radius*radius*.25;
  for(let axis=0;axis<3;axis++){out[k+axis]=co*frames[b+axis]+si*frames[b+3+axis];out[k+4+axis]=-si*frames[b+axis]+co*frames[b+3+axis];}
  out[k+3]=Math.sqrt(Math.max(0,(a+d+delta)*.5)+variance);out[k+7]=Math.sqrt(Math.max(0,(a+d-delta)*.5)+variance);
 }
 return triangles===undefined?out:fitTriangleSupport(source,reduced,parent,radius,triangles,frames,out);
}

// Each vertex owns the part of its incident triangles between the edge
// midpoints and the face centre. These cells tile the source surface. Fit their
// union in the retained tangent plane, keeping the retained centre unchanged.
// The renderer clips at 3 sigma: enclose the support THERE, not at 1 sigma.
function fitTriangleSupport(source,reduced,parent,radius,triangles,frames,out){
 if(!(triangles instanceof Uint32Array)||triangles.length%3)throw Error('Invalid triangle indices');
 for(const i of triangles)if(i>=parent.length)throw Error('Triangle index outside source field');
 const n=reduced.length/12,moments=new Float64Array(n*4),incident=new Uint8Array(parent.length),extent=new Float64Array(n);
 function cells(emit){
  for(let t=0;t<triangles.length;t+=3){
   const ids=[triangles[t],triangles[t+1],triangles[t+2]],a=ids[0]*12,b=ids[1]*12,c=ids[2]*12;
   const ax=source[b]-source[a],ay=source[b+1]-source[a+1],az=source[b+2]-source[a+2];
   const bx=source[c]-source[a],by=source[c+1]-source[a+1],bz=source[c+2]-source[a+2];
   const area=Math.hypot(ay*bz-az*by,az*bx-ax*bz,ax*by-ay*bx);
   if(!Number.isFinite(area))throw Error('Nonfinite triangle positions');
   if(!area)continue;
   const cx=(source[a]+source[b]+source[c])/3,cy=(source[a+1]+source[b+1]+source[c+1])/3,cz=(source[a+2]+source[b+2]+source[c+2])/3;
   for(let v=0;v<3;v++){
    const i=ids[v],s=i*12,j=parent[i];incident[i]=1;if(j===0xffffffff)continue;
    emit(j,source[s],source[s+1],source[s+2],area);
    emit(j,cx,cy,cz,area);
    for(const k of [ids[(v+1)%3]*12,ids[(v+2)%3]*12])emit(j,(source[s]+source[k])/2,(source[s+1]+source[k+1])/2,(source[s+2]+source[k+2])/2,area);
   }
  }
  // Unconnected points have no measured surface extent. Preserve their old
  // circular support rather than inventing adjacency to a nearby sheet.
  for(let i=0;i<parent.length;i++)if(!incident[i]&&parent[i]!==0xffffffff){
   const s=i*12,j=parent[i],b=j*6;
   for(let q=0;q<8;q++){
    const u=Math.cos(q*Math.PI/4)*radius*1.5,v=Math.sin(q*Math.PI/4)*radius*1.5;
    emit(j,source[s]+u*frames[b]+v*frames[b+3],source[s+1]+u*frames[b+1]+v*frames[b+4],source[s+2]+u*frames[b+2]+v*frames[b+5],radius*radius);
   }
  }
 }
 cells((j,x,y,z,w)=>{
  const b=j*6,k=j*12,m=j*4,dx=x-reduced[k],dy=y-reduced[k+1],dz=z-reduced[k+2];
  const u=dx*frames[b]+dy*frames[b+1]+dz*frames[b+2],v=dx*frames[b+3]+dy*frames[b+4]+dz*frames[b+5];
  moments[m]+=w*u*u;moments[m+1]+=w*u*v;moments[m+2]+=w*v*v;moments[m+3]+=w;
 });
 for(let j=0;j<n;j++){
  const m=j*4,b=j*6,k=j*8,w=moments[m+3],a=moments[m]/w,c=moments[m+1]/w,d=moments[m+2]/w;
  const angle=.5*Math.atan2(2*c,a-d),co=Math.cos(angle),si=Math.sin(angle),delta=Math.hypot(a-d,2*c);
  for(let axis=0;axis<3;axis++){out[k+axis]=co*frames[b+axis]+si*frames[b+3+axis];out[k+4+axis]=-si*frames[b+axis]+co*frames[b+3+axis];}
  // Only a numerical rank floor; it does not impose a voxel-sized minor axis.
  const floor=Math.max(radius*radius,a+d)*1e-12;
  out[k+3]=Math.sqrt(Math.max(floor,(a+d+delta)*.5));out[k+7]=Math.sqrt(Math.max(floor,(a+d-delta)*.5));
 }
 cells((j,x,y,z)=>{
  const k=j*8,s=j*12,dx=x-reduced[s],dy=y-reduced[s+1],dz=z-reduced[s+2];
  const u=(dx*out[k]+dy*out[k+1]+dz*out[k+2])/out[k+3],v=(dx*out[k+4]+dy*out[k+5]+dz*out[k+6])/out[k+7];
  extent[j]=Math.max(extent[j],Math.hypot(u,v));
 });
 for(let j=0;j<n;j++){const k=j*8,scale=extent[j]*(1+1e-6)/3;out[k+3]*=scale;out[k+7]*=scale;}
 return out;
}
