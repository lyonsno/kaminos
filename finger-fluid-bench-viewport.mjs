import * as THREE from './lib/three.webgpu.js';
import {createFluidAnalyticalSupport} from './fluid-analytical-support.mjs';
import {createDynamicReflectionMeshData,dynamicReflectionMeshMatrices} from './finger-fluid-webgpu-core.js';

export const FINGER_FLUID_BENCH_VIEWPORT_PIPELINE='kaminos/finger-fluid-bench-viewport-v1';

/** Render the existing numerical fixtures with the ordinary scene materials. */
export function createFluidBenchScene({scene,truthScene}) {
  const gold=new THREE.MeshStandardMaterial({color:0xb58b37,metalness:1,roughness:.12});
  const group=createFluidAnalyticalSupport({obstacleMaterial:gold});group.name='Fluid bench analytical fixtures';
  const data=createDynamicReflectionMeshData();
  const xyz=values=>Float32Array.from(Array.from({length:values.length/4},(_,i)=>Array.from(values.slice(i*4,i*4+3))).flat());
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(xyz(data.positions),3));
  geometry.setAttribute('normal',new THREE.BufferAttribute(xyz(data.normals),3));
  geometry.setIndex(new THREE.BufferAttribute(data.indices,1));
  const box=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:0xa42b21,roughness:.26,metalness:.12}));
  box.name='Fluid bench optical block';box.matrixAutoUpdate=false;
  if(truthScene==='multi_regime_playground')group.add(box);
  scene.add(group);
  let phaseOverride=null;
  return {group,
    setReflectionPhase(value){phaseOverride=Number(value);},
    update(stepCount){box.matrix.fromArray(dynamicReflectionMeshMatrices(phaseOverride??(stepCount*.012)%(Math.PI*2)).model);box.matrixWorldNeedsUpdate=true;},
    dispose(){scene.remove(group);const materials=new Set();group.traverse(o=>{o.geometry?.dispose();for(const m of [].concat(o.material??[]))materials.add(m);});materials.add(gold);materials.add(box.material);if(!box.parent)geometry.dispose();for(const m of materials)m.dispose();}
  };
}
