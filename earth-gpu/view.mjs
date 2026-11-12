import * as THREE from '../lib/three.webgpu.js';
import {storage,instanceIndex,wgslFn,positionGeometry,modelWorldMatrixInverse,cameraWorldMatrix,cameraPosition,modelViewMatrix,cameraProjectionMatrix,vec4,vec3,varying,Fn,If,Discard,transformNormalToView,attribute} from '../lib/three.tsl.js';
import {EARTH_GPU_MATH_WGSL} from './shader.mjs';
export function createEarthGpuView(renderer,state){
 const data=new THREE.StorageBufferAttribute(state.floats,4);renderer.backend.createStorageAttribute(data);const bodyBuffer=renderer.backend.get(data).buffer;
 const words=storage(data,'vec4',state.floats.length/4).toReadOnly();
 const lobe=wgslFn(`fn earth_lobe(instance:u32,data:ptr<storage,array<vec4f>,read>)->vec4f{let i=(instance/2u)*6u;let l=instance%2u;let s=(*data)[i+4u];let q=(*data)[i+1u];let r=select((*data)[i+2u].w,(*data)[i+3u].w,l==1u);return vec4f((*data)[i].xyz+qrotate(q,vec3f(select(s.x,s.y,l==1u),0,0)),r);}
${EARTH_GPU_MATH_WGSL}`);
 const pigment=wgslFn(`fn earth_pigment(instance:u32,data:ptr<storage,array<vec4f>,read>)->vec3f{let s=(*data)[(instance/2u)*6u+4u].w;if(s<.18){return vec3f(.38,.30,.19);}if(s<.45){return vec3f(.10,.075,.045);}return vec3f(.23,.15,.075);}`);
 const sphere=varying(lobe({instance:instanceIndex,data:words}),'earth_lobe_state');
 const right=modelWorldMatrixInverse.mul(cameraWorldMatrix.mul(vec4(1,0,0,0))).xyz.normalize();
 const up=modelWorldMatrixInverse.mul(cameraWorldMatrix.mul(vec4(0,1,0,0))).xyz.normalize();
 const billboard=sphere.xyz.add(right.mul(positionGeometry.x).add(up.mul(positionGeometry.y)).mul(sphere.w).mul(1.12));
 const point=varying(billboard,'earth_billboard_point'),eye=modelWorldMatrixInverse.mul(vec4(cameraPosition,1)).xyz,ray=point.sub(eye).normalize();
 const hitFn=wgslFn(`fn earth_sphere_hit(eye:vec3f,ray:vec3f,sphere:vec4f)->vec4f{let d=eye-sphere.xyz;let b=dot(d,ray);let h=b*b-dot(d,d)+sphere.w*sphere.w;if(h<0.0){return vec4f(0,0,1,-1);}let t=-b-sqrt(h);return vec4f((eye+ray*t-sphere.xyz)/sphere.w,t);}`);
 const hit=hitFn({eye,ray,sphere}).toVar('earth_exact_hit');
 const material=new THREE.MeshStandardNodeMaterial({roughness:.86,side:THREE.DoubleSide});material.positionNode=billboard;
 material.colorNode=Fn(()=>{If(hit.w.lessThan(0),()=>Discard());return varying(pigment({instance:instanceIndex,data:words}),'earth_grain_pigment');})();
 material.normalNode=transformNormalToView(hit.xyz);
 material.depthNode=Fn(()=>{const clip=cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(eye.add(ray.mul(hit.w)),1)));return clip.z.div(clip.w);})();
 const base=new THREE.PlaneGeometry(2,2),geometry=new THREE.InstancedBufferGeometry().copy(base);base.dispose();geometry.instanceCount=state.grainCount*2;
 geometry.boundingBox=new THREE.Box3(new THREE.Vector3(-state.width/2,0,-state.depth/2),new THREE.Vector3(state.width/2,.01,state.depth/2));geometry.boundingSphere=geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
 const grains=new THREE.Mesh(geometry,material);grains.name='Rigid mineral grains';grains.frustumCulled=false;grains.receiveShadow=true;grains.castShadow=false;grains.userData.kaminosPreserveAnalyticalPicking=true;
 // The clay boundary is the actual material-element boundary used by contacts.
 // No density meshing, CPU pose readback, or surface extraction runs per frame.
 const positions=new Float32Array(state.faceCount*9),indices=new Float32Array(state.faceCount*3);
 for(let i=0;i<state.faceCount;i++)for(let k=0;k<3;k++)indices[i*3+k]=state.triangles[i*4+k];
 const clayGeometry=new THREE.BufferGeometry();clayGeometry.setAttribute('position',new THREE.BufferAttribute(positions,3));clayGeometry.setAttribute('materialNode',new THREE.BufferAttribute(indices,1));clayGeometry.boundingBox=geometry.boundingBox.clone();clayGeometry.boundingSphere=geometry.boundingSphere.clone();
 const clayMaterial=new THREE.MeshStandardNodeMaterial({color:0x8e6340,roughness:.94,flatShading:true,side:THREE.DoubleSide});
 const clayPoint=wgslFn('fn earth_material_point(id:u32,data:ptr<storage,array<vec4f>,read>)->vec3f{return (*data)[id*6u].xyz;}');clayMaterial.positionNode=clayPoint({id:attribute('materialNode','float').toUint(),data:words});
 const clay=new THREE.Mesh(clayGeometry,clayMaterial);clay.name='Yielding fine matrix';clay.frustumCulled=false;clay.receiveShadow=true;clay.castShadow=false;
 const group=new THREE.Group();group.add(grains,clay);
 return {group,bodyBuffer,read:()=>({grainSurface:'exact analytic sphere intersections and fragment depth',matrixSurface:'retained Lagrangian element boundary',poseReadbacksPerFrame:0}),dispose(){group.removeFromParent();geometry.dispose();material.dispose();clayGeometry.dispose();clayMaterial.dispose();if(renderer.backend.get(data).buffer)renderer.backend.destroyAttribute(data);}};
}
