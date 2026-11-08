// The dense field complements the coarse glossy field. Footprints are measured
// in display pixels, so lowering glossy resolution does not lower sharp detail.
export const SCENE_REFLECTION_ALLOCATION_WGSL=/* wgsl */`
fn reflectionDetailWeight(roughness:f32,distance:f32,p:vec3<f32>,n:vec3<f32>,projection:mat4x4<f32>,dimensions:vec2<f32>,coarseSize:vec2<f32>,normalVariation:f32)->f32{
 let nv=max(abs(dot(normalize(-p),n)),.2);
 let focal=max(abs(projection[0][0])*dimensions.x,abs(projection[1][1])*dimensions.y)*.5;
 // GGX alpha is perceptual roughness squared. Unknown hit distance uses the
 // receiver distance; a missing coarse hit must not disable mirror tracing.
 let travel=select(abs(p.z),distance,distance>0.0);
 let radius=2.0*roughness*roughness*travel*focal/max(abs(p.z)*nv,.00001);
 let coarsePixel=max(dimensions.x/coarseSize.x,dimensions.y/coarseSize.y);
 let narrow=1.0-smoothstep(.75,1.5,radius/coarsePixel);
 let curved=smoothstep(.01,.08,normalVariation)*(1.0-smoothstep(.2,.4,roughness));
 return max(narrow,curved);
}
fn reflectionAllocationAt(coords:vec2<f32>,depthMap:texture_depth_2d,normalMap:texture_2d<f32>,coarseStats:texture_2d<f32>,projection:mat4x4<f32>,inverseProjection:mat4x4<f32>)->f32{
 let dimensions=vec2<i32>(textureDimensions(depthMap));let coarseSize=vec2<i32>(textureDimensions(coarseStats));
 let pixel=clamp(vec2<i32>(coords*vec2<f32>(dimensions)),vec2<i32>(0),dimensions-vec2<i32>(1));
 let d=textureLoad(depthMap,pixel,0);let nr=textureLoad(normalMap,pixel,0);if(d>=1.0||dot(nr.xyz,nr.xyz)<.5){return 0.0;}
 let cell=clamp(vec2<i32>(coords*vec2<f32>(coarseSize)),vec2<i32>(0),coarseSize-vec2<i32>(1));
 let distance=max(0.0,exp2(textureLoad(coarseStats,cell,0).r)-1.0);
 var variation=0.0;let offsets=array<vec2<i32>,4>(vec2<i32>(1,0),vec2<i32>(-1,0),vec2<i32>(0,1),vec2<i32>(0,-1));
 for(var i=0u;i<4u;i++){
  let q=clamp((vec2<f32>(cell+offsets[i])+.5)/vec2<f32>(coarseSize),vec2<f32>(0.0),vec2<f32>(1.0));
  let qp=clamp(vec2<i32>(q*vec2<f32>(dimensions)),vec2<i32>(0),dimensions-vec2<i32>(1));let neighbor=textureLoad(normalMap,qp,0);
  variation=max(variation,1.0-max(dot(nr.xyz,neighbor.xyz),0.0));
 }
 let clip=inverseProjection*vec4<f32>(coords.x*2.0-1.0,1.0-coords.y*2.0,d,1.0);
 return reflectionDetailWeight(nr.w,distance,clip.xyz/clip.w,normalize(nr.xyz),projection,vec2<f32>(dimensions),vec2<f32>(coarseSize),variation);
}
`;
