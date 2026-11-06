const vector=(v,n)=>Array.isArray(v)&&v.length===n&&v.every(Number.isFinite);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);

export function validateProfileRecovery(value){
  if(value?.schema!=='kaminos.stock-profile.v1'||!Array.isArray(value.observations)||!value.observations.length)throw Error('Nonempty observed profile fields are required');
  if(value.outside!==undefined&&!['hold','refuse'].includes(value.outside))throw Error('Unknown profile continuation');
  let previous=-Infinity;
  for(const {station,field:f}of value.observations){
    if(!Number.isFinite(station)||station<=previous)throw Error('Profile stations must be strictly ordered');
    previous=station;
    if(!f||!vector(f.origin,2)||!Number.isFinite(f.scale)||f.scale<=0||!Array.isArray(f.centers)||!Array.isArray(f.weights)||f.centers.length!==f.weights.length||
      !f.centers.every(p=>vector(p,2))||!f.weights.every(p=>vector(p,2))||!Array.isArray(f.affine)||f.affine.length!==3||!f.affine.every(p=>vector(p,2)))throw Error('Finite matching profile field coefficients are required');
  }
  return value;
}

// Thin-plate displacement, r^2 log(r), with its affine term and analytic
// derivatives. Coefficients come from measured source/target correspondences.
export function evaluateProfileField(field,point){
  const x=(point[0]-field.origin[0])/field.scale,y=(point[1]-field.origin[1])/field.scale;
  const displacement=[0,1].map(k=>field.affine[0][k]+field.affine[1][k]*x+field.affine[2][k]*y);
  const derivative=[field.affine[1].map(v=>v/field.scale),field.affine[2].map(v=>v/field.scale)];
  for(let i=0;i<field.centers.length;i++){
    const dx=x-field.centers[i][0],dy=y-field.centers[i][1],r2=dx*dx+dy*dy;
    if(r2===0)continue;
    const log=Math.log(r2),basis=.5*r2*log,gradient=(log+1)/field.scale;
    for(let k=0;k<2;k++){
      const w=field.weights[i][k];displacement[k]+=w*basis;
      derivative[0][k]+=w*dx*gradient;derivative[1][k]+=w*dy*gradient;
    }
  }
  return {displacement,derivative};
}

export function profilePoint(point,recovery){
  const rows=recovery.observations;
  let index=rows.findIndex(r=>r.station>point[2]);
  const left=index<0?rows.at(-1):index===0?rows[0]:rows[index-1],right=index<=0?left:rows[index];
  const a=evaluateProfileField(left.field,point),b=right===left?a:evaluateProfileField(right.field,point);
  const span=right.station-left.station,t=span?(point[2]-left.station)/span:0;
  const position=[point[0],point[1],point[2]],columns=[[1,0,0],[0,1,0],[0,0,1]];
  for(let k=0;k<2;k++){
    position[k]+=a.displacement[k]+t*(b.displacement[k]-a.displacement[k]);
    for(let axis=0;axis<2;axis++)columns[axis][k]+=a.derivative[axis][k]+t*(b.derivative[axis][k]-a.derivative[axis][k]);
    if(span)columns[2][k]=(b.displacement[k]-a.displacement[k])/span;
  }
  return {position,columns};
}

export function recoverStockProfile(value,recovery){
  validateProfileRecovery(recovery);
  const {positions,normals}=value;
  if(!positions?.length||positions.length%3||positions.length!==normals?.length||!positions.every(Number.isFinite)||!normals.every(Number.isFinite))throw Error('Nonempty finite matching profile surface arrays required');
  const out=new Float32Array(positions.length),normal=new Float32Array(normals.length);
  let lo=Infinity,hi=-Infinity,min=Infinity,max=-Infinity;
  for(let i=0;i<positions.length;i+=3){
    const p=positions.subarray(i,i+3),z=p[2];
    if(recovery.outside!=='hold'&&(z<recovery.observations[0].station-1e-7||z>recovery.observations.at(-1).station+1e-7))throw Error('Source geometry is outside observed profile stations');
    const {position,columns:c}=profilePoint(p,recovery),cof=[cross(c[1],c[2]),cross(c[2],c[0]),cross(c[0],c[1])],det=dot(c[0],cof[0]);
    if(!position.every(Number.isFinite)||!Number.isFinite(det)||det<=0)throw Error('Profile correction reverses or collapses the surface Jacobian');
    const n=[0,1,2].map(k=>(cof[0][k]*normals[i]+cof[1][k]*normals[i+1]+cof[2][k]*normals[i+2])/det),length=Math.hypot(...n);
    out.set(position,i);normal.set(length?n.map(v=>v/length):n,i);
    min=Math.min(min,det);max=Math.max(max,det);lo=Math.min(lo,position[0]);hi=Math.max(hi,position[0]);
  }
  return {...value,positions:out,normals:normal,profile:{...value.profile,xMin:Math.fround(lo),xMax:Math.fround(hi)},
    sectionRecovery:{method:'observed-profile-thin-plate-displacement',minJacobianDeterminant:min,maxJacobianDeterminant:max,observationCount:recovery.observations.length}};
}
