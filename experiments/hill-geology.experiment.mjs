import * as THREE from '../lib/three.core.js';
import {MeshStandardNodeMaterial} from '../lib/three.webgpu.js';
import {createTerrainGPU} from './hill-terrain/gpu.mjs';
import {FORMATION_VERSION,FORMATION_FIELDS,FORMATION_PRESETS,formationConfig,formationRecipeKey,partitionTiles,buildTiledIndices,encodeFormation} from './hill-terrain/formation.mjs';
import {requestFormation} from './hill-terrain/formation-cache.mjs';
import {registerExportGeometrySnapshot} from '../scene-export-geometry.mjs';
export default {
 id:'hill-geology',title:'Hill · formed landscape',
 async create({host,inputs={},record,updateInputs=()=>{}}){
  let config=formationConfig(inputs),formed=null,error=null,pending=null,job=null,epoch=0,disposed=false,playing=false,remainder=0,partials=0,gpuErosionSteps=0,showSeams=false,activePreset='canyon-mesas',sync=()=>{};
  const n=config.resolution,tiles=partitionTiles(config),indices=buildTiledIndices(config),geometry=new THREE.BufferGeometry();
  geometry.setIndex(new THREE.BufferAttribute(indices,1));
  for(const t of tiles)geometry.addGroup(t.indexOffset,t.indexCount,0);
  geometry.boundingBox=new THREE.Box3(new THREE.Vector3(-config.width/2,-2,-config.length/2),new THREE.Vector3(config.width/2,config.relief+1.5,config.length/2));geometry.boundingSphere=geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
  const gpu=createTerrainGPU(geometry,{resolution:n,width:config.width,length:config.length,uplift:0,repose:34,transport:1.6});
  const root=new THREE.Group();root.name='Hill · formed rock and earth';
  const material=gpu.decorateMaterial(new MeshStandardNodeMaterial({vertexColors:true,roughness:.92,side:THREE.DoubleSide})),mesh=new THREE.Mesh(geometry,material);mesh.name='Weathered hillside';mesh.frustumCulled=false;mesh.castShadow=true;mesh.receiveShadow=true;mesh.raycast=()=>{};mesh.userData.kaminosDynamicGeometry=true;root.add(mesh);mesh.visible=false;
  const zoomMaterial=gpu.decorateZoomMaterial(new MeshStandardNodeMaterial({vertexColors:true,roughness:.90,side:THREE.DoubleSide})),zoomMesh=new THREE.Mesh(gpu.zoomGeometry,zoomMaterial);zoomMesh.name='Camera-centered 3D rock & ledge detail';zoomMesh.frustumCulled=false;zoomMesh.castShadow=true;zoomMesh.receiveShadow=true;zoomMesh.raycast=()=>{};zoomMesh.userData.kaminosDynamicGeometry=true;root.add(zoomMesh);zoomMesh.visible=false;
  const tilePartitions=tiles.map(t=>({id:t.id,tx:t.tx,tz:t.tz,quads:t.quads,bounds:t.bounds})),authoringFields=FORMATION_FIELDS.map(f=>({key:f.key,title:f.title,group:f.group,min:f.min,max:f.max,step:f.step,unit:f.unit,default:f.default})),authoringPresets=FORMATION_PRESETS.map(p=>({id:p.id,title:p.title}));
  const xLines=[0,...tiles.filter(t=>t.tz===0).map(t=>t.x1)],zLines=[0,...tiles.filter(t=>t.tx===0).map(t=>t.z1)];
  const seamSegs=(xLines.length*(n-1)+zLines.length*(n-1)),seamPos=new Float32Array(seamSegs*6),seamGeo=new THREE.BufferGeometry();
  seamGeo.setAttribute('position',new THREE.BufferAttribute(seamPos,3));
  const seamMat=new THREE.LineBasicMaterial({color:0xd8c38a,transparent:true,opacity:.55,depthTest:true}),seamMesh=new THREE.LineSegments(seamGeo,seamMat);
  seamMesh.name='Tile seam grid';seamMesh.frustumCulled=false;seamMesh.raycast=()=>{};seamMesh.visible=false;root.add(seamMesh);
  const updateSeams=state=>{
   if(!(state instanceof Float32Array)||state.length!==n*n*4)return;
   let p=0;const put=(x,z)=>{const i=(z*n+x)*4;seamPos[p++]=(x/(n-1)-.5)*config.width;seamPos[p++]=state[i]+state[i+1]+.028;seamPos[p++]=(z/(n-1)-.5)*config.length;};
   for(const x of xLines)for(let z=0;z<n-1;z++){put(x,z);put(x,z+1);}
   for(const z of zLines)for(let x=0;x<n-1;x++){put(x,z);put(x+1,z);}
   seamGeo.attributes.position.needsUpdate=true;
  };
  let manualFocus=false;
  const sampleHeight=(st,wx,wz)=>{
   const gx=Math.min(n-1.0001,Math.max(0,(wx/config.width+.5)*(n-1))),gz=Math.min(n-1.0001,Math.max(0,(wz/config.length+.5)*(n-1)));
   const ix=Math.floor(gx),iz=Math.floor(gz),fx=gx-ix,fz=gz-iz;
   const i00=(iz*n+ix)*4,i10=i00+4,i01=i00+n*4,i11=i01+4;
   const h00=st[i00]+st[i00+1],h10=st[i10]+st[i10+1],h01=st[i01]+st[i01+1],h11=st[i11]+st[i11+1];
   return (1-fz)*((1-fx)*h00+fx*h10)+fz*((1-fx)*h01+fx*h11);
  };
  const syncFocusFromView=()=>{
   if(manualFocus)return;
   const v=session?.readView?.();if(!v?.position||!v?.target)return;
   const [px,py,pz]=v.position,[tx,ty,tz]=v.target;
   let hx=tx,hy=ty,hz=tz;const st=formed?.state;
   if(st instanceof Float32Array&&st.length===n*n*4){
    const dx=tx-px,dy=ty-py,dz=tz-pz,len=Math.hypot(dx,dy,dz);
    if(len>1e-5){
     const ux=dx/len,uy=dy/len,uz=dz/len,maxT=Math.min(28,len*2.5);
     let prevT=0,hit=false;
     for(let s=1;s<=64;s++){
      const t=(s/64)*maxT,rx=px+ux*t,ry=py+uy*t,rz=pz+uz*t;
      if(Math.abs(rx)<=config.width*.5&&Math.abs(rz)<=config.length*.5){
       const th=sampleHeight(st,rx,rz);
       if(ry<=th){
        let lo=prevT,hi=t;
        for(let b=0;b<6;b++){const mid=.5*(lo+hi),mx=px+ux*mid,my=py+uy*mid,mz=pz+uz*mid;if(my<=sampleHeight(st,mx,mz))hi=mid;else lo=mid;}
        const ft=.5*(lo+hi);hx=px+ux*ft;hz=pz+uz*ft;hy=sampleHeight(st,hx,hz);hit=true;break;
       }
      }
      prevT=t;
     }
     if(!hit&&Math.abs(tx)<=config.width*.5&&Math.abs(tz)<=config.length*.5)hy=sampleHeight(st,tx,tz);
    }
   }
   const dist=Math.hypot(px-hx,py-hy,pz-hz);
   gpu.setCameraFocus({target:[hx,hy,hz],position:[px,py,pz],distance:dist,enabled:true});
   zoomMesh.visible=Boolean(formed||pending?.partial)&&gpu.read().zoomDetail.enabled;
  };
  registerExportGeometrySnapshot(mesh,()=>{throw Error('GPU terrain export requires an explicit frozen snapshot; formation cache preserves the initial landscape');});
  registerExportGeometrySnapshot(zoomMesh,()=>{throw Error('GPU terrain export requires an explicit frozen snapshot; formation cache preserves the initial landscape');});
  const session=await host.scene.open();let asset,unsubscribe;
  const frame=()=>{manualFocus=false;session.setView(inputs.view??{position:[10.2,8.2,12.8],target:[0,1.15,0],fov:42});syncFocusFromView();};
  const setView=v=>{manualFocus=false;session.setView(v);syncFocusFromView();session.redraw();return read();};
  const read=()=>({route:'kaminos/hill/geological-formation-v1',config:{...config},tiles:{tilesX:config.tilesX,tilesZ:config.tilesZ,count:tiles.length,seamsVisible:showSeams,partitions:tilePartitions},authoring:{preset:activePreset,fields:authoringFields,presets:authoringPresets},formation:formed?{version:formed.version,config:formed.config,steps:formed.steps,gpuErosionSteps,metrics:formed.metrics,cache:formed.cache,bytes:formed.bytes,warning:formed.warning}:null,pending,partialsShown:partials,error,playing,gpu:gpu.read(),objectId:asset?.id,view:session.readView(),presentation:{materialType:mesh.material.type,vertexColors:Boolean(mesh.geometry.getAttribute('color')),zoomPatchVisible:zoomMesh.visible,rootMatrix:Array.from(root.matrixWorld.elements)},preparationBackend:'hybrid-webgpu-and-cached-formation',runtimeReadback:false});
  const regenerate=async(patch={})=>{
   const next=formationConfig({...config,...patch});for(const key of ['resolution','width','length','tilesX','tilesZ'])if(next[key]!==config[key])throw Error('Grid changes require reopening the experiment');
   const seed=formed&&formationRecipeKey(formed.config)===formationRecipeKey(next)&&formed.steps<next.iterations?formed:null;
   job?.cancel();const own=++epoch;config=next;playing=false;pending={step:seed?seed.steps:0,total:config.iterations,partial:false};error=null;sync();updateInputs({...config});
   job=requestFormation(config,{initial:seed,onProgress:p=>{if(own!==epoch||disposed)return;pending={step:p.step,total:p.total,partial:p.state instanceof Float32Array};if(p.state instanceof Float32Array){partials++;gpu.loadFormation({version:FORMATION_VERSION,config:{...config,iterations:p.step},steps:p.step,state:p.state});updateSeams(p.state);mesh.visible=true;zoomMesh.visible=gpu.read().zoomDetail.enabled;seamMesh.visible=showSeams;session.redraw();}sync();}});
   try{const value=await job.promise;if(disposed||own!==epoch)return read();gpuErosionSteps=0;gpu.loadFormation(value);updateSeams(value.state);formed=value;pending=null;remainder=0;mesh.visible=true;zoomMesh.visible=gpu.read().zoomDetail.enabled;seamMesh.visible=showSeams;error=null;syncFocusFromView();session.redraw();sync();record({kind:'hill-geology.formation',effective:read()});return read();}
   catch(e){if(disposed||own!==epoch)return read();pending=null;error=e.message;sync();throw e;}
  };
  const stepFormation=(count=20)=>{if(!Number.isSafeInteger(count)||count<1)throw Error('Positive whole formation step count required');return regenerate({iterations:config.iterations+count});};
  const stepGeology=(count=20)=>{if(pending||error||!formed)throw Error('Landscape is not available');gpuErosionSteps+=count;gpu.stepGeology(count);session.redraw();sync();return read();};
  const setCameraFocus=focus=>{manualFocus=Boolean(focus?.manual);gpu.setCameraFocus(focus);zoomMesh.visible=Boolean(formed||pending?.partial)&&gpu.read().zoomDetail.enabled;session.redraw();sync();return read();};
  const applyPreset=id=>{const found=FORMATION_PRESETS.find(p=>p.id===id);if(!found)throw Error('Unknown geological preset: '+id);activePreset=found.id;return regenerate(found.patch);};
  const setTileSeams=visible=>{if(typeof visible!=='boolean')throw Error('Boolean tile seam visibility required');showSeams=visible;seamMesh.visible=Boolean(formed||pending?.partial)&&showSeams;session.redraw();sync();return read();};
  mesh.onBeforeRender=(renderer,scene,camera)=>{if(disposed||error||(!formed&&!pending?.partial))return;try{if(camera?.isPerspectiveCamera)syncFocusFromView();gpu.flush(renderer);}catch(e){error=e.message;playing=false;sync();}};
  try{asset=await session.attach(root,{owned:true,metadata:{label:root.name,type:'experiment',source:{route:'kaminos/hill/geological-formation-v1'}}});frame();
   unsubscribe=session.onFrame(({deltaSeconds})=>{if(!playing||!formed||pending||error||disposed)return;if(!Number.isFinite(deltaSeconds)||deltaSeconds<0){error='Invalid host frame time';playing=false;sync();return;}remainder+=deltaSeconds;const ticks=Math.floor((remainder+1e-10)/.05);if(ticks){gpu.advance(ticks);remainder=Math.max(0,remainder-ticks*.05);}gpu.present(Math.min(1,remainder/.05));session.redraw();});
   await regenerate();
  }catch(e){job?.cancel();unsubscribe?.();gpu.dispose();seamGeo.dispose();seamMat.dispose();await session.dispose();throw e;}
  const diagnostic={read,snapshot:options=>gpu.snapshot(options),setCameraFocus,setView,stepGeology,gpu:()=>{root.updateWorldMatrix(true,false);return{...gpu.surface(),localToWorld:Array.from(root.matrixWorld.elements)};}};
  if(globalThis.window)window.kaminosHillGeology=diagnostic;
  return{read,operations:{regenerate,stepFormation,stepGeology,setCameraFocus,setView,applyPreset,setTileSeams,frame,play(value){if(typeof value!=='boolean')throw Error('Boolean playback required');if(pending||error||!formed)throw Error('Landscape is not available');playing=value;sync();record({kind:'hill-geology.play',value});return read();},setInfluence(patch){gpu.configure(patch);sync();return read();},advance(count=1){if(pending||error)throw Error('Landscape is not available');gpu.advance(count);gpu.present(1);session.redraw();return read();},recipe:()=>({schema:'kaminos.hill-geology.recipe.v1',inputs:config}),cache:()=>encodeFormation(formed)},
  mount({root:panel,document,invoke}){
   const style=document.createElement('style');
   style.textContent=`.hill-geo-badge{font-size:11px;color:#b8c7ce;background:rgba(255,255,255,.05);padding:5px 8px;border-radius:4px;margin:6px 0}.hill-geo-hint{font-size:11.5px;line-height:1.35;height:4.2em;overflow:hidden;color:#d5e1e6;background:rgba(190,165,110,.11);border-left:2px solid #c9ae74;padding:6px 8px;margin:6px 0;border-radius:0 4px 4px 0}.hill-geo-group{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#9ab0b8;margin:10px 0 4px;border-bottom:1px solid rgba(255,255,255,.08);padding-bottom:2px}.hill-geo-row{display:block;margin:6px 0;padding:3px 0}.hill-geo-head{display:flex;justify-content:space-between;align-items:baseline;font-size:12px;margin-bottom:2px;cursor:ew-resize}.hill-geo-meta{font-size:10.5px;color:#8aa0a8;pointer-events:none}.hill-geo-controls{display:grid;grid-template-columns:1fr 5.2rem;gap:6px;align-items:center}.hill-geo-actions{display:flex;flex-wrap:wrap;gap:5px;margin:8px 0}`;
   panel.append(style);
   const intro=document.createElement('p');intro.textContent=`Grounded ${tiles.length}-tile (${config.tilesX}×${config.tilesZ}) landscape with camera-centered arbitrary-zoom 3D rock ledges, fracture blocks & talus cobbles.`;panel.append(intro);
   const badge=document.createElement('div');badge.className='hill-geo-badge';badge.textContent=`${n}×${n} base (${((n-1)**2*2).toLocaleString()} tris) + 129×129 3D zoom patch (32,768 tris)`;panel.append(badge);
   const presetRow=document.createElement('label');presetRow.className='hill-geo-row';presetRow.title='Select a curated geological authoring preset or reset all parameters to defaults.';
   const presetHead=document.createElement('div');presetHead.className='hill-geo-head';presetHead.textContent='Geological preset';
   const presetSelect=document.createElement('select');presetSelect.setAttribute('aria-label','Geological preset');presetSelect.style.width='100%';
   for(const p of FORMATION_PRESETS){const opt=document.createElement('option');opt.value=p.id;opt.textContent=p.title;presetSelect.append(opt);}
   presetRow.append(presetHead,presetSelect);panel.append(presetRow);
   const hint=document.createElement('div');hint.className='hill-geo-hint';hint.setAttribute('data-authoring-hint','true');
   const defaultHint='Hover or adjust any slider/field to inspect its physical role, sane range, and default value. Zoom in anywhere to resolve 3D overhanging rock ledges and talus cobbles.';
   hint.textContent=defaultHint;panel.append(hint);
   presetSelect.onchange=()=>{const p=FORMATION_PRESETS.find(x=>x.id===presetSelect.value);if(p)hint.textContent=p.title+': '+p.description;invoke('applyPreset',presetSelect.value).catch(e=>{status.textContent=e.message;});};
   const status=document.createElement('p'),fields=new Map(),sliders=new Map();let timer,draft={},currentGroup='';
   const queuePatch=(key,value)=>{if(!Number.isFinite(value))return;draft[key]=value;clearTimeout(timer);status.textContent='Formation settings changed…';timer=setTimeout(()=>{const patch=draft;draft={};invoke('regenerate',patch).catch(e=>{status.textContent=e.message;});},180);};
   for(const f of FORMATION_FIELDS){
    if(f.group!==currentGroup){currentGroup=f.group;const g=document.createElement('div');g.className='hill-geo-group';g.textContent=currentGroup;panel.append(g);}
    const row=document.createElement('label');row.className='hill-geo-row';row.title=f.tooltip;
    const head=document.createElement('div');head.className='hill-geo-head';
    const grip=document.createElement('span');grip.textContent=f.title+' ';grip.title=f.tooltip;
    const meta=document.createElement('span');meta.className='hill-geo-meta';meta.textContent=`def ${f.default} · ${f.min}–${f.max} ${f.unit}`;
    head.append(grip,meta);
    const ctrls=document.createElement('div');ctrls.className='hill-geo-controls';
    const slider=document.createElement('input');slider.type='range';slider.min=String(f.min);slider.max=String(f.max);slider.step=String(f.step);slider.title=f.tooltip;slider.setAttribute('aria-label',f.title+' slider');
    const input=document.createElement('input');input.type='number';input.min=String(f.min);input.max=String(f.max);input.step='any';input.className='transform-input';input.title=f.tooltip;input.setAttribute('aria-label',f.title);
    fields.set(f.key,input);sliders.set(f.key,slider);ctrls.append(slider,input);row.append(head,ctrls);panel.append(row);
    const showInfo=()=>{hint.textContent=`${f.title} (${f.min}–${f.max} ${f.unit}, default ${f.default}): ${f.tooltip}`;};
    row.addEventListener('mouseenter',showInfo);input.addEventListener('focus',showInfo);slider.addEventListener('focus',showInfo);
    host.controls.installNumberDrag({input,grip,step:f.step});
    slider.addEventListener('input',()=>{const v=Number(slider.value);input.value=String(v);showInfo();queuePatch(f.key,v);});
    input.addEventListener('input',()=>{if(!input.value.trim()||!Number.isFinite(Number(input.value)))return;const v=Number(input.value);slider.value=String(Math.max(f.min,Math.min(f.max,v)));showInfo();queuePatch(f.key,v);});
   }
   const actions=document.createElement('div');actions.className='hill-geo-actions';
   const frameButton=document.createElement('button');frameButton.textContent='Frame landscape';frameButton.onclick=()=>invoke('frame');
   const stepButton=document.createElement('button');stepButton.textContent='Step formation';stepButton.title='Advance geological formation by +20 steps from the current state while streaming intermediate frames.';stepButton.onclick=()=>invoke('stepFormation',20).catch(e=>{status.textContent=e.message;});
   const gpuStepButton=document.createElement('button');gpuStepButton.textContent='Step GPU erosion';gpuStepButton.title='Run +20 stratified bedrock weathering, chute incision, and cliff-bank collapse steps directly on WebGPU in <0.5ms.';gpuStepButton.onclick=()=>invoke('stepGeology',20).catch(e=>{status.textContent=e.message;});
   const play=document.createElement('button');play.title='Toggle live GPU loose-talus relaxation.';play.onclick=()=>invoke('play',!playing);
   const seamButton=document.createElement('button');seamButton.title=`Toggle 3D overlay showing the ${tiles.length} stitched tile boundaries on the terrain surface.`;seamButton.onclick=()=>invoke('setTileSeams',!showSeams);
   const resetButton=document.createElement('button');resetButton.textContent='Reset defaults';resetButton.title=`Restore default ${tiles.length}-tile Grounded Mesa Headland recipe.`;resetButton.onclick=()=>{presetSelect.value='canyon-mesas';invoke('applyPreset','canyon-mesas').catch(e=>{status.textContent=e.message;});};
   actions.append(frameButton,stepButton,gpuStepButton,play,seamButton,resetButton);panel.append(actions);
   const note=document.createElement('p');note.textContent=`Step formation advances drainage-coupled age (+20 steps in ~18ms). Step GPU erosion runs 3D bedrock weathering & cliff slump directly on WebGPU (<0.5ms).`;panel.append(note,status);
   sync=()=>{
    for(const [key,input]of fields)if(document.activeElement!==input||input.readOnly)input.value=String(config[key]);
    for(const [key,slider]of sliders)if(document.activeElement!==slider)slider.value=String(config[key]);
    presetSelect.value=activePreset;
    stepButton.disabled=Boolean(pending||error);gpuStepButton.disabled=Boolean(pending||error);play.textContent=playing?'Pause settling':'Run settling';play.disabled=Boolean(pending||error);
    seamButton.textContent=showSeams?`Hide ${tiles.length}-tile seams`:`Show ${tiles.length}-tile seams`;
    const zd=gpu.read().zoomDetail;
    status.textContent=error??(pending?`Forming ${tiles.length}-tile territory · `+pending.step+' / '+pending.total+(pending.partial?' · partial visible':''):(formed?`${tiles.length} tiles · ${Math.round(formed.bytes/1024)} KiB · ${formed.cache} · zoom ${(zd.vertexSpacing*1000).toFixed(1)}mm`+(formed.warning?' · '+formed.warning:''):''));
   };sync();this._cleanup=()=>clearTimeout(timer);
  },
  async dispose(){if(disposed)return;disposed=true;epoch++;job?.cancel();this._cleanup?.();unsubscribe?.();sync=()=>{};gpu.dispose();seamGeo.dispose();seamMat.dispose();await session.dispose();if(globalThis.window?.kaminosHillGeology===diagnostic)delete window.kaminosHillGeology;}
  };
 }
};
