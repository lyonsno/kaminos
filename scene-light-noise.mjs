import {RAY_START_WGSL} from './volume-ray-start.mjs';

// The camera and smoke light field share the FAST 128x128x32 scalar atlas.
// Each receiver layer translates the spatial tile; temporal progression selects
// its authored temporal slice, never a moving offset of the spatial pattern.
export function smokeNoiseAddress(cell,frame,dimension){
  const mod=(x,n)=>((x%n)+n)%n,fract=x=>x-Math.floor(x);
  const pixel=[cell[0]+37*cell[2],cell[1]+17*cell[2]];
  const offset=[.754877666,.569840296].map(x=>Math.floor(fract(dimension*x)*128));
  const f=mod(Math.floor(frame),32);
  return [mod(pixel[0]+offset[0],128)+(f%8)*128,mod(pixel[1]+offset[1],128)+Math.floor(f/8)*128];
}
export const SMOKE_LIGHT_NOISE_WGSL=RAY_START_WGSL.replace('@binding(25)','@binding(18)')+/* wgsl */`
@group(0) @binding(19) var<uniform> smokeSamplingFrame:vec4<f32>;
fn smokeNoisePixel(p:vec3<f32>)->vec2<f32>{
  let c=vec3<i32>(floor((p+vec3<f32>(1.0))*f32(VOLUME_GRID)*0.5));
  let q=vec2<i32>(c.x+37*c.z,c.y+17*c.z);
  return vec2<f32>(((q%vec2<i32>(128))+vec2<i32>(128))%vec2<i32>(128));
}
fn blueReceiverRotation(p:vec3<f32>)->vec4<f32>{
  let pixel=smokeNoisePixel(p);
  // Angular directions remain stable: their cached solid intersections stay
  // valid. Blue temporal variation belongs to quadrature along these rays.
  let a=rayNoiseSample(pixel,0.0,0u);let b=rayNoiseSample(pixel,0.0,1u);let c=rayNoiseSample(pixel,0.0,2u);
  return vec4<f32>(sqrt(1.0-a)*sin(6.28318530718*b),sqrt(1.0-a)*cos(6.28318530718*b),sqrt(a)*sin(6.28318530718*c),sqrt(a)*cos(6.28318530718*c));
}
fn blueRayPhase(p:vec3<f32>,a:u32)->f32{
  return rayNoiseSample(smokeNoisePixel(p),smokeSamplingFrame.x,a/2u+3u);
}
`;
