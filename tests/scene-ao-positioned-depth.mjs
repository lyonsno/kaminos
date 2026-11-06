// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.webgpu.js';
import {configureMaterialSideAODepth} from '../scene-ao-depth.mjs';
// Conformance to bundled WebGPURenderer.renderObject: execute its unchanged
// material-override path, recording only the final draw endpoint. No pixel claim.
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera();
const depthMaterial=new THREE.MeshBasicNodeMaterial();
const sourceMaterial=new THREE.MeshStandardNodeMaterial();sourceMaterial.positionNode=THREE.TSL.positionLocal.add(THREE.TSL.vec3(0,1,0));
const mesh=new THREE.Mesh(new THREE.BoxGeometry(),sourceMaterial),draws=[];
const renderer={lighting:{enabled:true},_currentSourceMaterial:null,
 setRenderTarget(){},setRenderObjectFunction(fn){this.callback=fn;},
 renderObject:THREE.WebGPURenderer.prototype.renderObject,
 _handleObjectFunction(object,material){draws.push({object,positionNode:material.positionNode,side:material.side});},
 render(){this.callback(mesh,scene,camera,mesh.geometry,sourceMaterial,null,null);},
};
const utils={resetRendererAndSceneState(){return {override:scene.overrideMaterial};},restoreRendererAndSceneState(_r,_s,state){scene.overrideMaterial=state.override;}};
const node={setDepthPass(){},updateBefore(){}};configureMaterialSideAODepth(node,{scene,camera,depthRT:{},depthMaterial},utils);
node.updateBefore({renderer});
assert.equal(draws.length,1,'GPU-positioned physical surface must reach the depth draw');
assert.equal(draws[0].positionNode,sourceMaterial.positionNode,'bundled override retains actual physical position');
assert.equal(depthMaterial.positionNode,null,'renderer restores override after drawing');
mesh.userData.kaminosAODepthUnsupported=true;draws.length=0;node.updateBefore({renderer});assert.equal(draws.length,0,'explicit unsupported carrier remains omitted');
mesh.userData.kaminosAODepthMaterial=new THREE.MeshBasicNodeMaterial();node.updateBefore({renderer});assert.equal(draws.length,1,'an explicit depth presentation supersedes omission');
mesh.geometry.dispose();sourceMaterial.dispose();depthMaterial.dispose();mesh.userData.kaminosAODepthMaterial.dispose();
