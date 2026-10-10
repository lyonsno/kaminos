import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { createSceneGI } from '../../scene-gi.mjs';
import { buildPhotoSurface } from './photo-surface.js';
import { texturePixels } from './photo-contracts.js';
import { inferEmission, emissionTexturePixels } from './emission.js';

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

export class MaterialPhotoViewer {
  async init(canvas, device) {
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
    this.fill = new THREE.DirectionalLight(0xbbddff, 0.65);
    this.fill.position.set(-2, 0.5, 1);
    this.scene.add(this.key, this.key.target, this.fill, new THREE.HemisphereLight(0xe7edff, 0x484b3b, 0.5));
    // A small studio environment gives metals real reflections, not a diffuse substitute.
    const studio = new THREE.Scene();
    studio.background = new THREE.Color(0x59666b);
    const walls = new THREE.Mesh(new THREE.BoxGeometry(12, 12, 12), new THREE.MeshBasicNodeMaterial({ color: 0x555e63, side: THREE.BackSide }));
    studio.add(walls);
    for (const [position, color, scale] of [
      [[-3,3,2], 0xffffff, [2,4,1]], [[3,1,-2], 0x91b4d5, [2,3,1]], [[0,4,-1], 0xffe7bc, [4,1,3]],
    ]) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(...scale), new THREE.MeshBasicNodeMaterial({ color }));
      panel.position.fromArray(position); studio.add(panel);
    }
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.environment = pmrem.fromScene(studio);
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = 0.6;
    pmrem.dispose();
    studio.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); });
    this.aoStrength = uniform(0.5);
    this.gi = createSceneGI(this.scene, this.camera, this.aoStrength);
    this.setTuning(DEFAULT_TUNING);
    this.pipeline = new THREE.RenderPipeline(this.renderer);
    this.pipeline.outputNode = this.gi.output();
    this.textures = [];
    this.mode = 'original'; this.map = 'surface'; this.useGI = true; this.glow = false;
    this.orbit = new THREE.Vector2(); this.target = new THREE.Vector2(); this.current = new THREE.Vector2();
    this.reset();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
    this.listeners = {
      pointerdown: event => { this.drag = { x: event.clientX, y: event.clientY, ox: this.orbit.x, oy: this.orbit.y }; canvas.setPointerCapture(event.pointerId); },
      pointermove: event => {
        const bounds = canvas.getBoundingClientRect();
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
    for (const [event, handler] of Object.entries(this.listeners)) canvas.addEventListener(event, handler);
    this.renderer.setAnimationLoop(() => this.render());
    return this;
  }

  texture(map, role) {
    const pixels = texturePixels(map, role);
    const texture = new THREE.DataTexture(pixels.data, pixels.width, pixels.height, THREE.RGBAFormat);
    texture.colorSpace = pixels.color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.magFilter = texture.minFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    this.textures.push(texture);
    return texture;
  }

  setImage(image, result = null) {
    this.clear();
    this.image = image;
    this.aspect = image.width / image.height;
    const texture = this.texture(image, 'albedo');
    this.original = new THREE.Mesh(new THREE.PlaneGeometry(this.aspect, 1), new THREE.MeshBasicNodeMaterial({ map: texture, toneMapped: false, side: THREE.DoubleSide }));
    this.scene.add(this.original);
    if (result) {
      const surface = buildPhotoSurface(result, this.aspect);
      this.surface = surface;
      const geometry = new THREE.BufferGeometry();
      for (const [name, data, size] of [['position',surface.position,3], ['normal',surface.normal,3], ['uv',surface.uv,2]]) {
        geometry.setAttribute(name, new THREE.BufferAttribute(data, size));
      }
      geometry.setIndex(new THREE.BufferAttribute(surface.indices, 1));
      this.photoMaterial = new THREE.MeshBasicNodeMaterial({ map: texture, side: THREE.DoubleSide, toneMapped: false });
      this.relitMaterial = new THREE.MeshStandardNodeMaterial({ map: texture, side: THREE.DoubleSide, roughness: .4, metalness: 0, emissiveIntensity: 0 });
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
    this.reset(); this.resize();
  }

  setMaterials(result) {
    if (!this.mesh) throw new Error('Materials require a depth surface');
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
    this.physicalMaterial.emissiveMap = this.emissionMap;
    this.physicalMaterial.needsUpdate = true;
  }

  getTuning() { return {...DEFAULT_TUNING,...this.settings}; }
  setTuning(value) {
    const next = validateTuning({...this.getTuning(),...value});
    this.gi.setSettings({mode:'combined',view:'scene',...pick(next,GI_KEYS)});
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
      camera:{orbit:this.orbit.toArray()},gi:this.useGI,glow:this.glow??false};
  }
  presentation() {
    const materialState=material=>material?{uuid:material.uuid,roughness:material.roughness,metalness:material.metalness,
      mapUUID:material.map?.uuid??null,roughnessMapUUID:material.roughnessMap?.uuid??null,metalnessMapUUID:material.metalnessMap?.uuid??null,
      emissiveMapUUID:material.emissiveMap?.uuid??null,emissiveIntensity:material.emissiveIntensity}:null;
    const lightDirection=this.key.position.clone().sub(this.key.target.position).normalize();
    return {mode:this.mode,map:this.map,camera:{position:this.camera.position.toArray(),quaternion:this.camera.quaternion.toArray(),orbit:this.orbit.toArray(),zoom:this.camera.zoom},
      light:{...this.getLightHandle(),position:this.key.position.toArray(),target:this.key.target.position.toArray(),direction:lightDirection.toArray(),intensity:this.key.intensity,color:this.key.color.getHex()},
      geometryUUID:this.mesh?.geometry.uuid??null,normalsMatchSurface:this.mesh?.geometry.attributes.normal.array===this.surface?.normal,
      emissiveIntensity:this.mesh?.material.emissiveIntensity??0,emissionStats:this.emissionStats??null,
      physicalbaseline:{geometryId:this.mesh?.geometry.uuid??null,exposure:this.renderer.toneMappingExposure,relit:materialState(this.relitMaterial),materials:materialState(this.physicalMaterial),
        activeMaterial:materialState(this.mesh?.material),environmentIntensity:this.scene.environmentIntensity},
      glow:this.glow,gi:{enabled:this.useGI,settings:this.getTuning(),debugState:this.gi.debugState()}};
  }
  applyPreset(value) {
    if(value?.schema!=='kaminos.material-photo-preset.v1')throw new Error('Invalid preset schema');
    const tuning=validateTuning(value.settings),light=validateLight(value.light),orbit=value.camera?.orbit;
    if(!Array.isArray(orbit)||orbit.length!==2||!orbit.every(Number.isFinite)||Math.abs(orbit[0])>.5||Math.abs(orbit[1])>.35)throw new Error('Invalid preset camera orbit');
    if(typeof value.gi!=='boolean'||typeof value.glow!=='boolean')throw new Error('Invalid preset GI or glow');
    this.setTuning(tuning);
    this.setLightHandle(light.x,light.y);
    this.orbit.fromArray(orbit);this.target.set(0,0);this.current.set(0,0);
    this.useGI=value.gi;this.glow=value.glow;
  }
  reset() { this.orbit?.set(0,0); this.target?.set(0,0); this.current?.set(0,0); this.setLight(); if (this.renderer) this.renderer.toneMappingExposure=1; }
  resize() {
    const {width,height}=this.canvas.parentElement.getBoundingClientRect();
    if (!width || !height) return;
    this.renderer.setSize(width,height,false);
    this.camera.aspect=width/height;
    this.camera.zoom=Math.min(1,this.camera.aspect/(this.aspect||1))*.79;
    this.camera.updateProjectionMatrix();
  }
  render() {
    if (!this.original || document.hidden) return;
    const original=this.mode==='original';
    this.original.visible=original;
    if (this.mesh) {
      this.mesh.visible=!original;
      if (this.map==='normals') { this.mapMaterial.map=this.normalMap; this.mesh.material=this.mapMaterial; }
      else if (this.map!=='surface' && this.maps?.[this.map]) {
        this.mapMaterial.map=this.maps[this.map]; this.mesh.material=this.mapMaterial;
      } else this.mesh.material=this.mode==='materials'&&this.maps?this.physicalMaterial:this.mode==='relit'?this.relitMaterial:this.photoMaterial;
      this.physicalMaterial.emissiveIntensity=this.mode==='materials'&&this.glow?1:0;
    }
    this.current.lerp(this.target,.08);
    this.camera.position.set(this.orbit.x+this.current.x,-this.orbit.y-this.current.y,1);
    this.camera.lookAt(0,0,0);
    this.updateLight();
    if (!original && ['relit','materials'].includes(this.mode) && this.map==='surface' && this.useGI) this.pipeline.render();
    else this.renderer.render(this.scene,this.camera);
  }
  clear() {
    for (const mesh of [this.mesh,this.original]) if(mesh){this.scene.remove(mesh);mesh.geometry.dispose();}
    for (const material of [this.original?.material,this.photoMaterial,this.relitMaterial,this.physicalMaterial,this.mapMaterial]) material?.dispose();
    for (const texture of this.textures??[]) texture.dispose();
    this.textures=[]; this.original=this.mesh=this.maps=this.surface=this.normalMap=this.emissionMap=this.emissionStats=this.image=null;
    this.photoMaterial=this.relitMaterial=this.physicalMaterial=this.mapMaterial=null;
  }
  async dispose() {
    this.renderer?.setAnimationLoop(null);this.resizeObserver?.disconnect();
    for(const [event,handler]of Object.entries(this.listeners??{}))this.canvas.removeEventListener(event,handler);
    try{await this.renderer?.backend.device.queue.onSubmittedWorkDone();}
    finally{this.clear();this.pipeline?.dispose();this.gi?.source.dispose();this.gi?.beauty.dispose();this.environment?.dispose();this.renderer?.dispose();}
  }
}
