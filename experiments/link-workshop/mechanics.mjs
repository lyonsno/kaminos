import {checkedMechanism,frames,pistonMountPoint} from './model.mjs';

// Reduced planar mechanics: authored effective hinge inertias, spring/damper
// cylinders and compliant stroke stops. Rigid link lengths are coordinates,
// not penalties. All actuator and hand rows share one implicit velocity solve.
// No pressure state, dense global matrix, mesh sampling or GPU readback.
const dot=(a,b)=>{let s=0;for(let i=0;i<a.length;i++)s+=a[i]*b[i];return s;};
const rowDot=(row,v)=>{let s=0;for(const [i,j]of row.entries)s+=j*v[i];return s;};
const addRow=(v,row,k)=>{for(const [i,j]of row.entries)v[i]+=j*k;};
function world(m,q){
 const p=[],a=[];for(let i=0;i<m.nodes.length;i++){const n=m.nodes[i];if(n.parent===null){p.push(n.point);a.push(0);}else{const angle=a[n.parent]+q[i],o=p[n.parent];p.push([o[0]+n.length*Math.cos(angle),o[1]+n.length*Math.sin(angle)]);a.push(angle);}}return {p,a};
}
function at(m,w,id,offset){if(!offset)return w.p[id];const n=m.nodes[id],o=n.parent===null?w.p[id]:w.p[n.parent],angle=w.a[id];return [o[0]+Math.cos(angle)*offset[0]-Math.sin(angle)*offset[1],o[1]+Math.sin(angle)*offset[0]+Math.cos(angle)*offset[1]];}
function differential(m,w,p,depth){
 const a=at(m,w,p.a,p.aOffset),b=at(m,w,p.b,p.bOffset),dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy),u=length?[dx/length,dy/length]:[0,0],entries=[];
 let ia=p.a,ib=p.b;
 // Common ancestors rotate both mounts rigidly; their length derivative is
 // exactly zero. Walk only the two paths below their lowest common ancestor.
 while(ia!==ib){const da=ia<0?-1:depth[ia],db=ib<0?-1:depth[ib],side=da>=db?'a':'b',id=side==='a'?ia:ib,n=m.nodes[id];
  if(n.parent!==null){const point=side==='a'?a:b,o=w.p[n.parent],sign=side==='a'?-1:1;entries.push([id,sign*(-(point[1]-o[1])*u[0]+(point[0]-o[0])*u[1])]);}
  const parent=n.parent??-1;if(side==='a')ia=parent;else ib=parent;
 }
 return {length,entries};
}
const depths=m=>m.nodes.reduce((out,n)=>{out.push(n.parent===null?0:out[n.parent]+1);return out;},[]);
export function pistonDifferential(value,angles,piston){const m=checkedMechanism(value);if(angles.length!==m.nodes.length||!angles.every(Number.isFinite))throw Error('Finite mechanical angles required');return differential(m,world(m,angles),piston,depths(m));}

export function freezeMechanicalHardware(value,travel,{fraction=0}={}){
 const m=checkedMechanism(value);if(m.mountPistons?.length)throw Error('Force-aware dragging currently requires pistons between this planar mechanism’s bodies; separate object-mounted pistons need body coordinates');
 if(!Array.isArray(travel)||travel.length!==m.pistons.length)throw Error('Every cylinder needs its current constructed hardware');
 const f=frames(m,fraction);
 m.pistons=m.pistons.map((p,i)=>{if(p.mechanics)return p;const range=travel[i],a=pistonMountPoint(m,f,p.a,p.aOffset),b=pistonMountPoint(m,f,p.b,p.bOffset),restLength=Math.hypot(b[0]-a[0],b[1]-a[1]);return {...p,mechanics:{barrelLength:range.barrel,rodLength:range.rod,minLength:Math.min(range.min,restLength),maxLength:Math.max(range.max,restLength),restLength,stiffness:600,damping:35,stopStiffness:1e6,mode:'hold'}};});
 m.mechanics={handStiffness:1200,handDamping:35,jointDamping:.5,...m.mechanics,enabled:true};return checkedMechanism(m);
}

