import * as THREE from '../lib/three.webgpu.js';
import {atmosphereSettings} from './atmosphere-plan.mjs';
import {displayAgXRGB} from '../volume-agx.mjs';
const {uniform,vec3,vec4,float,instanceIndex,positionGeometry,positionView,cameraWorldMatrix,wgslFn,varying,fog,uv,mix}=THREE.TSL;
// One immutable seed per instance, evaluated only in the vertex stage. Camera
// movement changes the wrapping boundary, not the world positions inside it.
const worldPoint=wgslFn(`fn ash_world_point(i:u32,t:f32,c:vec3<f32>,extent:vec3<f32>,wind:vec3<f32>)->vec3<f32>{
 var r=vec3<f32>(0.0);
 for(var k=0u;k<3u;k++){var h=i*3u+k+1u;h=(h^(h>>16u))*0x7feb352du;h=(h^(h>>15u))*0x846ca68bu;let seed=f32(h^(h>>16u))/4294967296.0;r[k]=seed*extent[k]+wind[k]*t;}
 return r-floor((r-c+extent*.5)/extent)*extent;
}`);
export function createAshAtmosphere({scene,camera,renderer,volume,groundY=0,settings={}}){
 if(scene.fogNode||scene.fog)throw Error('Ash atmosphere requires an unclaimed scene fog channel');
 if(!volume?.setSharedAshAtmosphere)throw Error('Shared flame atmosphere interface unavailable');
 let config=atmosphereSettings(settings),disposed=false,time=0,lastExposure=renderer.toneMappingExposure;
 const previous={fog:scene.fogNode,background:scene.backgroundNode,volume:volume.sharedAshAtmosphere()};
 const clock=uniform(0),eye=uniform(new THREE.Vector3()),extent=uniform(new THREE.Vector3(...config.extent)),wind=uniform(new THREE.Vector3(...config.wind)),size=uniform(config.flakeSize),opacity=uniform(config.opacity),density=uniform(config.density),color=uniform(new THREE.Color(...config.color));
 const haze=fog(color,float(1).sub(positionView.length().mul(density).negate().exp()));
 // The backdrop is the far end of the same analytic medium. No sky mesh or
 // second full-screen pass; material fragments and the existing flame draw pay
 // the extra attenuation arithmetic.
 const baseBackground=previous.background??(scene.background?.isColor?uniform(scene.background.clone()):null);
 const background=baseBackground?vec4(mix(baseBackground.rgb,color,float(1).sub(density.mul(60).negate().exp())),1):null;
 const geometry=new THREE.PlaneGeometry(1,1),material=new THREE.MeshBasicNodeMaterial({color:0xc9c1b2,transparent:true,depthWrite:false,side:THREE.DoubleSide});
 const center=worldPoint({i:instanceIndex,t:clock,c:eye,extent,wind});
 const relative=varying(center.sub(eye).div(extent.mul(.5)),'ash_relative');
 const worldHeight=varying(center.y,'ash_height');
 const grain=THREE.TSL.hash(instanceIndex).mul(.7).add(.65);
 material.positionNode=center.add(cameraWorldMatrix.mul(vec4(positionGeometry.xy.mul(size).mul(grain),0,0)).xyz);
 const grainMask=float(1).sub(uv().sub(.5).mul(vec3(1.0,1.4,1.0).xy).length().mul(2).pow(2)).clamp(0,1);
 material.opacityNode=grainMask.mul(opacity).mul(float(1).sub(relative.x.abs().max(relative.y.abs()).max(relative.z.abs())).div(.16).clamp(0,1)).mul(worldHeight.sub(groundY).div(.12).clamp(0,1)).mul(positionView.length().sub(.25).div(.5).clamp(0,1));
 const root=new THREE.Group();root.name='Scene-wide fine ash';let flakes;
 const allocate=count=>{const next=new THREE.InstancedMesh(geometry,material,count);next.frustumCulled=false;next.castShadow=false;flakes?.removeFromParent();flakes?.dispose();flakes=next;root.add(flakes);};
 allocate(config.count);
 const apply=()=>{
  root.visible=config.enabled;if(config.count>flakes.instanceMatrix.count)allocate(config.count);flakes.count=config.count;
  extent.value.fromArray(config.extent);wind.value.fromArray(config.wind);size.value=config.flakeSize;opacity.value=config.opacity;density.value=config.enabled?config.density:0;color.value.setRGB(...config.color);
  scene.fogNode=config.enabled?haze:previous.fog;scene.backgroundNode=config.enabled&&background?background:previous.background;
  volume.setSharedAshAtmosphere({density:config.enabled?config.density:0,color:config.color,displayColor:displayAgXRGB(config.color.map(v=>v*(renderer.toneMappingExposure??1)))});
 };
 apply();
 return {root,
  set(patch){if(disposed)throw Error('Ash atmosphere disposed');const next=atmosphereSettings({...config,...patch});config=next;apply();return this.read();},
  tick(seconds){if(disposed)return;if(!Number.isFinite(seconds)||seconds<0)throw Error('Invalid ash atmosphere clock');if(renderer.toneMappingExposure!==lastExposure){lastExposure=renderer.toneMappingExposure;apply();}time=seconds;clock.value=time;eye.value.copy(camera.position);},
  read:()=>({schema:'kaminos.ash-atmosphere.v1',backend:'webgpu-analytic-haze-and-vertex-flakes',settings:structuredClone(config),time,computeDispatches:0,particleStateBytes:0,allocatedInstances:flakes.instanceMatrix.count,instanceMatrixBytes:flakes.instanceMatrix.array.byteLength,displayCamera:'AgX',sceneCameraMatches:renderer.toneMapping===THREE.AgXToneMapping,backdropIntegration:background?'shared-distance-haze':'existing-texture-backdrop-preserved',flame:volume.sharedAshAtmosphere(),approximation:'analytic homogeneous haze; wrapping distant flakes are visual, not conserved deposit mass'}),
  dispose(){if(disposed)return;disposed=true;root.removeFromParent();flakes.dispose();geometry.dispose();material.dispose();if(scene.fogNode===haze||scene.fogNode===previous.fog)scene.fogNode=previous.fog;if(scene.backgroundNode===background||scene.backgroundNode===previous.background)scene.backgroundNode=previous.background;volume.setSharedAshAtmosphere(previous.volume);}
 };
}
