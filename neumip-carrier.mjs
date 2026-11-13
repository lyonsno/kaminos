import {PlaneGeometry,SphereGeometry,TorusKnotGeometry} from './lib/three.webgpu.js';

export const NEUMIP_CARRIERS=Object.freeze([
 ['flat','Flat patch'],['folded','Folded surface'],['sphere','Sphere'],
 ['sculpted','Sculpted patch'],['looped','Looped tube'],
].map(entry=>Object.freeze(entry)));

// Carrier UVs remain the ordinary material domain. Curvature and UV stretching
// are properties of these meshes, not changes to the learned source geometry.
export function createNeumipCarrier(kind){
 let g;
 if(kind==='flat')g=new PlaneGeometry(2.6,2.6);
 else if(kind==='sphere')g=new SphereGeometry(1,64,48);
 else if(kind==='looped'){
  g=new TorusKnotGeometry(.72,.23,192,32);
  const p=g.attributes.position,uv=g.attributes.uv,n=g.parameters.tubularSegments,m=g.parameters.radialSegments;
  const distance=(a,b)=>Math.hypot(p.getX(a)-p.getX(b),p.getY(a)-p.getY(b),p.getZ(a)-p.getZ(b));
  let along=0,around=0;
  for(let i=0;i<n;i++)for(let j=0;j<=m;j++)along+=distance(i*(m+1)+j,(i+1)*(m+1)+j)/(m+1);
  for(let i=0;i<=n;i++)for(let j=0;j<m;j++)around+=distance(i*(m+1)+j,i*(m+1)+j+1)/(n+1);
  // Match average texel density and keep integer repeats at the closed seam.
  // Local curvature still changes the metric; this is not an isometric chart.
  const repeats=Math.max(1,Math.round(along/around));
  for(let i=0;i<uv.count;i++)uv.setX(i,uv.getX(i)*repeats);
 }
 else if(kind==='folded'||kind==='sculpted'){
  g=new PlaneGeometry(2.6,2.6,96,96);
  const p=g.attributes.position;
  for(let i=0;i<p.count;i++){
   const x=p.getX(i),y=p.getY(i);
   const z=kind==='folded'
    ?.18*Math.sin(6*x+1.2*y)+.12*Math.cos(3*y-2*x)
    :.34*Math.sin(2.4*x)*Math.cos(2.7*y)+.20*Math.sin(4.6*x+1.6*y)
      +.16*Math.exp(-4*(x+.4)**2-8*(y-.1)**2);
   p.setZ(i,z);
  }
  p.needsUpdate=true;g.computeVertexNormals();
 }else throw Error(`Unknown neural material carrier: ${kind}`);
 g.computeTangents();return g;
}
