import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { createSceneGI } from '../../scene-gi.mjs';
import { buildPhotoSurface } from './photo-surface.js';
import { texturePixels } from './photo-contracts.js';

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
    this.scene.add(this.key, this.fill, new THREE.HemisphereLight(0xe7edff, 0x484b3b, 0.5));
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
    this.gi = createSceneGI(this.scene, this.camera, uniform(0.5));
    this.gi.setSettings({ mode: 'combined', gain: 1, radius: 0.15, thickness: 0.03 });
    this.pipeline = new THREE.RenderPipeline(this.renderer);
    this.pipeline.outputNode = this.gi.output();
    this.textures = [];
    this.mode = 'original'; this.map = 'surface'; this.useGI = true;
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
    this.aspect = image.width / image.height;
    const texture = this.texture(image, 'albedo');
    this.original = new THREE.Mesh(new THREE.PlaneGeometry(this.aspect, 1), new THREE.MeshBasicNodeMaterial({ map: texture, toneMapped: false }));
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
      this.physicalMaterial = new THREE.MeshStandardNodeMaterial({ map: texture, side: THREE.DoubleSide, roughness: 1, metalness: 0 });
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
    this.physicalMaterial.needsUpdate = true;
  }

  setLight(azimuth=-35, elevation=35) {
    const a=THREE.MathUtils.degToRad(azimuth), e=THREE.MathUtils.degToRad(elevation);
    this.key.position.set(Math.sin(a)*Math.cos(e)*3, Math.sin(e)*3, Math.cos(a)*Math.cos(e)*3);
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
      else if (this.mode==='materials' && this.map!=='surface' && this.maps) {
        this.mapMaterial.map=this.maps[this.map]; this.mesh.material=this.mapMaterial;
      } else this.mesh.material=this.mode==='materials'&&this.maps?this.physicalMaterial:this.photoMaterial;
    }
    this.current.lerp(this.target,.08);
    this.camera.position.set(original?0:this.orbit.x+this.current.x,original?0:-this.orbit.y-this.current.y,1);
    this.camera.lookAt(0,0,0);
    if (!original && this.mode==='materials' && this.map==='surface' && this.useGI) this.pipeline.render();
    else this.renderer.render(this.scene,this.camera);
  }
  clear() {
    for (const mesh of [this.mesh,this.original]) if(mesh){this.scene.remove(mesh);mesh.geometry.dispose();}
    for (const material of [this.original?.material,this.photoMaterial,this.physicalMaterial,this.mapMaterial]) material?.dispose();
    for (const texture of this.textures??[]) texture.dispose();
    this.textures=[]; this.original=this.mesh=this.maps=this.surface=this.normalMap=null;
    this.photoMaterial=this.physicalMaterial=this.mapMaterial=null;
  }
  async dispose() {
    this.renderer?.setAnimationLoop(null);this.resizeObserver?.disconnect();
    for(const [event,handler]of Object.entries(this.listeners??{}))this.canvas.removeEventListener(event,handler);
    try{await this.renderer?.backend.device.queue.onSubmittedWorkDone();}
    finally{this.clear();this.pipeline?.dispose();this.gi?.source.dispose();this.gi?.beauty.dispose();this.environment?.dispose();this.renderer?.dispose();}
  }
}
