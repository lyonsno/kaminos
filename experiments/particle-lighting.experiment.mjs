import {bindParticleNumber} from '../particle-number-control.mjs';
import {particleLightingOptions as options,particleLightingEdit,sameParticleLightField} from '../particle-lighting-controls.mjs';
import * as THREE from '../lib/three.webgpu.js';
import {createParticleIncidentField} from '../volume-particle-light-field.mjs';
import {PARTICLE_LIGHT_VIEW_WGSL} from '../volume-particle-light-view.mjs';
const fixtureUrl=new URL('./particle-lighting/held-plume.json',import.meta.url);
const readBuffer=async(device,buffer)=>{const r=device.createBuffer({size:buffer.size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});try{const e=device.createCommandEncoder();e.copyBufferToBuffer(buffer,0,r,0,buffer.size);device.queue.submit([e.finish()]);await r.mapAsync(GPUMapMode.READ);return new Float32Array(r.getMappedRange().slice(0));}finally{r.unmap();r.destroy();}};
const load=async url=>{const r=await fetch(url);if(!r.ok)throw Error('Could not load held particle fixture: '+r.status);return r;};
export default {
 id:'particle-lighting',title:'Particle-sourced distributed lighting',
 async create({host,inputs={},record,updateInputs}){
  const fixture=await(await load(fixtureUrl)).json(),raw=await(await load(new URL(fixture.records,fixtureUrl))).arrayBuffer();
  const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw)),x=>x.toString(16).padStart(2,'0')).join('');
  if(fixture.schema!=='kaminos.held-particle-lighting.v1'||fixture.recordBytes!==96||raw.byteLength!==fixture.slots*96||raw.byteLength!==fixture.bytes||sha!==fixture.sha256||!new Float32Array(raw).every(Number.isFinite))throw Error('Held particle identity or complete record bytes differ');
  const adapter=await navigator.gpu?.requestAdapter();if(!adapter||adapter.info?.isFallbackAdapter)throw Error('A hardware WebGPU adapter is required');
  const device=await adapter.requestDevice(),session=await host.scene.open(),T=THREE.TSL,root=new THREE.Group();root.name='Held particle distributed lighting';
  const particles=device.createBuffer({label:'complete held native particle population',size:raw.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(particles,0,raw);
  let requested=options(inputs.lighting),effective=null,error=null,disposed=false,busy=false,requestVersion=0,pump=null,status,panel;const fields=new Map(),drags=[],controlErrors=new Map();
  const shownError=()=>controlErrors.size?Array.from(controlErrors.values()).join('; '):error;
  const origin=fixture.origin,extent=fixture.extent,geometry=new THREE.BoxGeometry(...extent);geometry.translate(...origin.map((x,i)=>x+extent[i]/2));
  const makeTexture=(array,dims)=>{const t=new THREE.Data3DTexture(array,...dims);t.type=THREE.FloatType;t.format=THREE.RGBAFormat;t.minFilter=t.magFilter=THREE.NearestFilter;t.generateMipmaps=false;t.colorSpace=THREE.NoColorSpace;t.needsUpdate=true;return t;};
  let textures=[makeTexture(new Float32Array(32),[2,2,2]),makeTexture(new Float32Array(32),[2,2,2])];
  const textureNodes=textures.map(t=>T.texture3D(t)),albedo=T.uniform(requested.albedo),mode=T.uniform(requested.mode,'uint'),exposure=T.uniform(requested.exposure),camera=T.modelWorldMatrixInverse.mul(T.vec4(T.cameraPosition,1)).xyz;
  const material=new THREE.MeshBasicNodeMaterial({transparent:true,side:THREE.BackSide,depthWrite:false,blending:THREE.CustomBlending,blendSrc:THREE.OneFactor,blendDst:THREE.OneMinusSrcAlphaFactor,blendEquation:THREE.AddEquation});
  material.toneMapped=false;material.fragmentNode=T.wgslFn(PARTICLE_LIGHT_VIEW_WGSL)({medium:textureNodes[0],incident:textureNodes[1],eye:camera,surface:T.positionLocal,lo:T.vec3(...origin),extent:T.vec3(...extent),albedo,mode,exposure});
  const mesh=new THREE.Mesh(geometry,material);mesh.name='Intrinsic emission and first-scattered smoke';mesh.frustumCulled=false;root.add(mesh);const outline=new THREE.Box3Helper(new THREE.Box3(new THREE.Vector3(...origin),new THREE.Vector3(...origin.map((v,i)=>v+extent[i]))),0x497780);outline.userData.kaminosEditorOnly=true;root.add(outline);
  const asset=await session.attach(root,{owned:true,metadata:{label:root.name,source:'native-held-particles:'+sha,type:'experiment'}});
  const read=()=>({source:{authority:fixture.authority,commit:fixture.sourceCommit,step:fixture.step,slots:fixture.slots,active:fixture.active,sha256:sha,limit:fixture.sourceLimit},requested:{...requested},effective,display:{mode:mode.value,albedo:albedo.value,exposure:exposure.value},busy,error:shownError(),fieldError:error,objectId:asset.id,view:session.readView(),route:'particle-grid/opposite-direction-sweeps/full-sphere-mean/first-scattering/voxel-camera-reference',liveSimulation:false,adapter:{vendor:adapter.info?.vendor,architecture:adapter.info?.architecture,device:adapter.info?.device,isFallbackAdapter:adapter.info?.isFallbackAdapter??false}});
  function sync(){if(!panel||disposed)return;for(const [k,el]of fields)if(host.controls.document.activeElement!==el&&!el.classList.contains('scrubbing'))el.value=String(requested[k]);status.textContent=controlErrors.size?'Input not applied: '+shownError():error?'Keeping previous field: '+error:busy?'Preparing requested light field. The previous view remains available.':effective?`${effective.plan.dims.join('×')} receivers · ${effective.plan.directionCount} directions · held step${fixture.step} · ${fixture.active} active particles. Current emission and extinction; isotropic first scattering. Open volume: scene objects do not cast shadows into this experiment.`:'No light field has been prepared.';}
  function applyView(){albedo.value=requested.albedo;mode.value=requested.mode;exposure.value=requested.exposure;session.redraw();sync();}
  async function build(){
   if(busy)return pump;busy=true;sync();
   pump=(async()=>{
    let done=-1;
    while(!disposed&&done!==requestVersion){const version=requestVersion,s={...requested};done=version;if(sameParticleLightField(s,effective?.settings)){error=null;sync();continue;}let owner;
     device.pushErrorScope('validation');device.pushErrorScope('out-of-memory');let scopes=2;const pop=()=>{scopes--;return device.popErrorScope();};
     try{
      owner=await createParticleIncidentField(device,{dims:[s.width,s.width*1.5,s.width],origin,extent,transportWidth:s.transportWidth,directionCount:s.directions,particles,slots:fixture.slots,settings:fixture.settings,filterLength:s.filterLength});
      const e=device.createCommandEncoder();owner.encode(e);device.queue.submit([e.finish()]);const [m,j]=await Promise.all([readBuffer(device,owner.medium),readBuffer(device,owner.incident)]);
      const memoryError=await pop(),validation=await pop();if(memoryError||validation)throw Error((memoryError??validation).message);
      if(!m.every(v=>Number.isFinite(v)&&v>=0)||!j.every(v=>Number.isFinite(v)&&v>=0)||!m.some((v,i)=>i%4<3&&v>0)||!j.some(v=>v>0))throw Error('Prepared field is nonfinite or blank');
      if(disposed||version!==requestVersion)continue;
      const next=[makeTexture(m,owner.plan.dims),makeTexture(j,owner.plan.dims)],previous=textures;textures=next;textureNodes.forEach((node,i)=>node.value=next[i]);material.dispose();previous.forEach(t=>t.dispose());effective={settings:s,plan:owner.plan,sourceSha256:sha,generation:version};error=null;session.redraw();record({kind:'particle-lighting.field',phase:'applied',requested:s,effective});
     }catch(cause){if(version===requestVersion)error=cause.message;while(scopes>0)try{await pop();}catch{}if(!effective&&version===requestVersion)throw cause;}
     finally{owner?.dispose();sync();}
    }
   })();
   try{await pump;}finally{busy=false;sync();}
   return read();
  }
  async function setOptions(patch){
   const edit=particleLightingEdit(requested,effective?.settings,patch);requested=edit.settings;
   for(const k of Object.keys(patch))controlErrors.delete(k);
   if(edit.fieldChanged)requestVersion++;
   if(edit.usesDisplayedField)error=null;
   updateInputs({lighting:{...requested}});record({kind:'particle-lighting.options',requested:{...requested}});applyView();
   if(edit.requiresBuild)await build();else if(busy&&edit.fieldChanged)await pump;
   return read();
  }
  try{await build();}catch(cause){particles.destroy();device.destroy();await session.dispose();throw cause;}
  session.setView(inputs.view??{position:[4,2.4,5],target:[0,.5,0]});
  return {read,operations:{setOptions,frame(){session.setView({position:[4,2.4,5],target:[0,.5,0]});return read();}},
   mount({root:parent,document,invoke}){panel=parent;const note=document.createElement('p');note.textContent='Inspect light transported through a held native particle plume. The reference camera and lighting share one filtered optical medium. Receiver width changes sampling; smoothing is a separate world-space width. This is a static lighting experiment, not live flame playback.';parent.append(note);
    const control=(label,k,choices,step)=>{const row=document.createElement('label'),grip=document.createElement('span'),el=document.createElement(choices?'select':'input');grip.textContent=label;el.className='transform-input';el.setAttribute('aria-label',label);
     if(choices){for(const [v,title]of choices){const option=document.createElement('option');option.value=v;option.textContent=title;el.append(option);}el.addEventListener('change',()=>{invoke('setOptions',{[k]:Number(el.value)}).catch(cause=>{controlErrors.set(k,cause.message);sync();});});}
     else{
      el.type='number';el.step=String(step);if(['width','transportWidth','directions'].includes(k))el.min='2';if(['albedo','filterLength'].includes(k))el.min='0';if(k==='albedo')el.max='1';
      // The shared drag's fine mode can emit odd intermediate integers. Typed invalid values remain rejectable drafts.
      if(k==='width'||k==='directions')el.addEventListener('input',()=>{if(el.classList.contains('scrubbing')&&Number.isFinite(Number(el.value)))el.value=String(Math.max(2,2*Math.round(Number(el.value)/2)));});
      drags.push(host.controls.installNumberDrag({input:el,grip,step}));
      drags.push(bindParticleNumber({input:el,read:()=>requested[k],apply:value=>invoke('setOptions',{[k]:value}),onError:cause=>{controlErrors.set(k,cause.message);sync();},onAccepted:()=>{controlErrors.delete(k);sync();},delay:300}));
     }
     fields.set(k,el);row.style.cssText='display:grid;grid-template-columns:1fr 9rem;gap:10px;align-items:center;margin:10px 0';row.append(grip,el);parent.append(row);
    };
    control('View','mode',[[2,'Emission + scattering'],[0,'Intrinsic emission'],[1,'Scattered light']],1);control('Exposure','exposure',null,.25);control('Scattering albedo','albedo',null,.05);control('Receiver width','width',null,2);control('Directional grid width','transportWidth',null,1);control('Light directions','directions',null,2);control('Smoothing width (world units)','filterLength',null,.01);
    status=document.createElement('p');status.setAttribute('role','status');parent.append(status);sync();
   },
   async dispose(){disposed=true;drags.forEach(d=>d?.dispose?.());try{await pump;}catch{}particles.destroy();device.destroy();textures.forEach(t=>t.dispose());await session.dispose();}
  };
 }
};
