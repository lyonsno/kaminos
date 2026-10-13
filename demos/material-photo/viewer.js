import * as THREE from 'three/webgpu';
import { uniform, texture, output, emissive, vec4, mrt, pass, float } from 'three/tsl';
import { bloom } from '../../lib/addons/tsl/display/BloomNode.js';
import { createSceneGI } from '../../scene-gi.mjs';
import { buildPhotoSurface } from './photo-surface.js';
import { texturePixels } from './photo-contracts.js';
import { inferEmission, emissionTexturePixels } from './emission.js';
import { DEFAULT_CONTRAST, validateContrast, analyzeMaterialContrast, adjustMaterialMaps } from './material-contrast.js';
import { DEFAULT_EFFECTS, validateEffects } from './effects.js';

const GI_KEYS = ['gain','radius','thickness','slices','steps','denoise'];
const ESTIMATOR_KEYS = ['expFactor','screenSpaceSampling','linearThickness','backfaceLighting','depthPhi','normalPhi','lumaPhi'];
const DEFAULT_TUNING = { gain:1, radius:.15, thickness:.03, slices:6, steps:16, denoise:3, aoStrength:.5,
  expFactor:2, screenSpaceSampling:false, linearThickness:false, backfaceLighting:0, depthPhi:.1, normalPhi:5, lumaPhi:5 };
const pick = (value,keys) => Object.fromEntries(keys.map(key=>[key,value[key]]));

function validateTuning(value) {
  for (const key of Object.keys(DEFAULT_TUNING)) {
    if (typeof DEFAULT_TUNING[key] === 'boolean') {
      if (typeof value?.[key] !== 'boolean') throw new Error(`Invalid preset ${key}`);
    } else if (!Number.isFinite(value?.[key]) || value[key] < 0) throw new Error(`Invalid preset ${key}`);
  }
  for (const key of ['radius','thickness','slices','steps','expFactor','depthPhi','normalPhi','lumaPhi']) {
    if (value[key] === 0) throw new Error(`Preset ${key} must be positive`);
  }
  for (const key of ['slices','steps']) if (!Number.isInteger(value[key])) throw new Error(`Preset ${key} must be integral`);
  return pick(value,Object.keys(DEFAULT_TUNING));
}

function validateLight(value) {
  if (!Number.isFinite(value?.x) || !Number.isFinite(value?.y) || Math.hypot(value.x,value.y)>1) throw new Error('Invalid preset light hemisphere');
  return {x:value.x,y:value.y};
}
function validateLighting(value) {
  if(!Number.isFinite(value?.rotation)||!Number.isFinite(value?.intensity)||value.intensity<0||
    !Number.isFinite(value?.direct)||value.direct<0)throw Error('Invalid preset environment lighting');
  return {rotation:value.rotation,intensity:value.intensity,direct:value.direct};
}

