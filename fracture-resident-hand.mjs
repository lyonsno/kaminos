// Pointer intent stays on the CPU; selected material, contact and drag plane
// stay on the GPU. These entries share the resident surface's triangle picker.
export const FRACTURE_RESIDENT_HAND_WGSL=`
@group(0) @binding(8) var<storage,read_write> handGrip:array<vec4f>;
@group(0) @binding(9) var<storage,read_write> handState:array<vec4f>;
struct HandRay {origin:vec4f,direction:vec4f,normal:vec4f}
@group(0) @binding(10) var<uniform> handRay:HandRay;
@compute @workgroup_size(64) fn clearHand(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i<p.counts.x){handGrip[i*3u]=vec4f(0);handGrip[i*3u+1u]=vec4f(0);handGrip[i*3u+2u]=vec4f(0);}if(i==0u){handState[0]=vec4f(0);handState[1]=vec4f(0);}
}
@compute @workgroup_size(1) fn startHand(){
 let face=atomicLoad(&hit[1]);if(face==0xffffffffu){return;}
 let distance=bitcast<f32>(atomicLoad(&hit[0]));if(distance>=handRay.origin.w){return;}
 let cell=u32(faces[face*3u].w);if(offsets[cell].w!=0.0){return;}
 let x=intersection(face);let a=faces[face*3u].xyz;let b=faces[face*3u+1u].xyz;let c=faces[face*3u+2u].xyz;
 let point=ray.origin.xyz+ray.direction.xyz*distance;
 handState[0]=vec4f(point,f32(cell+1u));handState[1]=vec4f(handRay.normal.xyz,handRay.direction.w);
 handGrip[cell*3u]=vec4f(1,1,handRay.direction.w,1);
 handGrip[cell*3u+1u]=vec4f(a+(b-a)*x.y+(c-a)*x.z,0);
 handGrip[cell*3u+2u]=vec4f(point-p.origin.xyz,0);
}
@compute @workgroup_size(1) fn moveHand(){
 if(handState[0].w==0.0){return;}
 let denominator=dot(handState[1].xyz,handRay.direction.xyz);if(abs(denominator)<1e-8){return;}
 let distance=dot(handState[0].xyz-handRay.origin.xyz,handState[1].xyz)/denominator;if(distance<0.0){return;}
 let cell=u32(handState[0].w)-1u;
 handGrip[cell*3u+2u]=vec4f(handRay.origin.xyz+distance*handRay.direction.xyz-p.origin.xyz,0);
}
`;
export function residentHandRayBytes(ray,generation=0){
 for(const key of ['origin','direction','normal'])if(!Array.isArray(ray[key])||ray[key].length!==3||!ray[key].every(Number.isFinite))throw Error('Resident hand requires finite ray and plane vectors');
 if(Math.abs(Math.hypot(...ray.direction)-1)>1e-5||Math.abs(Math.hypot(...ray.normal)-1)>1e-5)throw Error('Resident hand requires unit ray and plane normal');
 if(!(ray.maxDistance>0))throw Error('Resident hand requires positive occlusion distance');
 return new Float32Array([...ray.origin,Math.min(ray.maxDistance,3.4028234663852886e38),...ray.direction,generation,...ray.normal,0]);
}
