// Fit inside the source hull so the proxy cannot create invisible support.
// Sample the principal bounding-box axis; each radius is the nearest plane.
export function fitSpherePair(solid){
 const vertices=solid.positions;
 const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
 for(let i=0;i<vertices.length;i++){const k=i%3;lo[k]=Math.min(lo[k],vertices[i]);hi[k]=Math.max(hi[k],vertices[i]);}
 const spans=hi.map((v,k)=>v-lo[k]),axis=spans.indexOf(Math.max(...spans));
 const candidates=[];
 for(let i=0;i<=32;i++){
  const p=[0,0,0];p[axis]=lo[axis]+spans[axis]*i/32;
  const r=Math.min(...solid.planes.map(([x,y,z,d])=>d-x*p[0]-y*p[1]-z*p[2]));
  if(r>0)candidates.push([...p,r]);
 }
 let best=null,bestScore=-Infinity;
 for(const a of candidates)for(const b of candidates){
  const d=b[axis]-a[axis],r=a[3],s=b[3];
  if(d<=Math.abs(r-s)+1e-6||d>=r+s-1e-6)continue;
  const lens=(r+s-d)**2*(d*d+2*d*(r+s)-3*(r-s)**2)/(16*d);
  const score=(r**3+s**3-lens)*(d+r+s)/spans[axis];
  if(score>bestScore){best=[a,b];bestScore=score;}
 }
 if(!best)throw Error('Could not fit overlapping collision spheres to source rock');
 return best;
}

export const SPHERE_PAIR_WGSL=`
@group(1) @binding(7) var<storage,read> rockLobes:array<vec4f>;
fn world_lobe(i:u32,k:u32,b:Body)->vec4f{
 let l=rockLobes[2u*i+k];return vec4f(b.p.xyz+rot(b.q,l.xyz),l.w);
}
// For exterior points, min of the two sphere distances is exact. For
// interiors choose the closest radial exit that is exposed on the union.
// If both radial exits are buried, project to the intersection circle.
fn sphere_frame(point:vec3f,b:Body,i:u32)->vec4f{
 let a=world_lobe(i,0u,b);let c=world_lobe(i,1u,b);
 let da=point-a.xyz;let dc=point-c.xyz;
 let la=length(da);let lc=length(dc);
 let na=select(vec3f(0.,1.,0.),da/max(la,1e-12),la>1e-12);
 let nc=select(vec3f(0.,1.,0.),dc/max(lc,1e-12),lc>1e-12);
 let fa=vec4f(na,la-a.w);let fc=vec4f(nc,lc-c.w);
 if(min(fa.w,fc.w)>=0.){return select(fc,fa,fa.w<=fc.w);}
 let aOpen=distance(a.xyz+na*a.w,c.xyz)>=c.w-1e-6;
 let cOpen=distance(c.xyz+nc*c.w,a.xyz)>=a.w-1e-6;
 if(aOpen&&fa.w<=0.&&(!cOpen||fc.w>0.||fa.w>=fc.w)){return fa;}
 if(cOpen&&fc.w<=0.){return fc;}
 let d=distance(a.xyz,c.xyz);let n=(c.xyz-a.xyz)/d;
 let x=(a.w*a.w-c.w*c.w+d*d)/(2.*d);
 let center=a.xyz+n*x;let circle=point-center;
 let radial=circle-n*dot(circle,n);
 let axis=select(vec3f(1.,0.,0.),vec3f(0.,1.,0.),abs(n.x)>.8);
 let dir=select(normalize(cross(n,axis)),radial/max(length(radial),1e-12),length(radial)>1e-12);
 let toward=center+dir*sqrt(max(0.,a.w*a.w-x*x))-point;
 let depth=length(toward);return vec4f(select(dir,toward/max(depth,1e-12),depth>1e-12),-depth);
}
`;
