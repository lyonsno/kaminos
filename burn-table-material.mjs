import {checkedBurnAppearance} from './scene-burning-settings.mjs';
import {LIVE_LOG_HEAT_TO_FLUID_HEAT} from './live-log-heat-core.mjs';
import {createSurfaceThermalRadiance,SURFACE_THERMAL_IDENTITY,SURFACE_KELVIN_PER_HEAT,checkedSurfaceKelvin} from './burn-thermal-radiance.mjs';
import * as THREE from './lib/three.webgpu.js';
import {cloneSceneRadianceMaterial} from './scene-radiance.mjs';
import {checkedBurnControls} from './burn-table-core.mjs';

const HASH_WGSL=`
fn burnHash(p: vec2<f32>) -> vec2<f32> {
  return fract(sin(vec2<f32>(dot(p,vec2<f32>(127.1,311.7)),dot(p,vec2<f32>(269.5,183.3))))*43758.5453);
}`;
const CELLS_WGSL=`fn burnCells(p: vec2<f32>) -> vec4<f32> {
  let cell=floor(p); let f=fract(p);
  var first=10.0; var second=10.0; var owner=vec2<f32>(0.0);
  for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
    let g=vec2<f32>(f32(x),f32(y));
    let r=g+burnHash(cell+g)-f; let d=dot(r,r);
    if(d<first){second=first;first=d;owner=cell+g;}else if(d<second){second=d;}
  }}
  let edge=1.0-smoothstep(0.025,0.11,sqrt(second)-sqrt(first));
  let identity=burnHash(owner);
  return vec4<f32>(edge,identity,identity.x*6.2831853+identity.y*2.7);
}`;
const FACETS_WGSL=`fn burnFacets(p: vec3<f32>, n: vec3<f32>) -> vec4<f32> {
  let normal=abs(n);
  var plane=p.xy;
  if(normal.x>normal.y && normal.x>normal.z){plane=p.zy;}
  else if(normal.y>normal.z){plane=p.xz;}
  let warp=vec2<f32>(sin(plane.y*19.0+plane.x*7.0),sin(plane.x*17.0-plane.y*9.0))*0.09;
  return burnCells(plane*vec2<f32>(18.0,28.0)+warp);
}`;
export const BURN_SURFACE_WGSL=`fn burnSurface(p: vec3<f32>, facets: vec4<f32>, controls: vec3<f32>, metalProfile: f32, clock: f32) -> vec4<f32> {
  let irregular=sin(p.y*15.0+p.z*10.0)*0.035+sin(p.z*27.0)*0.012;
  let exposure=smoothstep(0.31,0.61,p.x+irregular);
  let heat=controls.x*exposure;
  let damage=controls.y*exposure*(1.0-metalProfile);
  let reaction=controls.z*exposure*(1.0-metalProfile);
  let hot=smoothstep(0.42,0.95,heat);
  let pulse=0.5+0.5*sin(clock*1.8+facets.w);
  let bed=mix(0.18*smoothstep(0.08,0.65,damage),0.55,reaction*(0.75+0.25*pulse));
  let grain=mix(0.94,1.06,facets.x*pulse);
  let ember=hot*hot*mix(bed*grain,1.0,metalProfile);
  return vec4<f32>(heat,damage,ember,reaction);
}`;
const ROTATE_WGSL=`fn burnRotate(n: vec3<f32>, axis: vec3<f32>, angle: f32) -> vec3<f32> {
  return n*cos(angle)+cross(axis,n)*sin(angle)+axis*dot(axis,n)*(1.0-cos(angle));
}`;
const NORMAL_WGSL=`fn burnFacetNormal(n: vec3<f32>, facets: vec4<f32>, damage: f32) -> vec3<f32> {
  let base=normalize(n);
  var reference=vec3<f32>(0.0,0.0,1.0);
  if(abs(base.z)>0.8){reference=vec3<f32>(0.0,1.0,0.0);}
  let tangent=normalize(cross(reference,base));let bitangent=cross(base,tangent);
  let strength=smoothstep(0.4,0.95,damage)*(1.0-facets.x);
  let angles=(facets.yz*2.0-vec2<f32>(1.0))*0.012*strength;
  return normalize(burnRotate(burnRotate(base,tangent,angles.x),bitangent,angles.y));
}`;
const hashNode=THREE.TSL.wgslFn(HASH_WGSL);
const cellsNode=THREE.TSL.wgslFn(CELLS_WGSL,[hashNode]);
const facetsNode=THREE.TSL.wgslFn(FACETS_WGSL,[cellsNode]);
const surfaceNode=THREE.TSL.wgslFn(BURN_SURFACE_WGSL);
const liveSurfaceNode=THREE.TSL.wgslFn(`fn burnLiveSurface(state: vec4<f32>, facets: vec4<f32>, clock: f32) -> vec4<f32> {
  let heat=clamp(state.x,0.0,1.0);let damage=clamp(state.y,0.0,1.0);
  let reaction=clamp(state.z,0.0,1.0);let presence=clamp(state.w,0.0,1.0);
  let hot=smoothstep(0.42,0.95,heat);
  let charBed=smoothstep(0.08,0.65,damage);
  let erosionRim=(1.0-smoothstep(0.55,0.95,presence))*step(0.05,presence);
  let front=clamp(reaction*1.1+erosionRim*0.45,0.0,1.0);
  let pulse=0.5+0.5*sin(clock*1.7+facets.w);
  let grain=mix(0.94,1.06,facets.x*pulse);
  let ember=hot*hot*mix(0.18*charBed,0.55,front)*grain;
  return vec4<f32>(heat,damage,ember,reaction);
}`);
const rotateNode=THREE.TSL.wgslFn(ROTATE_WGSL);
const facetNormalNode=THREE.TSL.wgslFn(NORMAL_WGSL,[rotateNode]);

