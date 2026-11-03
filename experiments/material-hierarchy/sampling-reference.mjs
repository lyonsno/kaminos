// Exact sampler from Kaminos 8a2c8e180ac2303be053a461a0e8c0b8e3a016a4.
// Shares unchanged leafAt/localIndex; isolates the same-brick optimization.
export const samplingReference=`fn referenceNearestGas(p:vec3<f32>)->Gas{
 let slot=leafAt(p);if(slot==0xffffffffu){return Gas(vec4<f32>(0,0,0,u.reactant_combustion_c.z),vec4<f32>(0));}
 let n=bricks[slot];let c=vec3<u32>(clamp(floor((p-n.loPitch.xyz)/n.loPitch.w),vec3<f32>(0),vec3<f32>(3)));
 return hin[slot*64u+localIndex(c)];
}
fn referenceHierarchyGas(p:vec3<f32>)->Gas{
 let slot=leafAt(p);if(slot==0xffffffffu){return Gas(vec4<f32>(0,0,0,u.reactant_combustion_c.z),vec4<f32>(0));}
 let n=bricks[slot];let q=(p-n.loPitch.xyz)/n.loPitch.w-.5;let base=floor(q);let f=fract(q);var a=vec4<f32>(0);var b=vec4<f32>(0);
 for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){
  let pos=n.loPitch.xyz+(base+vec3<f32>(f32(x),f32(y),f32(z))+.5)*n.loPitch.w;
  let value=referenceNearestGas(pos);let w=select(1.0-f,f,vec3<bool>(x==1,y==1,z==1));a+=value.a*w.x*w.y*w.z;b+=value.b*w.x*w.y*w.z;
 }}}return Gas(a,b);
}
`;
