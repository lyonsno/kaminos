// The dense field complements the coarse glossy field. Footprints are measured
// in display pixels, so lowering glossy resolution does not lower sharp detail.
export const SCENE_REFLECTION_ALLOCATION_WGSL=/* wgsl */`
fn reflectionDetailWeight(roughness:f32,distance:f32,p:vec3<f32>,n:vec3<f32>,projection:mat4x4<f32>,dimensions:vec2<f32>,coarseSize:vec2<f32>,normalVariation:f32)->f32{
 let nv=max(abs(dot(normalize(-p),n)),.2);
 let focal=max(abs(projection[0][0])*dimensions.x,abs(projection[1][1])*dimensions.y)*.5;
 // GGX alpha is perceptual roughness squared. Unknown hit distance uses the
 // receiver distance for broad gloss. Narrow gloss is conservatively traced
 // when the coarse grid has no hit: its miss cannot establish a wide footprint.
 let travel=select(abs(p.z),distance,distance>0.0);
 let radius=2.0*roughness*roughness*travel*focal/max(abs(p.z)*nv,.00001);
 let coarsePixel=max(dimensions.x/coarseSize.x,dimensions.y/coarseSize.y);
 let narrow=1.0-smoothstep(.75,1.5,radius/coarsePixel);
 let curved=smoothstep(.01,.08,normalVariation)*(1.0-smoothstep(.2,.4,roughness));
 let unknown=select(0.0,1.0-smoothstep(.2,.35,roughness),distance<=0.0);
 return max(max(narrow,curved),unknown);
}
fn reflectionAllocationAt(coords:vec2<f32>,depthMap:texture_depth_2d,normalMap:texture_2d<f32>,coarseStats:texture_2d<f32>,projection:mat4x4<f32>,inverseProjection:mat4x4<f32>)->f32{
 let dimensions=vec2<i32>(textureDimensions(depthMap));let coarseSize=vec2<i32>(textureDimensions(coarseStats));
 let pixel=clamp(vec2<i32>(coords*vec2<f32>(dimensions)),vec2<i32>(0),dimensions-vec2<i32>(1));
 let d=textureLoad(depthMap,pixel,0);let nr=textureLoad(normalMap,pixel,0);if(d>=1.0||dot(nr.xyz,nr.xyz)<.5){return 0.0;}
 // Bilinear valid-hit distances avoid stamping coarse-cell boundaries into
 // the dense mask. Missing support is uncertainty, rather than a distant hit.
 let grid=coords*vec2<f32>(coarseSize)-.5;let cell=vec2<i32>(floor(grid));let fraction=fract(grid);
 var distanceSum=0.0;var support=0.0;
 for(var y=0;y<2;y++){for(var x=0;x<2;x++){
  let cp=clamp(cell+vec2<i32>(x,y),vec2<i32>(0),coarseSize-vec2<i32>(1));
  let distance=max(0.0,exp2(textureLoad(coarseStats,cp,0).r)-1.0);
  let weight=select(1.0-fraction.x,fraction.x,x==1)*select(1.0-fraction.y,fraction.y,y==1);
  if(distance>0.0){distanceSum+=distance*weight;support+=weight;}
 }}
 let distance=distanceSum/max(support,.00001);
 var variation=0.0;let offsets=array<vec2<i32>,4>(vec2<i32>(1,0),vec2<i32>(-1,0),vec2<i32>(0,1),vec2<i32>(0,-1));
 // Inspect both adjacent display pixels and the coarse footprint. The local
 // stencil catches fine normal-map/bevel variation between coarse ray sites.
 for(var scale=0u;scale<2u;scale++){for(var i=0u;i<4u;i++){
  let stride=select(vec2<f32>(1.0)/vec2<f32>(dimensions),vec2<f32>(1.0)/vec2<f32>(coarseSize),scale==1u);
  let q=clamp(coords+vec2<f32>(offsets[i])*stride,vec2<f32>(0.0),vec2<f32>(1.0));
  let qp=clamp(vec2<i32>(q*vec2<f32>(dimensions)),vec2<i32>(0),dimensions-vec2<i32>(1));let neighbor=textureLoad(normalMap,qp,0);
  variation=max(variation,1.0-max(dot(nr.xyz,neighbor.xyz),0.0));
 }}
 let clip=inverseProjection*vec4<f32>(coords.x*2.0-1.0,1.0-coords.y*2.0,d,1.0);
 let weight=reflectionDetailWeight(nr.w,distance,clip.xyz/clip.w,normalize(nr.xyz),projection,vec2<f32>(dimensions),vec2<f32>(coarseSize),variation);
 return max(weight,(1.0-support)*(1.0-smoothstep(.2,.35,nr.w)));
}
`;