export class MaterialPhotoViewer {
  async init(canvas, device, {interactive=true,interactionTarget=canvas,rig=null}={}) {
    this.canvas = canvas;
    this.textures = [];
    this.renderer = new THREE.WebGPURenderer({ canvas, device, antialias: true });
    await this.renderer.init();
    if (this.renderer.backend.device !== device) throw new Error('Renderer did not borrow the inference GPUDevice');
    this.renderer.setPixelRatio(devicePixelRatio);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x111718);
    this.camera = new THREE.PerspectiveCamera(2 * Math.atan(0.5) * 180 / Math.PI, 1, 0.001, 100);
    this.camera.position.z = 1;
    this.key = new THREE.DirectionalLight(0xffeedc, 3);
    this.scene.add(this.key, this.key.target);
    this.setLighting({rotation:0,intensity:1,direct:1});
    this.aoStrength = uniform(0.5);
    this.gi = createSceneGI(this.scene, this.camera, this.aoStrength, {
      receiveWeight:material=>material===this.physicalMaterial?(this.reflectionWeight??float(1)):1,
    });
    this.setTuning(DEFAULT_TUNING);
    this.pipeline = new THREE.RenderPipeline(this.renderer);
    this.pipeline.outputNode = this.gi.output();
    this.gi.beauty.setMRT(mrt({output,emissive}));
    this.directPass=pass(this.scene,this.camera);
    this.directPass.setMRT(mrt({output,emissive}));
    this.blooms=[this.gi.beauty,this.directPass].map(source=>bloom(source.getTextureNode('emissive')));
    this.bloomPipelines=[this.gi.output(),this.directPass.getTextureNode('output')].map((source,index)=>{
      const pipeline=new THREE.RenderPipeline(this.renderer);
      pipeline.outputNode=source.add(this.blooms[index]);return pipeline;
    });
    this.setEffects(DEFAULT_EFFECTS);
    this.textures = [];
    this.mode = 'original'; this.map = 'surface'; this.useGI = true; this.glow = false;
    this.rig=rig;
    this.orbit = rig?.orbit??new THREE.Vector2(); this.target = rig?.target??new THREE.Vector2(); this.current = rig?.current??new THREE.Vector2();
    this.reset();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
    this.listeners = {
      pointerdown: event => this.beginOrbit(event),
      pointermove: event => {
        const bounds = interactionTarget.getBoundingClientRect();
        if (this.drag) this.orbit.set(
          THREE.MathUtils.clamp(this.drag.ox + (event.clientX-this.drag.x)/bounds.width, -0.5, 0.5),
          THREE.MathUtils.clamp(this.drag.oy + (event.clientY-this.drag.y)/bounds.height, -0.35, 0.35));
        else if (event.pointerType !== 'touch' && !matchMedia('(prefers-reduced-motion: reduce)').matches) this.target.set(
          ((event.clientX-bounds.left)/bounds.width-.5)*.025, ((event.clientY-bounds.top)/bounds.height-.5)*.02);
      },
      pointerup: () => { this.drag = null; }, pointercancel: () => { this.drag = null; },
      pointerleave: () => this.target.set(0,0),
      keydown: event => {
        const delta = { ArrowLeft: [-.04,0], ArrowRight:[.04,0], ArrowUp:[0,-.04], ArrowDown:[0,.04] }[event.key];
        if (delta) { event.preventDefault(); this.orbit.x = THREE.MathUtils.clamp(this.orbit.x+delta[0],-.5,.5); this.orbit.y = THREE.MathUtils.clamp(this.orbit.y+delta[1],-.35,.35); }
        if (event.key === 'Home') this.reset();
      },
    };
    this.interactionTarget=interactionTarget;
    if(interactive)for (const [event, handler] of Object.entries(this.listeners)) interactionTarget.addEventListener(event, handler);
    else this.listeners={};
    this.renderer.setAnimationLoop(time => this.render(time));
    return this;
  }

  beginOrbit(event) {
    if(event.button!==0||event.target?.closest?.('button,input,select,a'))return;
    this.drag={x:event.clientX,y:event.clientY,ox:this.orbit.x,oy:this.orbit.y};
    this.interactionTarget.setPointerCapture(event.pointerId);
  }

  texture(map, role) {
    const pixels = texturePixels(map, role);
    const texture = new THREE.DataTexture(pixels.data, pixels.width, pixels.height, THREE.RGBAFormat);
    texture.colorSpace = pixels.color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    this.textures.push(texture);
    return texture;
  }

  setImage(image, result = null, shared = null, cutout = null) {
    if(cutout&&(cutout.width!==image.width||cutout.height!==image.height))throw Error('Display cutout does not match photograph');
    this.clear();
    this.image = image;
    this.aspect = image.width / image.height;
    const texture = this.texture(image, 'albedo');
    this.original = new THREE.Mesh(new THREE.PlaneGeometry(this.aspect, 1), new THREE.MeshBasicNodeMaterial({ map: texture, toneMapped: false, side: THREE.DoubleSide }));
    this.scene.add(this.original);
    if (result) {
      const surface = shared?.surface??buildPhotoSurface(result, this.aspect);
      this.surface = surface;
      const geometry = shared?.geometry??new THREE.BufferGeometry();
      this.borrowedGeometry=!!shared;
      if(!shared){
        for (const [name, data, size] of [['position',surface.position,3], ['normal',surface.normal,3], ['uv',surface.uv,2]]) {
          geometry.setAttribute(name, new THREE.BufferAttribute(data, size));
        }
        geometry.setIndex(new THREE.BufferAttribute(surface.indices, 1));
      }
      this.photoMaterial = new THREE.MeshBasicNodeMaterial({ map: texture, side: THREE.DoubleSide, toneMapped: false });
      this.relitMaterial = new THREE.MeshStandardNodeMaterial({ map: texture, side: THREE.DoubleSide, roughness: .4, metalness: 0, emissiveIntensity: 0 });
      // Three forwards context-modified output into MRT only for a custom output.
      this.relitMaterial.outputNode=output;
      this.physicalMaterial = new THREE.MeshStandardNodeMaterial({ map: texture, side: THREE.DoubleSide, roughness: 1, metalness: 0, emissive: 0xffffff, emissiveIntensity: 0 });
      this.mesh = new THREE.Mesh(geometry, this.photoMaterial);
      this.mesh.frustumCulled = false;
      this.scene.add(this.mesh);
      this.camera.far = surface.far;
      const normalPixels = new Uint8Array(result.width * result.height * 4);
      for (let i=0; i<result.width*result.height; i++) {
        for (let c=0;c<3;c++) normalPixels[i*4+c] = Math.round((surface.normal[i*3+c]*.5+.5)*255);
        normalPixels[i*4+3] = 255;
      }
      this.normalMap = this.texture({ width:result.width,height:result.height,data:normalPixels }, 'normals');
      this.mapMaterial = new THREE.MeshBasicNodeMaterial({ map: this.normalMap, side: THREE.DoubleSide, toneMapped:false });
    }
    this.cutout=cutout;
    if(cutout){
      this.cutoutMap=this.texture(cutout,'mask');
      for(const material of [this.original.material,this.photoMaterial,this.relitMaterial,this.physicalMaterial,this.mapMaterial].filter(Boolean)){
        material.alphaMap=this.cutoutMap;material.alphaTest=.5;material.alphaToCoverage=true;
      }
    }
    this.reset(); this.resize();
  }

  setMaterials(result) {
    if (!this.mesh) throw new Error('Materials require a depth surface');
    this.releaseMaterialTextures();
    this.rawMaterialMaps=result.maps;
    this.contrastAnalysis=analyzeMaterialContrast(this.image,result.maps);
    this.maps = {};
    for (const name of ['albedo','roughness','metallic','orm']) this.maps[name] = this.texture(result.maps[name], name);
    this.physicalMaterial.map = this.maps.albedo;
    this.physicalMaterial.roughnessMap = this.physicalMaterial.metalnessMap = this.maps.orm;
    this.physicalMaterial.roughness = this.physicalMaterial.metalness = 1;
    const emission = emissionTexturePixels(inferEmission(this.image, result.maps.albedo));
    let sum=0,nonzero=0;
    for(let i=0;i<emission.data.length;i++)if(i%4<3){sum+=emission.data[i];if(emission.data[i]>0)nonzero++;}
    this.emissionStats={width:emission.width,height:emission.height,sum,nonzero};
    const upload=Uint16Array.from(emission.data,value=>THREE.DataUtils.toHalfFloat(value));
    this.emissionMap = new THREE.DataTexture(upload, emission.width, emission.height, THREE.RGBAFormat, THREE.HalfFloatType);
    this.emissionMap.colorSpace = THREE.NoColorSpace;
    this.emissionMap.magFilter = this.emissionMap.minFilter = THREE.LinearFilter;
    this.emissionMap.needsUpdate = true;
    this.textures.push(this.emissionMap);
    this.maps.emission = this.emissionMap;
    this.rawTextures={...this.maps};
    this.physicalMaterial.emissiveMap = this.emissionMap;
    this.installEmissionNodes();
    this.physicalMaterial.needsUpdate = true;
    this.setMaterialContrast(this.getMaterialContrast());
  }

  getEffects(){return {...DEFAULT_EFFECTS,...this.effects};}
  setEffects(value) {
    const next=validateEffects({...this.getEffects(),...value});
    this.emissionUniforms??={intensity:uniform(1),threshold:uniform(.05),reflection:uniform(0),enabled:uniform(0)};
    this.emissionUniforms.intensity.value=next.glowIntensity;
    this.emissionUniforms.threshold.value=next.glowThreshold;
    this.emissionUniforms.reflection.value=next.emissionReflection;
    for(const effect of this.blooms??[]) {
      effect.strength.value=next.bloomIntensity;effect.radius.value=next.bloomRadius;effect.threshold.value=next.bloomThreshold;
    }
    this.effects=next;
  }
  installEmissionNodes() {
    this.setEffects(this.getEffects());
    const raw=texture(this.emissionMap).rgb,u=this.emissionUniforms;
    const peak=raw.r.max(raw.g).max(raw.b);
    const gate=peak.smoothstep(u.threshold,u.threshold.add(.05));
    this.reflectionWeight=float(1).sub(gate.mul(u.enabled).mul(u.reflection.oneMinus()));
    this.emissionNode=raw.mul(gate).mul(u.intensity).mul(u.enabled);
    this.physicalMaterial.emissiveNode=this.emissionNode;
    // Partition the inferred emitting area from the reflecting surface. This is
    // an artistic emitter mask, not a claim that real emitters cannot reflect.
    this.physicalMaterial.outputNode=vec4(output.rgb.sub(emissive).mul(this.reflectionWeight).add(emissive),output.a);
  }

  releaseTextures(textures) {
    const owned=new Set(textures.filter(Boolean));
    for(const texture of owned)texture.dispose();
    this.textures=this.textures.filter(texture=>!owned.has(texture));
  }
  releaseMaterialTextures() {
    this.releaseTextures([...Object.values(this.rawTextures??{}),...(this.derivedTextures??[])]);
    this.rawTextures=null;this.derivedTextures=[];
  }
  getMaterialContrast(){return {...DEFAULT_CONTRAST,...this.contrastSettings};}
  setMaterialContrast(value) {
    const next=validateContrast({...this.getMaterialContrast(),...value});
    if(this.rawMaterialMaps){
      const corrected=adjustMaterialMaps(this.rawMaterialMaps,this.contrastAnalysis,next);
      const derived=[];
      const maps={...this.rawTextures};
      if(corrected.maps!==this.rawMaterialMaps)for(const name of ['orm','roughness','metallic']){
        maps[name]=this.texture(corrected.maps[name],name);derived.push(maps[name]);
      }
      this.releaseTextures(this.derivedTextures??[]);this.derivedTextures=derived;this.maps=maps;
      this.physicalMaterial.roughnessMap=this.physicalMaterial.metalnessMap=maps.orm;
      this.physicalMaterial.needsUpdate=true;this.contrastGains=corrected.gains;
    }
    this.contrastSettings=next;
  }
  getDiagnostic(){return this.diagnostic??'scene';}
  setDiagnostic(view) {
    if(!['scene','ao','incoming','gi'].includes(view))throw Error('Invalid GI diagnostic view');
    this.gi.setSettings({mode:'combined',view,...pick(this.getTuning(),GI_KEYS)});
    this.diagnostic=view;
  }

  getTuning() { return {...DEFAULT_TUNING,...this.settings}; }
  getLighting() { return {...{rotation:0,intensity:1,direct:1},...this.lighting}; }
  setLighting(value) {
    const next=validateLighting({...this.getLighting(),...value});
    this.scene.environmentRotation.y=this.scene.backgroundRotation.y=next.rotation*Math.PI/180;
    this.scene.environmentIntensity=next.intensity;this.scene.backgroundIntensity=next.intensity;
    this.key.intensity=next.direct;this.lighting=next;
  }
  setEnvironment(texture) {
    const pmrem=new THREE.PMREMGenerator(this.renderer);
    let target;
    try{target=pmrem.fromEquirectangular(texture);}finally{pmrem.dispose();}
    const old=this.environment;this.environment=target;
    this.scene.environment=target.texture;this.scene.background=texture;this.scene.backgroundBlurriness=.08;
    this.environmentIdentity={...texture.userData};old?.dispose();
  }
  setTuning(value) {
    const next = validateTuning({...this.getTuning(),...value});
    this.gi.setSettings({mode:'combined',view:this.getDiagnostic(),...pick(next,GI_KEYS)});
    this.gi.setEstimatorSettings(pick(next,ESTIMATOR_KEYS));
    this.aoStrength.value = next.aoStrength;
    this.settings = next;
  }
  getLightHandle() { return {...this.lightHandle}; }
  setLightScreenPosition(u,v) { this.setLightHandle((u-.5)/.38,(.5-v)/.38); }
  setLightHandle(x,y) {
    const radius = Math.hypot(x,y);
    // Leave a few ulps inside the disk so projection and preset round trips agree.
    const scale = radius>1 ? (1-4*Number.EPSILON)/radius : 1;
    this.lightHandle = validateLight({x:x*scale,y:y*scale});
    this.updateLight();
  }
  setLight(azimuth=-35, elevation=35) {
    const a=THREE.MathUtils.degToRad(azimuth), e=THREE.MathUtils.degToRad(elevation);
    this.setLightHandle(Math.sin(a)*Math.cos(e),Math.sin(e));
  }
  updateLight() {
    if (!this.lightHandle) return;
    const {x,y}=this.lightHandle;
    // The disk represents the front hemisphere in the current camera frame.
    const direction = new THREE.Vector3(x,y,Math.max(.001,Math.sqrt(Math.max(0,1-x*x-y*y)))).normalize();
    direction.applyQuaternion(this.camera.quaternion);
    this.key.target.position.set(0,0,0);
    this.key.position.copy(direction.multiplyScalar(3));
  }
  exportPreset() {
    return {schema:'kaminos.material-photo-preset.v1',settings:this.getTuning(),light:this.getLightHandle(),
      camera:{orbit:this.orbit.toArray()},gi:this.useGI,glow:this.glow??false,lighting:this.getLighting(),contrast:this.getMaterialContrast(),diagnostic:this.getDiagnostic(),effects:this.getEffects()};
  }
  presentation() {
    const materialState=material=>material?{uuid:material.uuid,roughness:material.roughness,metalness:material.metalness,
      mapUUID:material.map?.uuid??null,roughnessMapUUID:material.roughnessMap?.uuid??null,metalnessMapUUID:material.metalnessMap?.uuid??null,
      emissiveMapUUID:material.emissiveMap?.uuid??null,emissiveIntensity:material.emissiveIntensity}:null;
    const lightDirection=this.key.position.clone().sub(this.key.target.position).normalize();
    return {mode:this.mode,map:this.map,cutout:this.cutout?{sample:this.cutout.sample,source:this.cutout.source,width:this.cutout.width,height:this.cutout.height}:null,camera:{position:this.camera.position.toArray(),quaternion:this.camera.quaternion.toArray(),orbit:this.orbit.toArray(),zoom:this.camera.zoom},
      light:{...this.getLightHandle(),position:this.key.position.toArray(),target:this.key.target.position.toArray(),direction:lightDirection.toArray(),intensity:this.key.intensity,color:this.key.color.getHex()},
      geometryUUID:this.mesh?.geometry.uuid??null,normalsMatchSurface:this.mesh?.geometry.attributes.normal.array===this.surface?.normal,
      emissiveIntensity:this.mesh?.material.emissiveIntensity??0,emissionStats:this.emissionStats??null,
      physicalbaseline:{geometryId:this.mesh?.geometry.uuid??null,exposure:this.renderer.toneMappingExposure,relit:materialState(this.relitMaterial),materials:materialState(this.physicalMaterial),
        activeMaterial:materialState(this.mesh?.material),environmentIntensity:this.scene.environmentIntensity},
      environment:{...this.environmentIdentity,...this.getLighting(),textureUUID:this.scene.environment?.uuid??null},
      contrast:{settings:this.getMaterialContrast(),analysis:this.contrastAnalysis??null,gains:this.contrastGains??null},
      glow:this.glow,effects:this.getEffects(),gi:{enabled:this.useGI,view:this.getDiagnostic(),settings:this.getTuning(),debugState:this.gi.debugState()}};
  }
  validatePreset(value) {
    if(value?.schema!=='kaminos.material-photo-preset.v1')throw new Error('Invalid preset schema');
    const tuning=validateTuning(value.settings),light=validateLight(value.light),orbit=value.camera?.orbit;
    if(!Array.isArray(orbit)||orbit.length!==2||!orbit.every(Number.isFinite)||Math.abs(orbit[0])>.5||Math.abs(orbit[1])>.35)throw new Error('Invalid preset camera orbit');
    if(typeof value.gi!=='boolean'||typeof value.glow!=='boolean')throw new Error('Invalid preset GI or glow');
    const lighting=validateLighting(value.lighting??this.getLighting());
    const contrast=validateContrast(value.contrast??DEFAULT_CONTRAST),diagnostic=value.diagnostic??'scene';
    if(!['scene','ao','incoming','gi'].includes(diagnostic))throw Error('Invalid GI diagnostic view');
    const effects=validateEffects(value.effects??DEFAULT_EFFECTS);
    return {tuning,light,orbit,lighting,contrast,diagnostic,effects};
  }
  applyPreset(value) {
    const {tuning,light,orbit,lighting,contrast,diagnostic,effects}=this.validatePreset(value);
    this.setTuning(tuning);
    this.setLighting(lighting);
    this.setLightHandle(light.x,light.y);
    this.orbit.fromArray(orbit);this.target.set(0,0);this.current.set(0,0);
    this.useGI=value.gi;this.glow=value.glow;
    this.setMaterialContrast(contrast);this.setDiagnostic(diagnostic);this.setEffects(effects);
  }
  reset() { this.orbit?.set(0,0); this.target?.set(0,0); this.current?.set(0,0); this.setLight(); }
  resize() {
    const {width,height}=this.canvas.parentElement.getBoundingClientRect();
    if (!width || !height) return;
    this.renderer.setSize(width,height,false);
    this.camera.aspect=width/height;
    this.baseZoom=Math.min(1,this.camera.aspect/(this.aspect||1))*.9;
    this.camera.zoom=this.baseZoom;
    this.camera.updateProjectionMatrix();
  }
  render(time) {
    if (!this.original || this.available===false || document.hidden || this.canvas?.parentElement.hidden || this.canvas?.closest?.('[data-tile]')?.hidden) return;
    const original=this.mode==='original';
    const lit=!original&&['relit','materials'].includes(this.mode)&&this.map==='surface';
    // WebGPU's output target applies renderer tone mapping even to basic materials.
    this.renderer.toneMapping=lit?THREE.ACESFilmicToneMapping:THREE.NoToneMapping;
    this.renderer.toneMappingExposure=lit?this.getEffects().exposure:1;
    this.original.visible=original;
    if (this.mesh) {
      const previousColorNode=this.mapMaterial.colorNode;
      this.mesh.visible=!original;
      this.mapMaterial.colorNode=null;
      if (this.map==='normals') { this.mapMaterial.map=this.normalMap; this.mesh.material=this.mapMaterial; }
      else if (this.map!=='surface' && this.maps?.[this.map]) {
        this.mapMaterial.map=this.maps[this.map]; this.mesh.material=this.mapMaterial;
        if(this.map==='emission')this.mapMaterial.colorNode=this.emissionNode;
      } else this.mesh.material=this.mode==='materials'&&this.maps?this.physicalMaterial:this.mode==='relit'?this.relitMaterial:this.photoMaterial;
      if(previousColorNode!==this.mapMaterial.colorNode)this.mapMaterial.needsUpdate=true;
      const emitting=this.mode==='materials'&&this.glow;
      this.physicalMaterial.emissiveIntensity=emitting?this.getEffects().glowIntensity:0;
      if(this.emissionUniforms)this.emissionUniforms.enabled.value=emitting?1:0;
    }
    if(!this.rig||this.rig.time!==time){this.current.lerp(this.target,.08);if(this.rig)this.rig.time=time;}
    this.camera.position.set(this.orbit.x+this.current.x,-this.orbit.y-this.current.y,1);
    this.camera.lookAt(0,0,0);
    // Retain the larger home framing, pulling back only when an orbit would
    // crop the reference photograph. All four views fit the same four corners.
    this.camera.zoom=this.baseZoom;
    this.camera.updateProjectionMatrix();this.camera.updateMatrixWorld();
    this.fitPoint??=new THREE.Vector3();
    const corners=this.original.geometry.attributes.position;let extent=0;
    for(let i=0;i<corners.count;i++){
      this.fitPoint.fromBufferAttribute(corners,i).project(this.camera);
      extent=Math.max(extent,Math.abs(this.fitPoint.x),Math.abs(this.fitPoint.y));
    }
    if(extent>.98){this.camera.zoom*=.98/extent;this.camera.updateProjectionMatrix();}
    this.updateLight();
    if(lit&&this.mode==='materials'&&this.glow&&this.getEffects().bloom&&this.getDiagnostic()==='scene'&&this.bloomPipelines) {
      this.bloomPipelines[this.useGI?0:1].render();
    } else if (lit && this.useGI) this.pipeline.render();
    else this.renderer.render(this.scene,this.camera);
  }
  clear() {
    for (const mesh of [this.mesh,this.original]) if(mesh){this.scene.remove(mesh);if(mesh===this.original||!this.borrowedGeometry)mesh.geometry.dispose();}
    for (const material of [this.original?.material,this.photoMaterial,this.relitMaterial,this.physicalMaterial,this.mapMaterial]) material?.dispose();
    for (const texture of this.textures??[]) texture.dispose();
    this.textures=[]; this.original=this.mesh=this.maps=this.surface=this.normalMap=this.emissionMap=this.emissionStats=this.image=null;
    this.rawMaterialMaps=this.rawTextures=this.contrastAnalysis=this.contrastGains=null;this.derivedTextures=[];
    this.reflectionWeight=this.emissionNode=null;
    this.photoMaterial=this.relitMaterial=this.physicalMaterial=this.mapMaterial=null;
    this.cutout=this.cutoutMap=null;
  }
  async dispose() {
    this.renderer?.setAnimationLoop(null);this.resizeObserver?.disconnect();
    for(const [event,handler]of Object.entries(this.listeners??{}))this.interactionTarget.removeEventListener(event,handler);
    try{await this.renderer?.backend.device.queue.onSubmittedWorkDone();}
    finally{this.clear();for(const pipeline of this.bloomPipelines??[])pipeline.dispose();for(const effect of this.blooms??[])effect.dispose();this.directPass?.dispose();this.pipeline?.dispose();this.gi?.source.dispose();this.gi?.beauty.dispose();this.environment?.dispose();this.renderer?.dispose();}
  }
}
