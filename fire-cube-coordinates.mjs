import * as THREE from './lib/three.webgpu.js';

export const CUBE_COORDINATES_WGSL=/* wgsl */`
fn smokeCubeUV(d:vec3<f32>)->vec3<f32>{
 let a=abs(d);var face=0.0;var uv=vec2<f32>(0);
 if(a.x>=a.y && a.x>=a.z){
  if(d.x>=0.0){face=0.0;uv=vec2<f32>(-d.z,-d.y)/a.x;}
  else {face=1.0;uv=vec2<f32>(d.z,-d.y)/a.x;}
 }else if(a.y>=a.z){
  if(d.y>=0.0){face=2.0;uv=vec2<f32>(d.x,d.z)/a.y;}
  else {face=3.0;uv=vec2<f32>(d.x,-d.z)/a.y;}
 }else{
  if(d.z>=0.0){face=4.0;uv=vec2<f32>(d.x,-d.y)/a.z;}
  else {face=5.0;uv=vec2<f32>(-d.x,-d.y)/a.z;}
 }
 return vec3<f32>(uv*.5+vec2<f32>(.5),face);
}`;
export const cubeCoordinates=THREE.TSL.wgslFn(CUBE_COORDINATES_WGSL);
