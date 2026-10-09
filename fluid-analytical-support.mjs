import * as THREE from './lib/three.webgpu.js';
import {sampleFingerFluidPlaygroundHeight,fingerFluidAnalyticalSupportGeometry} from './finger-fluid-webgpu-core.js';

export function createFluidAnalyticalSupport({obstacleMaterial=null}={}) {
  const {boundsMin, boundsMax, obstacle} = fingerFluidAnalyticalSupportGeometry();
  // Same 64-cell surface sampling as the retained analytical presentation.
  const geometry = new THREE.PlaneGeometry(boundsMax[0]-boundsMin[0], boundsMax[2]-boundsMin[2], 64, 64);
  geometry.rotateX(-Math.PI/2);
  const positions = geometry.attributes.position;
  for (let i=0; i<positions.count; i++) positions.setY(i, sampleFingerFluidPlaygroundHeight(positions.getX(i), positions.getZ(i)));
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({color:0x74898a, roughness:.65, metalness:.05, side:THREE.DoubleSide});
  const group = new THREE.Group(); group.name = 'Local analytical basin';
  group.add(new THREE.Mesh(geometry, material));
  const rock = new THREE.Mesh(new THREE.SphereGeometry(obstacle.radius, 32, 24), obstacleMaterial??material);
  rock.position.fromArray(obstacle.center); group.add(rock);
  return group;
}

