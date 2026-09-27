// Both consumers compile these same functions. Relative radiant intensity is
// per scene-distance squared; extinction length remains volume-local. This
// first ordinary-scene route has identity scene/volume transforms.
export const SCENE_MEDIUM_LOOKUP_WGSL = `
fn sceneMediumTransmission(tau: texture_3d<f32>, source: vec3<f32>, receiver: vec3<f32>) -> f32 {
  let dims = textureDimensions(tau);
  let lower = vec3<f32>(-1.0);
  let upper = lower + vec3<f32>(dims) * (2.0 / f32(dims.x));
  let delta = receiver-source;
  var enter = 0.0; var exit = 1.0;
  for (var axis=0u; axis<3u; axis++) {
    if (abs(delta[axis]) < 1e-20) {
      if (source[axis]<lower[axis] || source[axis]>upper[axis]) { return 1.0; }
    } else {
      let a=(lower[axis]-source[axis])/delta[axis];
      let b=(upper[axis]-source[axis])/delta[axis];
      enter=max(enter,min(a,b)); exit=min(exit,max(a,b));
    }
  }
  if (exit<=enter || dot(delta,delta)<1e-20) { return 1.0; }
  // Outside receivers sample their actual segment exit, not a nearest box
  // point. Manually interpolate r32float, requiring no optional filtering.
  let cell=clamp((source+delta*exit-lower)/(2.0/f32(dims.x))-0.5,
    vec3<f32>(0.0),vec3<f32>(dims)-1.0);
  let base=vec3<i32>(floor(cell)); let fraction=fract(cell);
  var optical=0.0;
  for(var z=0;z<2;z++) { for(var y=0;y<2;y++) { for(var x=0;x<2;x++) {
    let offset=vec3<i32>(x,y,z);
    let weights=select(vec3<f32>(1.0)-fraction,fraction,vec3<bool>(x==1,y==1,z==1));
    optical+=textureLoad(tau,min(base+offset,vec3<i32>(dims)-1),0).r*weights.x*weights.y*weights.z;
  }}}
  return exp(-max(0.0,optical));
}`;

export const SCENE_POINT_TRANSFER_WGSL = `
fn scenePointTransfer(tau: texture_3d<f32>, radial: texture_cube<f32>, radialSampler: sampler,
  source: vec3<f32>, intensity: vec3<f32>, receiver: vec3<f32>, normal: vec3<f32>, resolution: f32) -> vec3<f32> {
  let delta=receiver-source; let distance=length(delta);
  // The mathematical point is singular. No finite receiver contribution is
  // defined exactly at it; no fitted near-field radius is introduced.
  if (distance<1e-10) { return vec3<f32>(0.0); }
  let facing=select(-1.0,1.0,dot(normal,-delta)>=0.0);
  let offset=normal*facing*max(0.001,distance*2.0/resolution);
  let shadowDelta=delta+offset; let shadowLength=length(shadowDelta);
  let direction=shadowDelta/max(shadowLength,1e-10);
  // Three's WebGPU color-cube convention flips X. Do not apply the material
  // environment rotation: this is world-space visibility, not an environment.
  let stored=textureSampleLevel(radial,radialSampler,vec3<f32>(-direction.x,direction.yz),0.0).r;
  let visible=select(0.0,1.0,shadowLength-max(0.001,shadowLength*2.0/resolution)<=stored);
  return intensity*(visible*sceneMediumTransmission(tau,source,receiver)/(distance*distance));
}`;

export const SCENE_POINT_SMOKE_WGSL = `
@group(2) @binding(0) var scenePointTau: texture_3d<f32>;
@group(2) @binding(1) var scenePointRadial: texture_cube<f32>;
@group(2) @binding(2) var scenePointSampler: sampler;
struct ScenePointParameters { position: vec4<f32>, intensity: vec4<f32> }
@group(2) @binding(3) var<uniform> scenePoint: ScenePointParameters;
${SCENE_MEDIUM_LOOKUP_WGSL}
${SCENE_POINT_TRANSFER_WGSL}
fn scenePointIncident(receiver: vec3<f32>) -> vec3<f32> {
  // Isotropic scattering uses angular-mean incident radiance, not the
  // cosine-weighted surface irradiance. The same source has no fitted gain.
  return scenePointTransfer(scenePointTau,scenePointRadial,scenePointSampler,
    scenePoint.position.xyz,scenePoint.intensity.xyz,receiver,vec3<f32>(0.0),scenePoint.position.w)/12.566370614359172;
}`;

export function createScenePointBindings(device) {
  const layout=device.createBindGroupLayout({label:'shared point incident light',entries:[
    {binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'unfilterable-float',viewDimension:'3d'}},
    {binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'float',viewDimension:'cube'}},
    {binding:2,visibility:GPUShaderStage.FRAGMENT,sampler:{type:'non-filtering'}},
    {binding:3,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}},
  ]});
  const params=device.createBuffer({label:'shared point light parameters',size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  const sampler=device.createSampler({minFilter:'nearest',magFilter:'nearest'});
  let tau=null,radial=null,group=null;
  return {layout,update(input) {
    const {medium,shadow,source}=input;
    if (medium?.status!=='encoded'||!medium.texture||!shadow?.texture||!shadow.effective) throw new Error('shared point light requires current medium and effective solid visibility');
    if (medium.sourcePosition.some((v,i)=>v!==source.position[i])) throw new Error('shared point light medium/source position mismatch');
    device.queue.writeBuffer(params,0,new Float32Array([...source.position,shadow.resolution,...source.intensity,0]));
    if(tau!==medium.texture||radial!==shadow.texture) {
      tau=medium.texture;radial=shadow.texture;
      group=device.createBindGroup({layout,entries:[{binding:0,resource:tau.createView()},
        {binding:1,resource:radial.createView({dimension:'cube'})},{binding:2,resource:sampler},{binding:3,resource:{buffer:params}}]});
    }
    return group;
  },dispose(){params.destroy();}};
}
