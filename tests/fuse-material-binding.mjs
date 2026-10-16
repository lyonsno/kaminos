// kaminos-test: node
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as THREE from '../lib/three.webgpu.js';
import {cloneSceneRadianceMaterial} from '../scene-radiance.mjs';

const source=(await readFile(new URL('../experiments/sinter/curved-fuse.experiment.mjs',import.meta.url),'utf8'))
  .replace(/^import .*;\n/gm,'').replace('export default','globalThis.experiment=');
const stop=new Error('attachment inspected');
let inspected=false;
const field={stateNode:THREE.TSL.vec4(1,.8,1,0),dispose(){}};
const runtime={setSimulationPaused(){},debugState:()=>({simGrid:32,gridHeight:{heightCells:32}}),borrowThermalGpuContext:async()=>({})};
const host={volume:{ready:Promise.resolve(),get:()=>runtime},
  fire:{settings:()=>({source:{presetId:'observed-basin'},domControls:{'volume-steps':{value:28},'volume-immersed-radius':{value:.1}}}),add:async()=>{},setEnabled(){}},
  rendering:{gi(){}},scene:{renderer:()=>({}),open:async()=>({dispose:async()=>{},attach:async mesh=>{
    assert.ok(mesh.material.colorNode,'live burn color must be bound before scene registration can clone the material');
    assert.ok(mesh.material.emissiveNode,'live reaction must be bound before registration');
    assert.ok(mesh.material.roughnessNode,'spent material response must be bound before registration');
    const clone=cloneSceneRadianceMaterial({fromMaterial:m=>m},mesh.material);
    assert.equal(clone.colorNode,mesh.material.colorNode);
    assert.equal(clone.emissiveNode,mesh.material.emissiveNode);
    inspected=true;throw stop;
  }})}};
const context=vm.createContext({THREE,FUSE_SAMPLES:96,FUSE_IDENTITY:'fixture',createFuseGpu:async()=>field});
vm.runInContext(source,context);
await assert.rejects(context.experiment.create({host,record(){}}),error=>error===stop);
assert.equal(inspected,true);
