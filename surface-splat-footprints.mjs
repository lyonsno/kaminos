// Covariance of each retained group's original points in its tangent plane.
// Layout: unit tangent U.xyz, sigmaU, unit tangent V.xyz, sigmaV. Centres/materials stay unchanged.
export function fitSurfaceFootprints(source,reduced,parent,radius){
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
  const j=parent[i];if(j>=n)throw Error('Parent outside retained field');
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
 return out;
}
