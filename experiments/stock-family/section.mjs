import {recoverStockProfile,validateProfileRecovery} from './profile.mjs';
const finiteVector=(v,n)=>Array.isArray(v)&&v.length===n&&v.every(Number.isFinite);
const transformed=(m,v)=>[m[0]*v[0]+m[1]*v[1],m[2]*v[0]+m[3]*v[1]];
const dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];

export function validateSectionRecovery(value){
  if(value?.schema==='kaminos.stock-profile.v1')return validateProfileRecovery(value);
  if(value?.schema!=='kaminos.stock-section.v1'||!Array.isArray(value.observations)||!value.observations.length)
    throw Error('Measured section observations are required');
  const target=value.nominal;
  if(!target||!finiteVector(target.center,2)||!Number.isFinite(target.innerRadius)||!Number.isFinite(target.outerRadius)||
    target.innerRadius<=0||target.outerRadius<=target.innerRadius)throw Error('Positive ordered nominal radii and wall thickness are required');
  if(value.outside!==undefined&&!['refuse','hold'].includes(value.outside))throw Error('Unknown section observation continuation');
  let previous=-Infinity;
  for(const row of value.observations){
    if(!Number.isFinite(row.station)||row.station<=previous)throw Error('Section observation stations must be strictly ordered');
    previous=row.station;
    for(const name of ['inner','outer']){
      const feature=row[name],m=feature?.linear;
      if(!finiteVector(feature?.center,2)||!finiteVector(m,4)||m[0]<=0||m[3]<=0||m[0]*m[3]-m[1]*m[2]<=0||Math.abs(m[1]-m[2])>1e-8)
        throw Error('Observed ellipse requires a finite positive symmetric whitening matrix');
    }
  }
  return value;
}

function interpolate(observations,station){
  let i=observations.findIndex(row=>row.station>station);
  if(i<0)return observations.at(-1);
  if(i===0)return observations[0];
  const a=observations[i-1],b=observations[i],t=(station-a.station)/(b.station-a.station),result={};
  for(const key of ['inner','outer'])result[key]={
    center:a[key].center.map((v,k)=>v+(b[key].center[k]-v)*t),
    linear:a[key].linear.map((v,k)=>v+(b[key].linear[k]-v)*t),
  };
  return result;
}

// The producer supplies the same unit-circle whitening matrices returned by
// the known-bore ellipse fitter. Inner and outer observations remain distinct.
export function sectionPoint(point,recovery){
  const observed=interpolate(recovery.observations,point[2]),target=recovery.nominal;
  const d=[point[0]-observed.inner.center[0],point[1]-observed.inner.center[1]],r=Math.hypot(...d);
  if(!(r>0))throw Error('Section surface reaches the observed hollow center');
  const direction=d.map(v=>v/r),inner=transformed(observed.inner.linear,direction),innerRadius=1/Math.hypot(...inner);
  const relative=observed.inner.center.map((v,k)=>v-observed.outer.center[k]),origin=transformed(observed.outer.linear,relative),ray=transformed(observed.outer.linear,direction);
  const a=dot(ray,ray),b=2*dot(origin,ray),c=dot(origin,origin)-1,discriminant=b*b-4*a*c;
  if(!(c<0&&discriminant>0))throw Error('Observed inner center is outside its outer section');
  const outerRadius=(-b+Math.sqrt(discriminant))/(2*a);
  if(!(outerRadius>innerRadius))throw Error('Observed inner and outer sections cross');
  const fraction=(r-innerRadius)/(outerRadius-innerRadius),radius=target.innerRadius+fraction*(target.outerRadius-target.innerRadius),angle=transformed(observed.inner.linear,d),length=Math.hypot(...angle);
  if(!(radius>0))throw Error('Section correction crosses the authored hollow center');
  return [target.center[0]+radius*angle[0]/length,target.center[1]+radius*angle[1]/length,point[2]];
}

export function recoverStockSection(value,recovery){
  if(recovery?.schema==='kaminos.stock-profile.v1')return recoverStockProfile(value,recovery);
  validateSectionRecovery(recovery);
  const positions=value.positions,normals=value.normals,out=new Float32Array(positions.length),normal=new Float32Array(normals.length);
  let lo=Infinity,hi=-Infinity,minDeterminant=Infinity,maxDeterminant=-Infinity;
  const first=recovery.observations[0].station,last=recovery.observations.at(-1).station;
  for(let i=0;i<positions.length;i+=3){
    const p=Array.from(positions.subarray(i,i+3));
    if(recovery.outside!=='hold'&&(p[2]<first-1e-7||p[2]>last+1e-7))throw Error('Source geometry is outside observed section stations');
    const q=sectionPoint(p,recovery),columns=[];
    for(let axis=0;axis<3;axis++){
      const h=1e-5*Math.max(1,Math.abs(p[axis])),a=[...p],b=[...p];a[axis]+=h;b[axis]-=h;
      const qa=sectionPoint(a,recovery),qb=sectionPoint(b,recovery);columns.push(qa.map((v,k)=>(v-qb[k])/(2*h)));
    }
    const cofactors=[cross(columns[1],columns[2]),cross(columns[2],columns[0]),cross(columns[0],columns[1])],determinant=dot(columns[0],cofactors[0]);
    if(!Number.isFinite(determinant)||determinant<=0)throw Error('Section correction reverses or collapses the surface neighborhood');
    const n=[0,1,2].map(k=>(cofactors[0][k]*normals[i]+cofactors[1][k]*normals[i+1]+cofactors[2][k]*normals[i+2])/determinant),length=Math.hypot(...n);
    out.set(q,i);normal.set(length?n.map(v=>v/length):n,i);lo=Math.min(lo,q[0]);hi=Math.max(hi,q[0]);
    minDeterminant=Math.min(minDeterminant,determinant);maxDeterminant=Math.max(maxDeterminant,determinant);
  }
  return {...value,positions:out,normals:normal,profile:{...value.profile,xMin:Math.fround(lo),xMax:Math.fround(hi)},
    sectionRecovery:{minJacobianDeterminant:minDeterminant,maxJacobianDeterminant:maxDeterminant,observationCount:recovery.observations.length}};
}
