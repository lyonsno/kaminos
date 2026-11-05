export function validateRestArc(arc){
  if(!arc||!Array.isArray(arc.center)||arc.center.length!==2||!arc.center.every(Number.isFinite)||
    ![arc.radius,arc.start,arc.sweep].every(Number.isFinite)||arc.radius<=0||arc.sweep<=0||arc.sweep>180)
    throw Error('Rest arc requires a finite X/Z center, positive radius and a sweep in (0, 180] degrees');
  return arc;
}

// In the declared axis frame, a circular middle joins two tangent extensions.
// A straight leg is projected along its tangent, not clamped onto an end ring.
export function unwrapRestArc(positions,normals,arc){
  validateRestArc(arc);
  const {center,radius}=arc,start=arc.start*Math.PI/180,sweep=arc.sweep*Math.PI/180,end=start+sweep;
  const frame=(angle,s)=>({s,x:center[0]+radius*Math.sin(angle),z:center[1]+radius*Math.cos(angle),
    nx:-Math.sin(angle),nz:-Math.cos(angle),tx:Math.cos(angle),tz:-Math.sin(angle)});
  const first=frame(start,0),last=frame(end,radius*sweep),out=new Float32Array(positions.length),n=new Float32Array(normals.length),restAxial=new Float32Array(positions.length/3);
  for(let i=0;i<positions.length;i+=3){
    const x=positions[i],z=positions[i+2],dx=x-center[0],dz=z-center[1],distance=Math.hypot(dx,dz),candidates=[];
    if(distance===0)throw Error('Rest arc reaches its center; choose another fit');
    const middle=start+sweep/2,angle=middle+Math.atan2(Math.sin(Math.atan2(dx,dz)-middle),Math.cos(Math.atan2(dx,dz)-middle));
    if(angle>=start&&angle<=end)candidates.push({...frame(angle,radius*(angle-start)),curvature:1/radius});
    for(const [endpoint,before]of [[first,true],[last,false]]){
      const t=(x-endpoint.x)*endpoint.tx+(z-endpoint.z)*endpoint.tz;
      if(before?t<=0:t>=0)candidates.push({...endpoint,s:endpoint.s+t,x:endpoint.x+t*endpoint.tx,z:endpoint.z+t*endpoint.tz,curvature:0});
    }
    candidates.sort((a,b)=>Math.hypot(x-a.x,z-a.z)-Math.hypot(x-b.x,z-b.z));
    const q=candidates[0];if(!q)throw Error('Source is outside the rest arc projection');
    const u=(x-q.x)*q.nx+(z-q.z)*q.nz,factor=1-q.curvature*u;
    if(factor<=0)throw Error('Rest arc cross-section reaches its center; choose another fit');
    restAxial[i/3]=factor;
    out.set([u,positions[i+1],q.s],i);
    // Pull the source normal through the rest-path Jacobian before the target
    // warp transports it forward. Rotation alone loses axial strain.
    const normal=[normals[i]*q.nx+normals[i+2]*q.nz,normals[i+1],factor*(normals[i]*q.tx+normals[i+2]*q.tz)],length=Math.hypot(...normal);
    n.set(length?normal.map(v=>v/length):normal,i);
  }
  return {positions:out,normals:n,restAxial};
}