function solveVelocity(mass,rows,rhs,previous,damping,dt,dofs){
 const n=rhs.length,x=Float64Array.from(previous),diag=Float64Array.from(mass,v=>v+dt*damping),r=new Float64Array(n),z=new Float64Array(n),p=new Float64Array(n),ap=new Float64Array(n);
 for(const row of rows)for(const [i,j]of row.entries)diag[i]+=row.weight*j*j;
 const multiply=(input,out)=>{for(let i=0;i<n;i++)out[i]=(mass[i]+dt*damping)*input[i];for(const row of rows)addRow(out,row,row.weight*rowDot(row,input));};
 multiply(x,ap);for(let i=0;i<n;i++){r[i]=rhs[i]-ap[i];z[i]=r[i]/diag[i];p[i]=z[i];}
 const tolerance=1e-10*Math.max(1,Math.sqrt(dot(rhs,rhs)));let rz=dot(r,z),residual=Math.sqrt(dot(r,r)),iterations=0;
 // In exact arithmetic CG terminates in the number of moving coordinates.
 // Report the actual residual if floating point does not achieve tolerance;
 // never call an unfinished linear solve converged.
 while(residual>tolerance&&iterations<dofs){multiply(p,ap);const pap=dot(p,ap);if(!(pap>0)||!Number.isFinite(pap))throw Error('Mechanical system exceeds finite positive solver range');const alpha=rz/pap;
  for(let i=0;i<n;i++){x[i]+=alpha*p[i];r[i]-=alpha*ap[i];}iterations++;residual=Math.sqrt(dot(r,r));if(residual<=tolerance)break;
  for(let i=0;i<n;i++)z[i]=r[i]/diag[i];const next=dot(r,z),beta=next/rz;for(let i=0;i<n;i++)p[i]=z[i]+beta*p[i];rz=next;
 }
 if(!x.every(Number.isFinite)||!Number.isFinite(residual))throw Error('Mechanical system exceeds finite solver range');
 return {velocity:x,iterations,linearResidual:residual,converged:residual<=tolerance};
}

