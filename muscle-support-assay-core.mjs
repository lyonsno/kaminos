// Reversible geometric experiment, not a reproduction of Elastic Implicit
// Skinning or a constitutive muscle solver. Distances are in fixture units.
export const IDENTITY = Object.freeze([0, 0, 0, 1]);
const add = (a,b) => a.map((v,i)=>v+b[i]);
const sub = (a,b) => a.map((v,i)=>v-b[i]);
const mul = (a,s) => a.map(v=>v*s);
const dot = (a,b) => a.reduce((s,v,i)=>s+v*b[i],0);
const norm = a => Math.hypot(...a);
const unit = a => mul(a,1/Math.max(norm(a),1e-12));
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
const smooth = v => {const t=clamp(v,0,1);return t*t*(3-2*t);};
export function rotate(p,q) {
  const t=mul(cross(q.slice(0,3),p),2);
  return add(p,add(mul(t,q[3]),cross(q.slice(0,3),t)));
}
const inverse = q => [-q[0],-q[1],-q[2],q[3]];
function checkedPose(pose) {
  if(!pose || !Array.isArray(pose.quaternion) || pose.quaternion.length!==4 ||
    !pose.quaternion.every(Number.isFinite) || Math.abs(norm(pose.quaternion)-1)>1e-6)
    throw new Error('pose requires a finite unit quaternion');
  if(!Number.isFinite(pose.bulge) || pose.bulge<0 || pose.bulge>0.5)
    throw new Error('bulge must be finite and in the fixture range 0..0.5');
  return {quaternion:[...pose.quaternion],bulge:pose.bulge};
}
export function supportGeometry(pose) {
  checkedPose(pose);
  const origin=[-1.2,0.3,0], insertion=rotate([0.5,0.22,0],pose.quaternion);
  const delta=sub(insertion,origin), length=norm(delta), axis=unit(delta);
  const transverse=unit(cross([0,0,1],axis));
  const normal=unit(cross(axis,transverse));
  // The prescribed spindle conserves its ellipsoid volume as length changes,
  // except explicit bulge input, which intentionally increases volume.
  const restLength=norm(sub([0.5,0.22,0],origin));
  const radius=0.34*Math.sqrt(restLength/length)*(1+pose.bulge);
  return {origin,insertion,center:mul(add(origin,insertion),0.5),axis,transverse,normal,
    length,radius,lowerEnd:rotate([1.5,0,0],pose.quaternion)};
}
function capsule(p,a,b,r) {
  const delta=sub(b,a),t=clamp(dot(sub(p,a),delta)/dot(delta,delta),0,1);
  return norm(sub(p,add(a,mul(delta,t))))-r;
}
function valueAt(p,pose,support) {
  const local=sub(p,support.center);
  const axes=[support.length/2,support.radius,support.radius*0.88];
  const components=[dot(local,support.axis),dot(local,support.transverse),dot(local,support.normal)];
  const k0=Math.hypot(...components.map((v,i)=>v/axes[i]));
  const k1=Math.hypot(...components.map((v,i)=>v/(axes[i]*axes[i])));
  // Approximate ellipsoid distance. Iso-value tracking is the contract;
  // Euclidean skin thickness is measured separately, not asserted here.
  const muscle=k1<1e-12 ? -Math.min(...axes) : k0*(k0-1)/k1;
  const values=[capsule(p,[-1.5,0,0],[0,0,0],0.18),capsule(p,[0,0,0],support.lowerEnd,0.16),muscle];
  const minimum=Math.min(...values),blend=0.045;
  return minimum-blend*Math.log(values.reduce((s,v)=>s+Math.exp(-(v-minimum)/blend),0));
}
export function field(p,pose) {return valueAt(p,checkedPose(pose),supportGeometry(pose));}
export function boneField(p,pose) {
  checkedPose(pose);
  return Math.min(capsule(p,[-1.5,0,0],[0,0,0],0.18),capsule(p,[0,0,0],rotate([1.5,0,0],pose.quaternion),0.16));
}
function gradient(p,pose,support) {
  const h=1e-4;
  return [0,1,2].map(axis=>{
    const a=[...p],b=[...p];a[axis]+=h;b[axis]-=h;
    return (valueAt(a,pose,support)-valueAt(b,pose,support))/(2*h);
  });
}
function project(p,target,pose,support) {
  let result=[...p];
  for(let i=0;i<12;i++) {
    const error=valueAt(result,pose,support)-target;
    if(Math.abs(error)<1e-6) break;
    const g=gradient(result,pose,support),denom=dot(g,g);
    if(denom<1e-10) break;
    const displacement=mul(g,error/denom);
    result=sub(result,mul(displacement,Math.min(1,0.1/Math.max(norm(displacement),1e-12))));
  }
  return result;
}
export function createFixture({rings=33,sides=32}={}) {
  if(!Number.isInteger(rings)||!Number.isInteger(sides)||rings<5||sides<8) throw new Error('fixture rings/sides invalid');
  const positions=[],indices=[],edges=[],weights=[],restValues=[];
  const pose={quaternion:[...IDENTITY],bulge:0},support=supportGeometry(pose);
  for(let r=0;r<rings;r++) {
    const x=-1.4+2.8*r/(rings-1);
    for(let s=0;s<sides;s++) {
      const theta=2*Math.PI*s/sides;
      // Asymmetry and an inner-joint dimple are in the skin's own rest shape.
      const target=0.105+0.012*Math.cos(3*theta+0.8*x)-
        0.035*Math.exp(-((x/0.2)**2))*Math.max(0,Math.sin(theta))**8;
      let lo=0,hi=1.5;
      for(let i=0;i<35;i++) {
        const radius=(lo+hi)/2,p=[x,radius*Math.cos(theta),radius*Math.sin(theta)];
        if(valueAt(p,pose,support)<target)lo=radius;else hi=radius;
      }
      const radius=(lo+hi)/2,p=[x,radius*Math.cos(theta),radius*Math.sin(theta)];
      positions.push(...p);restValues.push(valueAt(p,pose,support));
      weights.push(smooth((x+0.3)/0.65));
      const a=r*sides+s,b=r*sides+(s+1)%sides;
      edges.push([a,b]);
      if(r<rings-1) {
        const c=a+sides,d=b+sides;
        indices.push(a,c,b,b,c,d);edges.push([a,c],[b,c]);
      }
    }
  }
  const at=i=>positions.slice(i*3,i*3+3);
  return {rings,sides,positions:new Float64Array(positions),indices,edges,
    restLengths:edges.map(([a,b])=>norm(sub(at(a),at(b)))),weights,restValues,
    source:'procedural-asymmetric-open-sleeve-v1',boundary:'two open ends; transported end rings'};
}
function predict(p,weight,oldPose,newPose) {
  const moved=rotate(rotate(p,inverse(oldPose.quaternion)),newPose.quaternion);
  return add(mul(p,1-weight),mul(moved,weight));
}
export function createTracker(fixture,mode) {
  if(!['transport-field','field-only','bone-blend'].includes(mode))throw new Error('unknown tracker mode');
  const tracker={mode,positions:new Float64Array(fixture.positions),pose:{quaternion:[...IDENTITY],bulge:0},steps:0};
  tracker.step=poseInput=>{
    const pose=checkedPose(poseInput),support=supportGeometry(pose),count=fixture.weights.length;
    const positions=new Float64Array(tracker.positions.length);
    for(let i=0;i<count;i++) {
      const p=Array.from((mode==='bone-blend'?fixture.positions:tracker.positions).slice(i*3,i*3+3));
      const predicted=mode==='field-only'?p:predict(p,fixture.weights[i],mode==='bone-blend'?{quaternion:IDENTITY}:tracker.pose,pose);
      positions.set(mode==='bone-blend'?predicted:project(predicted,fixture.restValues[i],pose,support),i*3);
    }
    if(mode==='transport-field') {
      // Tangential edge-length relaxation; no claim of a full ARAP solve.
      for(let iteration=0;iteration<5;iteration++) {
        const forces=new Float64Array(positions.length),degree=new Uint16Array(count);
        fixture.edges.forEach(([a,b],edge)=>{
          const pa=Array.from(positions.slice(a*3,a*3+3)),pb=Array.from(positions.slice(b*3,b*3+3));
          const d=sub(pb,pa),length=norm(d),force=mul(d,0.35*(length-fixture.restLengths[edge])/Math.max(length,1e-12));
          for(let axis=0;axis<3;axis++){forces[a*3+axis]+=force[axis];forces[b*3+axis]-=force[axis];}
          degree[a]++;degree[b]++;
        });
        for(let i=fixture.sides;i<count-fixture.sides;i++) {
          let p=Array.from(positions.slice(i*3,i*3+3));
          const g=gradient(p,pose,support),force=mul(Array.from(forces.slice(i*3,i*3+3)),1/degree[i]);
          const tangent=sub(force,mul(g,dot(force,g)/Math.max(dot(g,g),1e-12)));
          p=project(add(p,tangent),fixture.restValues[i],pose,support);positions.set(p,i*3);
        }
      }
    }
    tracker.positions=positions;tracker.pose=pose;tracker.steps++;
    return positions;
  };
  return tracker;
}
export function diagnostics(fixture,positions,pose) {
  checkedPose(pose);
  const support=supportGeometry(pose),errors=[],stretches=[];
  let displacement2=0,maxDisplacement=0;
  for(let i=0;i<fixture.weights.length;i++) {
    const p=Array.from(positions.slice(i*3,i*3+3)),rest=Array.from(fixture.positions.slice(i*3,i*3+3));
    if(!p.every(Number.isFinite)) throw new Error('non-finite skin geometry');
    errors.push(Math.abs(valueAt(p,pose,support)-fixture.restValues[i]));
    const displacement=norm(sub(p,rest));displacement2+=displacement*displacement;maxDisplacement=Math.max(maxDisplacement,displacement);
  }
  fixture.edges.forEach(([a,b],i)=>stretches.push(norm(sub(Array.from(positions.slice(a*3,a*3+3)),Array.from(positions.slice(b*3,b*3+3))))/fixture.restLengths[i]));
  return {fieldErrorMax:Math.max(...errors),fieldErrorMean:errors.reduce((a,b)=>a+b,0)/errors.length,
    edgeRatioMin:Math.min(...stretches),edgeRatioMax:Math.max(...stretches),
    displacementRms:Math.sqrt(displacement2/fixture.weights.length),displacementMax:maxDisplacement};
}
