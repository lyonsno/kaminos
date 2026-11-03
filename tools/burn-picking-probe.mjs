import * as THREE from '../lib/three.core.js';
import {createBurnFracturePicker} from '../burn-fracture-picking.mjs';

export async function probeBurnPicking(device){
 const pose=device.createTexture({size:[4,2],format:'rgba32float',usage:GPUTextureUsage.COPY_DST|GPUTextureUsage.TEXTURE_BINDING});
 const material=device.createTexture({dimension:'3d',size:[2,2,2],format:'rgba16float',usage:GPUTextureUsage.COPY_DST|GPUTextureUsage.TEXTURE_BINDING});
 const arrays={positions:new Float32Array([-.5,-.5,0,.5,-.5,0,0,.5,0]),faceMaterial:new Uint8Array([0])},owners=new Float32Array(3),caps=new Float32Array(3).fill(1),mesh=new THREE.Mesh(undefined,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
 const bounds=new THREE.Box3(new THREE.Vector3(-1,-1,-1),new THREE.Vector3(1,1,1));
 const picker=createBurnFracturePicker({field:{device,texture:material,residentState:()=>({bounds})},dynamics:{texture:pose},mesh,arrays,owners,caps,regions:1});
 const setPose=(x,alive)=>{const data=new Float32Array(32);data.set(new THREE.Matrix4().makeTranslation(x,0,0).elements);data[16]=alive;device.queue.writeTexture({texture:pose},data,{bytesPerRow:64},[4,2]);};
 const setPresence=value=>{const data=new Uint16Array(32);for(let i=0;i<8;i++)data[i*4+3]=value?0x3c00:0;device.queue.writeTexture({texture:material},data,{bytesPerRow:16,rowsPerImage:2},[2,2,2]);};
 const ray=x=>new THREE.Ray(new THREE.Vector3(x,0,3),new THREE.Vector3(0,0,-1)),result={};
 try{
  setPresence(1);setPose(2,1);result.closedCap=await picker.pick(ray(2));
  setPose(2,0);result.oldLocation=await picker.pick(ray(0));result.moved=await picker.pick(ray(2));
  setPresence(0);result.consumed=await picker.pick(ray(2));
  setPresence(1);setPose(3,0);result.previousPose=await picker.pick(ray(2));result.latest=await picker.pick(ray(3));
  if(result.closedCap||result.oldLocation||result.consumed||result.previousPose||!result.moved||!result.latest||Math.abs(result.latest.distance-3)>1e-6)throw Object.assign(Error('Resident surface pick did not follow pose, cap or consumed material'),{evidence:result});
  result.counters=picker.read();return result;
 }finally{picker.dispose();pose.destroy();material.destroy();mesh.geometry.dispose();mesh.material.dispose();}
}
