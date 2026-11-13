export const CARRIER_DEFORMATION_WGSL = /* wgsl */`
fn carrierDeformation(previous:mat3x3<f32>,gradient:mat3x3<f32>,dt:f32,rotation:f32,strain:f32,relaxation:f32)->mat3x3<f32>{
 let identity=mat3x3<f32>(vec3<f32>(1,0,0),vec3<f32>(0,1,0),vec3<f32>(0,0,1));
 let transposed=transpose(gradient);
 let a=((gradient-transposed)*(.5*rotation)+(gradient+transposed)*(.5*strain))*dt;
 let largest=max(abs(a[0]),max(abs(a[1]),abs(a[2])));
 let norm=max(largest.x,max(largest.y,largest.z));
 // The exponent field bounds scaling by the f32 format itself, including
 // nonfinite inputs; an overflow must never turn into a billion-iteration loop.
 let squarings=u32(max(0,i32((bitcast<u32>(norm)>>23u)&255u)-123));
 let h=a*exp2(-f32(squarings));let h2=h*h;
 var flow=identity+h+h2*.5+(h2*h)*(1.0/6.0)+(h2*h2)*(1.0/24.0);
 for(var i=0u;i<squarings;i++){flow=flow*flow;}
 let deformed=flow*previous;let retain=exp(-relaxation*dt);
 return deformed*retain+identity*(1.0-retain);
}
fn carrierProjectedAxes(vp:mat4x4<f32>,point:vec3<f32>,axes:mat3x3<f32>,size:vec2<f32>)->vec3<f32>{
 let center=vp*vec4<f32>(point,1);var sum=vec3<f32>(0);
 for(var a=0u;a<3u;a++){
  let delta=vp*vec4<f32>(axes[a],0);
  let v=(delta.xy*center.w-center.xy*delta.w)/(center.w*center.w)*size*.5;
  sum+=vec3<f32>(v.x*v.x,v.y*v.y,v.x*v.y);
 }return sum;
}
`;
