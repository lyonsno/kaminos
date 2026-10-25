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
  let warp=vec2<f32>(sin(plane.y*13.0),sin(plane.x*11.0))*0.12;
  return burnCells(plane*vec2<f32>(8.0,13.0)+warp);
}`;
export const BURN_SURFACE_WGSL=`fn burnSurface(p: vec3<f32>, facets: vec4<f32>, controls: vec3<f32>, metalProfile: f32, clock: f32) -> vec4<f32> {
  let irregular=sin(p.y*15.0+p.z*10.0)*0.035+sin(p.z*27.0)*0.012;
  let exposure=smoothstep(0.31,0.61,p.x+irregular);
  let heat=controls.x*exposure;
  let damage=controls.y*exposure*(1.0-metalProfile);
  let reaction=controls.z*exposure*(1.0-metalProfile);
  let hot=max(0.0,(heat-0.55)/0.45);
  let pulse=0.5+0.5*sin(clock*2.1+facets.w);
  let patches=smoothstep(0.25,0.8,pulse);
  let activity=mix(0.62,mix(0.12,1.25,patches),reaction);
  let ember=hot*hot*mix(facets.x*damage,1.0,metalProfile)*activity;
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
  let strength=damage*(1.0-facets.x);
  let angles=(facets.yz*2.0-vec2<f32>(1.0))*0.04*strength;
  return normalize(burnRotate(burnRotate(base,tangent,angles.x),bitangent,angles.y));
}`;
const hashNode=THREE.TSL.wgslFn(HASH_WGSL);
const cellsNode=THREE.TSL.wgslFn(CELLS_WGSL,[hashNode]);
const facetsNode=THREE.TSL.wgslFn(FACETS_WGSL,[cellsNode]);
const surfaceNode=THREE.TSL.wgslFn(BURN_SURFACE_WGSL);
const liveSurfaceNode=THREE.TSL.wgslFn(`fn burnLiveSurface(state: vec4<f32>, facets: vec4<f32>, clock: f32) -> vec4<f32> {
  let heat=clamp(state.x,0.0,1.0);let damage=clamp(state.y,0.0,1.0);
  let reaction=clamp(state.z,0.0,1.0);
  let hot=max(0.0,(heat-0.55)/0.45);
  let pulse=0.5+0.5*sin(clock*2.1+facets.w);
  let activity=mix(0.62,mix(0.12,1.25,smoothstep(0.25,0.8,pulse)),reaction);
  return vec4<f32>(heat,damage,hot*hot*facets.x*damage*activity,reaction);
}`);
const rotateNode=THREE.TSL.wgslFn(ROTATE_WGSL);
const facetNormalNode=THREE.TSL.wgslFn(NORMAL_WGSL,[rotateNode]);
const incinerationNode=THREE.TSL.wgslFn(`fn incinerationFront(state:vec4<f32>, facets:vec4<f32>, p:vec3<f32>) -> vec4<f32> {
  let heat=clamp(state.x,0.0,1.0);let damage=clamp(state.y,0.0,1.0);
  let hot=smoothstep(0.24,0.92,heat);
  let char=smoothstep(0.025,0.65,damage);
  // Presence is the existing resident fuel/coverage field. This band follows
  // its retreat; it never erases material or advances a presentation clock.
  let retreat=1.0-smoothstep(0.50,0.82,state.w);
  let reactionFront=smoothstep(0.06,0.28,damage)*(1.0-smoothstep(0.58,0.90,damage));
  let cracks=pow(facets.x,4.0)*damage;
  let variation=0.88+0.12*sin(p.x*389.0+sin(p.y*173.0)*2.0);
  let glow=hot*hot*(retreat*0.95+reactionFront*0.035+cracks*0.012)*variation;
  return vec4<f32>(heat,char,glow,clamp(retreat*0.75+hot*0.5,0.0,1.0));
}`);

export function createBurnMaterial({renderer,original,bounds,settings,stateNode=null,stateIdentity=null,presenceNode=null,coverage='partial'}) {
  if(!['partial','whole'].includes(coverage))throw Error('Invalid burn coverage');
  const {uniform,float,vec3,positionLocal,normalLocal,materialNormal,materialColor,materialRoughness,materialMetalness,mix,transformNormalToView,smoothstep}=THREE.TSL;
  const config=checkedBurnControls(settings);
  const incineration=original.userData?.kaminosBurnAppearance==='incineration';
  const glow=uniform(20);
  const controls=uniform(new THREE.Vector3(config.heat,config.char,config.reaction));
  const clock=uniform(0), profile=uniform(config.profile==='metal'?1:0);
  const inspection=uniform(0);let view='beauty';
  const size=bounds.getSize(new THREE.Vector3());
  if(Math.min(size.x,size.y,size.z)<=0)throw new Error('Burn material requires volumetric local bounds');
  const p=positionLocal.sub(vec3(...bounds.min.toArray())).div(vec3(...size.toArray()));
  const facets=facetsNode({p,n:normalLocal}).toVar('burnFacetData');
  if(stateNode&&!stateIdentity)throw Error('GPU material state requires source identity');
  const sample=(stateNode?liveSurfaceNode({state:stateNode,facets,clock}):surfaceNode({p:coverage==='whole'?vec3(1,p.y,p.z):p,facets,controls,metalProfile:profile,clock})).toVar('burnSurfaceData');
  const material=cloneSceneRadianceMaterial(renderer.library,original);
  if(presenceNode){material.opacityNode=presenceNode;material.alphaTest=.5;}
  // Char alters reflection and local shading normals; it never moves geometry.
  const darkening=sample.y.oneMinus().pow(3).mul(.985).add(.015);
  const recess=facets.x.mul(sample.y).mul(.7).oneMinus();
  material.colorNode=materialColor.rgb.mul(darkening).mul(recess);
  material.roughnessNode=mix(materialRoughness,mix(uniform(.24),uniform(.94),facets.x),sample.y);
  const tilted=facetNormalNode({n:normalLocal,facets,damage:sample.y});
  const delta=transformNormalToView(tilted).normalize().sub(transformNormalToView(normalLocal).normalize());
  material.normalNode=materialNormal.add(delta).normalize();
  material.metalnessNode=materialMetalness.mul(sample.y.oneMinus()).max(profile);
  const redToOrange=mix(vec3(.7,.008,.001),vec3(1,.12,.008),smoothstep(.55,.88,sample.x));
  const hotColor=mix(redToOrange,vec3(1,.42,.055),smoothstep(.88,1,sample.x));
  material.emissiveNode=hotColor.mul(sample.z.mul(5));
  if(incineration){
    if(!stateNode||!presenceNode)throw Error('Incineration appearance requires resident heat and material coverage');
    const front=incinerationNode({state:stateNode,facets,p}).toVar('incinerationFrontData');
    material.colorNode=materialColor.rgb.mul(mix(float(1),float(.018),front.y));
    material.roughnessNode=mix(materialRoughness,float(.97),front.y);
    const ember=mix(vec3(1,.006,.0006),vec3(1,.16,.006),smoothstep(.25,.7,front.w));
    const incandescent=mix(ember,vec3(1,.82,.42),smoothstep(.72,1,front.w));
    material.emissiveNode=incandescent.mul(front.z).mul(glow);
  }
  // Diagnostic emission is unlit data; the beauty response stays unchanged.
  const diagnostic=mix(vec3(sample.y),vec3(sample.x,0,0),inspection.greaterThan(1.5));
  material.colorNode=mix(material.colorNode,vec3(0),inspection.greaterThan(.5));
  material.emissiveNode=mix(material.emissiveNode,diagnostic,inspection.greaterThan(.5));
  material.outputNode=inspection.greaterThan(.5).select(THREE.TSL.vec4(diagnostic,1),THREE.TSL.output);
  return {material,setAppearance(value){if(!incineration)throw Error('No incineration appearance on this material');if(!Number.isFinite(value.glow)||value.glow<0)throw Error('Invalid incineration glow');glow.value=value.glow;},update(seconds,displayed=material){clock.value=seconds;for(const target of new Set([material,displayed])){target.color.copy(original.color);target.roughness=original.roughness;target.metalness=original.metalness;}},setView(next){if(!['beauty','char','heat'].includes(next))throw Error('Invalid burn view');view=next;inspection.value=['beauty','char','heat'].indexOf(next);},set(next){if(stateNode)throw Error('Live thermal state is GPU-owned');const c=checkedBurnControls(next);controls.value.set(c.heat,c.char,c.reaction);profile.value=c.profile==='metal'?1:0;},
    read:()=>({appearanceModel:incineration?'incineration-front-v1':'char-facet-crust-v1',appearance:incineration?{glow:glow.value}:null,sourceMaterial:original.uuid,
      view,coverage:stateNode?'resident':coverage,
      stateAuthority:stateIdentity||'synthetic-held-exposure-v1',
      controls:stateNode?null:{heat:controls.value.x,char:controls.value.y,reaction:controls.value.z,profile:profile.value===1?'metal':'wood'},
      appearanceSeconds:clock.value,facetRotationPerAxisRadians:.04,
      maps:{baseColor:original.map?.uuid||null,normal:original.normalMap?.uuid||null,metalness:original.metalnessMap?.uuid||null,roughness:original.roughnessMap?.uuid||null}}),dispose:()=>material.dispose()};
}
