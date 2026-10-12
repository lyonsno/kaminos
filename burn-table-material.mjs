import * as THREE from './lib/three.webgpu.js';
import {cloneSceneRadianceMaterial} from './scene-radiance.mjs';
import {checkedBurnControls} from './burn-table-core.mjs';

const HASH_WGSL=`
fn burnHash(p: vec2<f32>) -> vec2<f32> {
  return fract(sin(vec2<f32>(dot(p,vec2<f32>(127.1,311.7)),dot(p,vec2<f32>(269.5,183.3))))*43758.5453);
}`;
const CELLS_WGSL=`fn burnCells(p: vec2<f32>) -> f32 {
  let cell=floor(p); let f=fract(p);
  var first=10.0; var second=10.0;
  for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
    let g=vec2<f32>(f32(x),f32(y));
    let r=g+burnHash(cell+g)-f; let d=dot(r,r);
    if(d<first){second=first;first=d;}else if(d<second){second=d;}
  }}
  return 1.0-smoothstep(0.025,0.11,sqrt(second)-sqrt(first));
}`;
export const BURN_SURFACE_WGSL=`fn burnSurface(p: vec3<f32>, n: vec3<f32>, controls: vec3<f32>, metal: f32, metalProfile: f32, clock: f32) -> vec4<f32> {
  let normal=abs(n);
  var plane=p.xy;
  if(normal.x>normal.y && normal.x>normal.z){plane=p.zy;}
  else if(normal.y>normal.z){plane=p.xz;}
  let warp=vec2<f32>(sin(plane.y*13.0),sin(plane.x*11.0))*0.12;
  let crack=burnCells(plane*vec2<f32>(8.0,13.0)+warp);
  let irregular=sin(p.y*15.0+p.z*10.0)*0.035+sin(p.z*27.0)*0.012;
  let exposure=smoothstep(0.31,0.61,p.x+irregular);
  let heat=controls.x*exposure;
  let damage=controls.y*exposure*(1.0-metal);
  let reaction=controls.z*exposure*(1.0-metal);
  let hot=max(0.0,(heat-0.55)/0.45);
  let breathing=0.76+0.16*sin(clock*2.1+p.z*8.0)+0.08*sin(clock*3.7+p.y*13.0);
  let ember=hot*mix(crack*controls.y*exposure,1.0,metalProfile)*breathing;
  return vec4<f32>(heat,damage,ember,reaction);
}`;
const hashNode=THREE.TSL.wgslFn(HASH_WGSL);
const cellsNode=THREE.TSL.wgslFn(CELLS_WGSL,[hashNode]);
const surfaceNode=THREE.TSL.wgslFn(BURN_SURFACE_WGSL,[cellsNode]);

export function createBurnMaterial({renderer,original,bounds,settings}) {
  const {uniform,vec3,positionLocal,normalLocal,materialColor,materialRoughness,materialMetalness,mix}=THREE.TSL;
  const config=checkedBurnControls(settings);
  const controls=uniform(new THREE.Vector3(config.heat,config.char,config.reaction));
  const clock=uniform(0), profile=uniform(config.profile==='metal'?1:0);
  const size=bounds.getSize(new THREE.Vector3());
  if(Math.min(size.x,size.y,size.z)<=0)throw new Error('Burn material requires volumetric local bounds');
  const p=positionLocal.sub(vec3(...bounds.min.toArray())).div(vec3(...size.toArray()));
  const sample=surfaceNode({p,n:normalLocal,controls,metal:materialMetalness.max(profile),metalProfile:profile,clock});
  const material=cloneSceneRadianceMaterial(renderer.library,original);
  const charColor=vec3(.035,.029,.024);
  const scorch=sample.x.mul(.6).mul(materialMetalness.max(profile).oneMinus());
  const base=materialColor.rgb.mul(mix(vec3(1),vec3(.38,.22,.14),scorch));
  material.colorNode=mix(base,charColor,sample.y.mul(.92));
  material.roughnessNode=mix(materialRoughness,uniform(.96),sample.y);
  material.metalnessNode=materialMetalness.mul(sample.y.oneMinus()).max(profile);
  material.emissiveNode=vec3(1,.16,.015).mul(sample.z.mul(sample.w.mul(.8).add(1.6)));
  return {material,update(seconds){clock.value=seconds;},set(next){const c=checkedBurnControls(next);controls.value.set(c.heat,c.char,c.reaction);profile.value=c.profile==='metal'?1:0;},
    read:()=>({sourceMaterial:original.uuid,maps:{baseColor:original.map?.uuid||null,metalness:original.metalnessMap?.uuid||null,roughness:original.roughnessMap?.uuid||null}}),dispose:()=>material.dispose()};
}
