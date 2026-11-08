// Walk actual receiving cells. Empty coarse air costs boundary crossings, not
// samples at the globally finest pitch. Integer boundary updates guarantee
// progress without an epsilon that could jump a thin fine receiver.
export const hierarchyTraceWGSL=`
var<private> ash_trace_visits:u32;
fn ash_trace_segment(startPoint:vec3<f32>,endPoint:vec3<f32>)->vec4<i32>{
 let a=(startPoint-p.origin.xyz)/p.origin.w;let delta=(endPoint-startPoint)/p.origin.w;
 var t=0.0;var q=vec3<i32>(floor(a));ash_trace_visits=0u;
 if(q.y>=i32(p.dims.y)){
  if(delta.y>=0.0){return vec4<i32>(0);}
  t=(f32(p.dims.y)-a.y)/delta.y;if(t>1.0){return vec4<i32>(0);}
  q=vec3<i32>(floor(a+delta*t));q.y=i32(p.dims.y)-1;
 }
 loop{
  if(t>1.0){break;}
  if(q.y<0){return vec4<i32>(q.x,0,q.z,1);}
  if(any(q<vec3<i32>(0))||any(q>=vec3<i32>(p.dims.xyz))){break;}
  let j=index(vec3<u32>(q));let c=ash_cell(j);ash_trace_visits++;
  if(solid[j]!=0u){return vec4<i32>(q.x,c.lower.y+i32(c.size),q.z,1);}
  if(bitcast<f32>(atomicLoad(&density[j]))>0.0){return vec4<i32>(q,1);}
  var boundary=vec3<f32>(3.402823e38);
  for(var axis=0u;axis<3u;axis++){
   if(delta[axis]!=0.0){let edge=f32(c.lower[axis])+select(0.0,f32(c.size),delta[axis]>0.0);boundary[axis]=(edge-a[axis])/delta[axis];}
  }
  let next=min(boundary.x,min(boundary.y,boundary.z));if(next>1.0){break;}
  // The other axes may round onto a face we already crossed. Keep them in
  // this cell; only an axis whose boundary we reached may leave it.
  var nextQ=clamp(vec3<i32>(floor(a+delta*next)),c.lower,c.lower+vec3<i32>(i32(c.size)-1));
  for(var axis=0u;axis<3u;axis++){if(boundary[axis]<=next){nextQ[axis]=c.lower[axis]+select(-1,i32(c.size),delta[axis]>0.0);}}
  q=nextQ;t=next;
 }
 return vec4<i32>(0);
}`;
