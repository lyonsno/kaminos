import {MeshStandardMaterial,MeshPhysicalNodeMaterial,Color,TSL} from './lib/three.webgpu.js';
import {materialDefinitions} from './scene-material-recipes.mjs';
import {neumipProgram} from './neumip-program.mjs';
import {neuralAppearanceProgram} from './neural-appearance-program.mjs';
const {uniform,positionLocal,mx_noise_float,mix,smoothstep,bumpMap}=TSL;
function surfaceProgram({base,parameters},preserve){
 if(preserve&&(!base.isMeshStandardMaterial||base.isNodeMaterial))throw Error('This source material has its own shader; choose an authored implementation explicitly');
 const material=preserve?base.clone():new MeshStandardMaterial({side:base.side});
 const update=p=>{material.color.set(p.color);material.roughness=p.roughness;material.metalness=p.metalness;};update(parameters);
 return {material,update,dispose:()=>material.dispose()};
}
function glazeProgram({base,parameters}){
 const material=new MeshPhysicalNodeMaterial({side:base.side,metalness:0,clearcoat:1,ior:1.47});
 const clay=uniform(new Color()),glaze=uniform(new Color()),coverage=uniform(0),scale=uniform(1),relief=uniform(0),roughness=uniform(.2);
 const firing=mx_noise_float(positionLocal.mul(scale)).mul(.5).add(.5);
 const glazed=smoothstep(coverage.oneMinus().sub(.12),coverage.oneMinus().add(.12),firing);
 const grain=mx_noise_float(positionLocal.mul(scale).mul(35)).mul(.5).add(.5);
 material.colorNode=mix(clay.mul(mix(.65,1.1,firing)),glaze.mul(mix(.72,1.15,firing)),glazed);
 material.roughnessNode=mix(.86,roughness.add(grain.mul(.06)),glazed);
 material.clearcoatNode=glazed;material.clearcoatRoughnessNode=roughness.mul(.6);
 material.normalNode=bumpMap(grain.mul(relief).mul(.015));
 const update=p=>{clay.value.set(p.clay);glaze.value.set(p.glaze);coverage.value=p.coverage;scale.value=p.scale;relief.value=p.relief;roughness.value=p.roughness;};update(parameters);
 return {material,update,dispose:()=>material.dispose()};
}
export const sceneMaterialPrograms=materialDefinitions.map(definition=>definition.id==='neumip'?neumipProgram:definition.id==='neural-appearance'?neuralAppearanceProgram:({...definition,create:definition.id==='kiln-glaze'?glazeProgram:input=>surfaceProgram(input,definition.id==='asset-surface')}));