export function createBurnMaterial({renderer,original,bounds,settings,stateNode=null,stateIdentity=null,presenceNode=null,coverage='partial'}) {
  if(!['partial','whole'].includes(coverage))throw Error('Invalid burn coverage');
  const {uniform,float,vec3,positionLocal,normalLocal,materialNormal,materialColor,materialRoughness,materialMetalness,mix,transformNormalToView,smoothstep}=THREE.TSL;
  const config=checkedBurnControls(settings);
  const appearanceSelectable=Boolean(stateNode);
  const appearanceMix=uniform(1);
  const glow=uniform(1),kelvinPerHeat=uniform(SURFACE_KELVIN_PER_HEAT);
  let thermal=null;
  const controls=uniform(new THREE.Vector3(config.heat,config.char,config.reaction));
  const clock=uniform(0), profile=uniform(config.profile==='metal'?1:0);
  const inspection=uniform(0);let view='beauty';
  const size=bounds.getSize(new THREE.Vector3());
  if(Math.min(size.x,size.y,size.z)<=0)throw new Error('Burn material requires volumetric local bounds');
  const p=THREE.TSL.positionGeometry.sub(vec3(...bounds.min.toArray())).div(vec3(...size.toArray()));
  const facets=facetsNode({p,n:normalLocal}).toVar('burnFacetData');
  if(stateNode&&!stateIdentity)throw Error('GPU material state requires source identity');
  const sample=(stateNode?liveSurfaceNode({state:stateNode,facets,clock}):surfaceNode({p:coverage==='whole'?vec3(1,p.y,p.z):p,facets,controls,metalProfile:profile,clock})).toVar('burnSurfaceData');
  const material=cloneSceneRadianceMaterial(renderer.library,original);
  if(presenceNode){material.opacityNode=presenceNode;material.alphaTest=.5;}
  // Char alters reflection and local shading normals; it never moves geometry.
  const scorch=smoothstep(.005,.25,sample.y),carbon=smoothstep(.08,.6,sample.y);
  const crust=smoothstep(.2,.8,sample.y);
  const scorched=mix(materialColor.rgb,materialColor.rgb.mul(vec3(.18,.09,.035)),scorch);
  const recess=facets.x.mul(crust).mul(.12).oneMinus();
  material.colorNode=scorched.mul(mix(float(1),float(.045),carbon)).mul(recess);
  material.roughnessNode=mix(materialRoughness,mix(uniform(.66),uniform(.94),facets.x),sample.y);
  const tilted=facetNormalNode({n:normalLocal,facets,damage:sample.y});
  const delta=transformNormalToView(tilted).normalize().sub(transformNormalToView(normalLocal).normalize());
  material.normalNode=materialNormal.add(delta).normalize();
  material.metalnessNode=materialMetalness.mul(sample.y.oneMinus()).max(profile);
  const redToOrange=mix(vec3(.7,.008,.001),vec3(1,.12,.008),smoothstep(.45,.85,sample.x));
  const hotColor=mix(redToOrange,vec3(1,.42,.055),smoothstep(.85,1,sample.x));
  const facetEmber=hotColor.mul(sample.z.mul(.45));
  material.emissiveNode=facetEmber;
  if(appearanceSelectable){
    thermal=createSurfaceThermalRadiance(stateNode.x.mul(LIVE_LOG_HEAT_TO_FLUID_HEAT),kelvinPerHeat);
    // Sinter's scorch, facets, roughness, normal maps and active facet ember glow
    // compose with Planck thermal radiance from resident temperature.
    material.emissiveNode=thermal.node.mul(sample.z.mul(.25)).add(facetEmber).mul(glow);
  }
  // Diagnostic emission is unlit data; the beauty response stays unchanged.
  const diagnostic=mix(vec3(sample.y),vec3(sample.x,0,0),inspection.greaterThan(1.5));
  material.colorNode=mix(material.colorNode,vec3(0),inspection.greaterThan(.5));
  material.emissiveNode=mix(material.emissiveNode,diagnostic,inspection.greaterThan(.5));
  material.outputNode=inspection.greaterThan(.5).select(THREE.TSL.vec4(diagnostic,1),THREE.TSL.output);
  return {material,thermalControls:thermal?{gain:glow,kelvinPerHeat,weight:appearanceMix}:null,setAppearance(value){if(!appearanceSelectable)throw Error('No incineration appearance on this material');const nextKelvin=checkedSurfaceKelvin(value.kelvinPerHeat??kelvinPerHeat.value);const next=checkedBurnAppearance({...value,glow:value.glow??glow.value});kelvinPerHeat.value=nextKelvin;glow.value=next.glow;original.userData.kaminosBurnAppearance='composed';},update(seconds,displayed=material){clock.value=seconds;for(const target of new Set([material,displayed])){target.color.copy(original.color);target.roughness=original.roughness;target.metalness=original.metalness;}},setView(next){if(!['beauty','char','heat'].includes(next))throw Error('Invalid burn view');view=next;inspection.value=['beauty','char','heat'].indexOf(next);},set(next){if(stateNode)throw Error('Live thermal state is GPU-owned');const c=checkedBurnControls(next);controls.value.set(c.heat,c.char,c.reaction);profile.value=c.profile==='metal'?1:0;},
    read:()=>({appearanceModel:appearanceSelectable?'scorched-thermal-crust-v2':'char-facet-crust-v1',scorchResponse:'char-facet-crust-v1',emissionAuthority:appearanceSelectable?SURFACE_THERMAL_IDENTITY:'char-facet-crust-v1',thermal:thermal?{kelvinPerHeat:kelvinPerHeat.value,temperatureAuthority:'exposure-equivalent-resident-material-heat',heatToFluid:LIVE_LOG_HEAT_TO_FLUID_HEAT,calibratedWoodTemperature:false}:null,appearanceSelectable,appearance:appearanceSelectable?{glow:glow.value,profile:'composed'}:null,sourceMaterial:original.uuid,
      view,coverage:stateNode?'resident':coverage,
      stateAuthority:stateIdentity||'synthetic-held-exposure-v1',
      controls:stateNode?null:{heat:controls.value.x,char:controls.value.y,reaction:controls.value.z,profile:profile.value===1?'metal':'wood'},
      appearanceSeconds:clock.value,facetRotationPerAxisRadians:.012,
      maps:{baseColor:original.map?.uuid||null,normal:original.normalMap?.uuid||null,metalness:original.metalnessMap?.uuid||null,roughness:original.roughnessMap?.uuid||null}}),dispose(){thermal?.dispose();material.dispose();}};
}