export function createMechanicalSystem(value,{fraction=0,velocities}={}){
 const m=checkedMechanism(value);if(!m.mechanics?.enabled)throw Error('Enable mechanical response and freeze cylinder hardware first');if(m.mountPistons?.length)throw Error('Separate object-mounted pistons need mechanical body coordinates');
 if(m.pistons.some(p=>!p.mechanics))throw Error('Every cylinder needs fixed mechanical hardware');
 const n=m.nodes.length,depth=depths(m),dofs=m.nodes.filter(n=>n.parent!==null).length,mass=Float64Array.from(m.nodes,n=>n.parent===null?1:n.inertia??Math.max(.01,n.length*n.length/3));
 let q=m.nodes.map(n=>n.parent===null?0:n.angles[0]+(n.angles[1]-n.angles[0])*fraction),v=Float64Array.from(velocities??Array(n).fill(0)),last={iterations:0,linearResidual:0,converged:true},grab=null,time=0;
 if(v.length!==n||!v.every(Number.isFinite))throw Error('Finite mechanical velocities required');m.nodes.forEach((node,i)=>{if(node.parent===null)v[i]=0;});
 const settings=m.mechanics;
 function handRows(w,g){const point=w.p[g.joint],x=[],y=[];let id=g.joint;while(m.nodes[id].parent!==null){const o=w.p[m.nodes[id].parent];x.push([id,-(point[1]-o[1])]);y.push([id,point[0]-o[0]]);id=m.nodes[id].parent;}return {point,rows:[{entries:x,error:point[0]-g.target[0]},{entries:y,error:point[1]-g.target[1]}]};}
 function read(){const w=world(m,q),actuators=m.pistons.map((p,index)=>{const row=differential(m,w,p,depth),s=p.mechanics,target=s.mode==='drive'?(s.targetLength??s.restLength):s.restLength,speed=rowDot(row,v),compression=Math.max(0,s.minLength-row.length,row.length-s.maxLength),elastic=s.mode==='free'?0:s.stiffness*(target-row.length)-s.damping*speed;return {index,length:row.length,minLength:s.minLength,maxLength:s.maxLength,mode:s.mode,force:elastic,stopCompression:compression,stopForce:s.stopStiffness*((row.length<s.minLength?s.minLength-row.length:0)-(row.length>s.maxLength?row.length-s.maxLength:0)),barrelLength:s.barrelLength,rodLength:s.rodLength};});
  let hand=null;if(grab){const h=handRows(w,grab),k=grab.stiffness??settings.handStiffness??1200,d=grab.damping??settings.handDamping??35;hand={joint:grab.joint,target:[...grab.target],point:[...h.point],residual:Math.hypot(...h.rows.map(r=>r.error)),force:h.rows.map(r=>-k*r.error-d*rowDot(r,v))};}
  return {angles:[...q],velocities:[...v],points:w.p.map(p=>[...p]),actuators,hand,time,...last,model:'planar joint-coordinate spring/damper mechanics with effective hinge inertias and compliant end stops'};
 }
 function step(dt,{grab:nextGrab=null,targets}={}){
  if(!Number.isFinite(dt)||dt<=0)throw Error('Positive finite mechanical step required');
  if(nextGrab){if(!Number.isInteger(nextGrab.joint)||!m.nodes[nextGrab.joint]||m.nodes[nextGrab.joint].parent===null)throw Error('A fixed anchor cannot be grabbed mechanically');if(nextGrab.target?.length!==2||!nextGrab.target.every(Number.isFinite))throw Error('Finite mechanical hand target required');for(const k of ['stiffness','damping'])if(nextGrab[k]!==undefined&&(!Number.isFinite(nextGrab[k])||nextGrab[k]<0))throw Error('Nonnegative mechanical hand response required');}
  if(targets!==undefined&&(targets.length!==m.pistons.length||!targets.every(Number.isFinite)))throw Error('One finite drive target per cylinder required');
  const w=world(m,q),rows=[],cylinders=[],activeStops=new Set(),rhs=Float64Array.from(v,(velocity,i)=>mass[i]*velocity),add=(row,k,d,error)=>{const weight=dt*d+dt*dt*k;if(weight){rows.push({...row,weight});addRow(rhs,row,-dt*k*error);}};
  const addStop=(i,limit)=>{const {row,s}=cylinders[i];let inverse=0;for(const [id,j]of row.entries)inverse+=j*j/mass[id];const stopDamping=inverse?2*Math.sqrt(s.stopStiffness/inverse):0;add(row,s.stopStiffness,stopDamping,row.length-limit);activeStops.add(i);};
  for(const [i,p]of m.pistons.entries()){const row=differential(m,w,p,depth),s=p.mechanics,target=s.mode==='drive'?(targets?.[i]??s.targetLength??s.restLength):s.restLength;if(s.mode==='drive'&&(target<s.minLength||target>s.maxLength))throw Error('Drive target lies outside the fixed cylinder stroke');
   cylinders.push({row,s});
   if(s.mode!=='free')add(row,s.stiffness,s.damping,row.length-target);
   const predicted=row.length+dt*rowDot(row,v),limit=Math.min(row.length,predicted)<s.minLength?s.minLength:Math.max(row.length,predicted)>s.maxLength?s.maxLength:null;
   if(limit!==null)addStop(i,limit);
  }
  if(nextGrab)for(const row of handRows(w,nextGrab).rows)add(row,nextGrab.stiffness??settings.handStiffness??1200,nextGrab.damping??settings.handDamping??35,row.error);
  let solved,next,iterations=0,stopPasses=0;
  // Acceleration from the hand or another actuator can reach a stop even from
  // rest. Activate contacts against the trial pose, then solve every row again
  // together. The set only grows, so this terminates after at most one added
  // contact per cylinder without imposing a separate iteration cap.
  for(;;){solved=solveVelocity(mass,rows,rhs,v,settings.jointDamping??.5,dt,dofs);iterations+=solved.iterations;next=q.map((angle,i)=>m.nodes[i].parent===null?angle:angle+dt*solved.velocity[i]);if(!next.every(Number.isFinite))throw Error('Mechanical pose exceeds finite solver range');
   const trial=world(m,next);let added=false;for(const [i,p]of m.pistons.entries()){if(activeStops.has(i))continue;const length=differential(m,trial,p,depth).length,s=p.mechanics,limit=length<s.minLength?s.minLength:length>s.maxLength?s.maxLength:null;if(limit!==null){addStop(i,limit);added=true;}}
   if(!added)break;stopPasses++;
  }
  solved.iterations=iterations;solved.stopPasses=stopPasses;
  q=next;v=solved.velocity;last=solved;delete last.velocity;grab=nextGrab?structuredClone(nextGrab):null;time+=dt;return read();
 }
 return {step,read};
}
