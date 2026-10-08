import { Matrix3,Vector3 } from 'three';

const finitePoints=points=>Array.isArray(points)&&points.length&&points.every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite));
const validComponents=(components,n)=>Array.isArray(components)&&components.length===n&&components.every(v=>Number.isInteger(v)&&v>=0);

export function bindComponentAffineField(rest,vertices,{components,component,volumes,radius}={}){
 if(!finitePoints(rest)||!finitePoints(vertices)||!validComponents(components,rest.length)||!Number.isInteger(component)||component<0||!Array.isArray(volumes)||volumes.length!==rest.length||!volumes.every(v=>Number.isFinite(v)&&v>0)||!(Number.isFinite(radius)&&radius>0))throw new Error('Explicit component, volumes and physical support radius required');
 const entries=vertices.map((vertex,index)=>{
  const point=new Vector3(...vertex),samples=[];let weightSum=0;const center=new Vector3();
  rest.forEach((position,node)=>{if(components[node]!==component)return;const p=new Vector3(...position),distance=p.distanceTo(point);if(distance>=radius)return;const weight=volumes[node]*(1-(distance/radius)**2)**2;samples.push({node,p,weight,distance});weightSum+=weight;center.addScaledVector(p,weight);});
  if(samples.length<4||!(weightSum>0))throw new Error(`Cut surface vertex ${index} has insufficient component support`);
  center.multiplyScalar(1/weightSum);const moment=Array(9).fill(0);
  for(const sample of samples){const d=sample.p.clone().sub(center).toArray();for(let row=0;row<3;row++)for(let col=0;col<3;col++)moment[row*3+col]+=sample.weight*d[row]*d[col];}
  const scale=(moment[0]+moment[4]+moment[8])/3;if(!(scale>0))throw new Error(`Cut surface vertex ${index} has rank-deficient component support`);
  const matrix=new Matrix3().set(...moment).multiplyScalar(1/scale),rankMeasure=matrix.determinant();
  if(!(rankMeasure>1e-12))throw new Error(`Cut surface vertex ${index} has rank-deficient component support`);
  const direction=point.clone().sub(center).applyMatrix3(matrix.invert().multiplyScalar(1/scale));
  const weights=samples.map(sample=>sample.weight/weightSum+sample.weight*sample.p.clone().sub(center).dot(direction));
  const reproduced=new Vector3();samples.forEach((sample,i)=>reproduced.addScaledVector(sample.p,weights[i]));
  const reproductionError=Math.max(reproduced.distanceTo(point),Math.abs(weights.reduce((a,b)=>a+b,0)-1));
  if(reproductionError>1e-10*Math.max(1,radius))throw new Error(`Cut surface vertex ${index} affine correspondence is numerically unresolved`);
  return{ids:samples.map(s=>s.node),weights,rankMeasure,reproductionError,weightL1:weights.reduce((sum,w)=>sum+Math.abs(w),0),nearestDistance:Math.min(...samples.map(s=>s.distance)),point:[...vertex]};
 });
 return{route:'kaminos.deformable-surface.component-affine-reconstruction.v0',points:rest.length,component,radius,entries,maxWeightL1:Math.max(...entries.map(e=>e.weightL1)),maxNearestDistance:Math.max(...entries.map(e=>e.nearestDistance)),claim:'Component-owned finite-support affine kinematic reconstruction, including boundary extrapolation; no added mechanics or mesher-envelope admission'};
}

export function applyComponentAffineField(binding,current,{components}={}){
 if(binding?.route!=='kaminos.deformable-surface.component-affine-reconstruction.v0'||!finitePoints(current)||current.length!==binding.points||!validComponents(components,current.length))throw new Error('Matching current component field required');
 return binding.entries.map(entry=>{
  if(entry.ids.some(node=>components[node]!==binding.component))throw new Error('Affine support crossed or changed material component; reconstruct after fracture');
  const position=new Vector3();entry.ids.forEach((node,i)=>position.addScaledVector(new Vector3(...current[node]),entry.weights[i]));
  if(!position.toArray().every(Number.isFinite))throw new Error('Nonfinite reconstructed surface');return position.toArray();
 });
}
