import {Box3,Vector3,Mesh,SphereGeometry,MeshStandardMaterial,TorusGeometry} from '../lib/three.core.js';
import {createGpuSceneSolidProducer} from '../scene-solid-gpu.mjs';
import {createGpuAshPatch} from '../ash/gpu-patch.mjs';
import {createGpuTiledAsh} from '../ash/tile-gpu.mjs';
import {disposeAsh} from '../ash/lifecycle.mjs';
import {sourceSettings} from '../ash/fall-plan.mjs';
import {patchLayout} from '../ash/gpu-plan.mjs';
const kilnSha='f8e6ce918e3e5cf234d186724dc21b40b3f9cf7cbc9e776000cf55f24801c91b';
const finitePoint=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
export default {id:'ash-gpu-deposition',title:'Ash — GPU live contact',async create({host,inputs={},record}){
 const session=await host.scene.open(),renderer=host.scene.renderer(),device=renderer?.backend?.device;const tiled=inputs.tiled===true,tileSize=inputs.tileSize??16;
 let producer,patch,asset,playing=true,busy=false,disposed=false,status,contactField,pauseButton,lastPose,lastTick=0;
 let emitting=false,fallRate=.008,fallSpread=.24;let emitter,emitterAsset,emissionButton,rateField,fallSpreadField;const controls=[];const gpuErrors=[];const onError=e=>gpuErrors.push(e.error.message);device?.addEventListener('uncapturederror',onError);
 try{
  if(!device)throw Error('This experiment requires the shared WebGPU renderer');
  const kiln=await session.loadAsset({url:`/api/read?root=generated-meshes&path=${kilnSha}.glb`,normalize:true,arrival:'append'});
  const groundY=host.scene.ground().height;
  kiln.root.updateMatrixWorld(true);let box=new Box3().setFromObject(kiln.root),size=box.getSize(new Vector3());kiln.root.scale.multiplyScalar(2/Math.max(...size.toArray()));kiln.root.updateMatrixWorld(true);
  box=new Box3().setFromObject(kiln.root);const c=box.getCenter(new Vector3());kiln.root.position.add(new Vector3(-c.x,groundY-box.min.y,-c.z));kiln.root.updateMatrixWorld(true);host.scene.refreshPresentation(kiln);
  const matrix=kiln.root.matrixWorld.toArray(),grid=64,supportScale=1.92;
  producer=createGpuSceneSolidProducer(device,{grid,gridHeight:grid});
  producer.update([{id:kiln.id,object:kiln.root}],{translate:[0,groundY+supportScale,0],scale:supportScale},{grid,gridHeight:grid});
  const encoder=device.createCommandEncoder();producer.encode(encoder);device.queue.submit([encoder.finish()]);const support=await producer.snapshot();
  if(!support.valid||gpuErrors.length)throw Error('Kiln support failed: '+gpuErrors.join('; '));producer.destroy();producer=null;
  const identity={kilnSha,kilnMatrix:matrix,groundY,supportGrid:grid,supportCellWidth:.06};
  const check=()=>{if(disposed)throw Error('Ash experiment closed');if(gpuErrors.length)throw Error(gpuErrors.join('; '));kiln.root.updateMatrixWorld(true);if(host.scene.ground().height!==groundY||kiln.root.matrixWorld.toArray().some((v,i)=>v!==matrix[i]))throw Error('Kiln or ground moved; reopen to rebuild support');};
  const marker=new Mesh(new SphereGeometry(1,20,16),new MeshStandardMaterial({color:0xdca76b,transparent:true,opacity:.3,roughness:.75}));marker.name='Live ash contact — drag me';marker.position.set(-.4,groundY+.12,1.2);marker.scale.setScalar(.18);
  const contactAsset=await session.attach(marker,{owned:true,metadata:{label:marker.name,source:'ash:live-contact',type:'experiment'}});
  emitter=new Mesh(new TorusGeometry(1,.025,6,48),new MeshStandardMaterial({color:0x8abdb2,roughness:.8}));emitter.name='Ash source — move me';emitter.rotation.x=Math.PI/2;emitter.position.set(0,groundY+1.15,1);emitter.scale.setScalar(fallSpread);
  emitterAsset=await session.attach(emitter,{owned:true,metadata:{label:emitter.name,source:'ash:falling-source',type:'experiment'}});
  const source=()=>({position:emitter.position.toArray(),spread:fallSpread,rate:emitting?fallRate:0,dt:1/30});
  const read=()=>({...patch.read(),identity,playing,busy,contactObjectId:contactAsset.id,contact:marker.position.toArray(),contactRadius:marker.scale.x,errors:[...gpuErrors],source:'controllable GPU fallout plus optional settled fixture; no combustion coupling',emitter:{position:emitter.position.toArray(),rate:fallRate,spread:fallSpread,emitting,objectId:emitterAsset.id},view:session.readView()});
  const sync=()=>{if(status)status.textContent=`GPU · ${patch.layout.cellSize} cell width · ${patch.read().volume.toFixed(3)} introduced volume · ${emitting?'emitting · ':''}${playing?'live':'paused'} · ${tiled?'connected tiles':'bounded patch'}`;if(contactField&&host.controls.document.activeElement!==contactField)contactField.value=String(marker.scale.x);if(pauseButton)pauseButton.textContent=playing?'Pause':'Resume';if(emissionButton)emissionButton.textContent=emitting?'Stop emitting':'Start emitting';for(const [field,value] of [[rateField,fallRate],[fallSpreadField,fallSpread]])if(field&&host.controls.document.activeElement!==field)field.value=String(value);};
  const create=async({cellSize=.012,width=1.8,height=.6,centerZ=1}={})=>{
   check();if(busy)throw Error('Ash operation in progress');busy=true;
   try{
    const bounds={min:[-width/2,groundY,centerZ-width/2],max:[width/2,groundY+height,centerZ+width/2]},layout=patchLayout({cellSize,bounds,...(tiled?{tileSize}:{})});
    // Reject impossible allocation before allocating a CPU support map.
    if(layout.count*16>device.limits.maxStorageBufferBindingSize||Math.ceil(layout.count/64)>device.limits.maxComputeWorkgroupsPerDimension)throw Error('Requested patch exceeds effective GPU capacity');
    const solid=new Uint8Array(layout.count),[nx,ny,nz]=layout.dims;
    for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
     const wx=bounds.min[0]+(x+.5)*cellSize,wy=(y+.5)*cellSize,wz=bounds.min[2]+(z+.5)*cellSize;
     const sx=Math.floor(wx/.06+32),sy=Math.floor(wy/.06),sz=Math.floor(wz/.06+32);
     if(sx>=0&&sx<64&&sy>=0&&sy<64&&sz>=0&&sz<64)solid[x+nx*(y+ny*z)]=support.cells[sx+64*(sy+64*sz)]?1:0;
    }
    const next=await (tiled?createGpuTiledAsh:createGpuAshPatch)({renderer,cellSize,bounds,solid,tileSize});
    if(asset){asset.root.add(next.root);patch?.dispose();}else asset=await session.attach(next.root,{owned:true,presentation:true,metadata:{label:'GPU ash patch',source:'ash:gpu-patch',type:'experiment'}});
    // Stable registration root cannot be disposed when replacing its child.
    patch=next;lastPose=null;sync();session.redraw();return read();
   }finally{busy=false;}
  };
  // Root registration owns the group; individual GPU patches own their geometry.
  const {Group}=await import('../lib/three.core.js');const root=new Group();root.name='GPU ash patch';asset=await session.attach(root,{owned:true,presentation:true,metadata:{label:root.name,source:'ash:gpu-patch',type:'experiment'}});
  // create's replacement path accepts an initially empty registration.
  await create(inputs);
  const step=()=>{check();const pose=[...marker.position.toArray(),marker.scale.x];patch.step(pose,source());if(JSON.stringify(pose)!==JSON.stringify(lastPose)){record({kind:'ash.live-contact',phase:'applied',effective:{pose,step:patch.read().steps}});lastPose=pose;}session.redraw();};
  session.onFrame(({timestampMs})=>{if(busy||!playing||timestampMs-lastTick<33)return;lastTick=timestampMs;try{step();sync();}catch(e){playing=false;if(status)status.textContent=e.message;record({kind:'ash.error',phase:'failed',error:e.message});}});
  const frame=()=>session.setView({position:[2.9,groundY+2.6,4.5],target:[0,groundY+.3,.65]});frame();
  const locked=async fn=>{check();if(busy)throw Error('Ash operation in progress');busy=true;try{return await fn();}finally{busy=false;sync();session.redraw();}};
  const operations={read,frame,
   diagnostics:options=>locked(()=>{if(!patch.diagnostics)throw Error('Tile diagnostics require tiled ash');return patch.diagnostics(options);}),
   burst(volume){check();if(busy)throw Error('Ash operation in progress');patch.burst(volume);record({kind:'ash.burst',phase:'applied',effective:{volume,source:source()}});sync();return read();},
   emit(value){check();emitting=Boolean(value);sync();record({kind:'ash.emission',phase:'applied',effective:read().emitter});return read();},
   setSource(input){check();const value=sourceSettings({position:emitter.position.toArray(),rate:fallRate,spread:fallSpread,...input});const l=patch.layout,position=value.position;if(position[0]<l.bounds.min[0]||position[0]>l.bounds.max[0]||position[2]<l.bounds.min[2]||position[2]>l.bounds.max[2]||position[1]<groundY)throw Error('Place ash source above the patch footprint');emitter.position.fromArray(position);fallRate=value.rate;fallSpread=value.spread;emitter.scale.setScalar(Math.max(fallSpread,.01));host.scene.refreshPresentation(emitterAsset);record({kind:'ash.source',phase:'applied',effective:read().emitter});return read();},
   profile:options=>locked(()=>patch.profile({...options,contact:[...marker.position.toArray(),marker.scale.x],source:options?.transport===false?null:source()})),
   async settleFrame(){await device.queue.onSubmittedWorkDone();return read();},
   visibility(value){asset.root.visible=Boolean(value);session.redraw();return read();},
   play(value){playing=Boolean(value);sync();return read();},
   newPatch:async input=>{const result=await create(input);record({kind:'ash.new-empty-patch',phase:'applied',effective:result});return result;},
   deposit:input=>locked(async()=>{await patch.deposit({volume:.24,radius:.7,center:[0,groundY,1],...input});record({kind:'ash.deposit',phase:'applied',effective:read()});return read();}),
   moveContact({position,radius=marker.scale.x}){check();if(!finitePoint(position)||!Number.isFinite(radius)||radius<=0)throw Error('Invalid contact pose');marker.position.fromArray(position);marker.scale.setScalar(radius);host.scene.refreshPresentation(contactAsset);sync();return read();},
   setContactRadius(radius){return operations.moveContact({position:marker.position.toArray(),radius});},
   advance({steps=1}={}){if(!Number.isSafeInteger(steps)||steps<1)throw Error('Invalid step count');if(busy)throw Error('Ash operation in progress');for(let i=0;i<steps;i++)step();return read();},
   snapshot:()=>locked(async()=>({schema:'kaminos.kiln-gpu-ash.v1',identity,patch:await patch.snapshot(),contact:marker.position.toArray(),contactRadius:marker.scale.x,emitter:read().emitter})),
   restore:data=>locked(async()=>{if(data?.schema!=='kaminos.kiln-gpu-ash.v1'||JSON.stringify(data.identity)!==JSON.stringify(identity)||!finitePoint(data.contact)||!Number.isFinite(data.contactRadius)||data.contactRadius<=0)throw Error('Checkpoint fixture differs or contact invalid');const src=data.emitter?sourceSettings(data.emitter):null;if(data.emitter&&typeof data.emitter.emitting!=='boolean')throw Error('Invalid checkpoint emission state');patch.restore(data.patch);if(src){emitter.position.fromArray(src.position);fallRate=src.rate;fallSpread=src.spread;emitting=data.emitter.emitting;emitter.scale.setScalar(Math.max(fallSpread,.01));host.scene.refreshPresentation(emitterAsset);}else emitting=false;marker.position.fromArray(data.contact);marker.scale.setScalar(data.contactRadius);host.scene.refreshPresentation(contactAsset);lastPose=null;return read();}),
  };
  return {read,operations,mount({root:panel,document,invoke}){
   const intro=document.createElement('p');intro.textContent='Select the teal ring and move it above the patch, then release ash or start a steady fall. Drag the amber sphere through the arriving material. Transport and settling run on the GPU; the kiln collision mask is static.';panel.append(intro);
   const field=(label,value)=>{const row=document.createElement('label'),grip=document.createElement('span'),input=document.createElement('input');grip.textContent=label+' ';input.type='number';input.step='any';input.value=value;input.className='transform-input';input.setAttribute('aria-label',label);row.append(grip,input);panel.append(row);controls.push(host.controls.installNumberDrag({input,grip,step:value/20}));return input;};
   const failed=e=>{status.textContent=e.message;};
   const button=(title,fn)=>{const b=document.createElement('button');b.type='button';b.textContent=title;b.addEventListener('click',()=>Promise.resolve().then(fn).catch(failed));panel.append(b);return b;};
   const burst=field('Burst volume',.06),rate=field('Ash per second',fallRate),fallRadius=field('Fall spread',fallSpread);
   rateField=rate;fallSpreadField=fallRadius;for(const [input,key] of [[rate,'rate'],[fallRadius,'spread']])input.addEventListener('input',()=>invoke('setSource',{[key]:Number(input.value)}).catch(failed));
   button('Release ash',()=>invoke('burst',Number(burst.value)));emissionButton=button('Start emitting',()=>invoke('emit',!emitting));
   const volume=field('Ash volume',.24),spread=field('Spread radius',.7);contactField=field('Contact radius',marker.scale.x);
contactField.addEventListener('input',()=>invoke('setContactRadius',Number(contactField.value)).catch(failed));

   button('Add ash',()=>invoke('deposit',{volume:Number(volume.value),radius:Number(spread.value)}));pauseButton=button('Pause',()=>invoke('play',!playing));button('Frame kiln',()=>invoke('frame'));
   const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='New patch — clears this deposit';details.append(summary);panel.append(details);
   const width=field('Patch width (new patch)',patch.layout.bounds.max[0]-patch.layout.bounds.min[0]),cell=field('Cell width (new patch)',patch.layout.cellSize);details.append(width.closest('label'),cell.closest('label'));
   const newButton=button('Create empty patch',()=>invoke('newPatch',{width:Number(width.value),cellSize:Number(cell.value)}));details.append(newButton);
   button('Save ash',async()=>{const data=await invoke('snapshot'),url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='gpu-kiln-ash.json';a.click();URL.revokeObjectURL(url);});
   const file=document.createElement('input');file.type='file';file.accept='.json';file.hidden=true;file.addEventListener('change',async()=>{try{if(file.files[0])await invoke('restore',JSON.parse(await file.files[0].text()));}catch(e){failed(e);}finally{file.value='';}});panel.append(file);button('Load ash',()=>file.click());status=document.createElement('p');status.setAttribute('role','status');panel.append(status);sync();
  },dispose:async()=>{disposed=true;await disposeAsh({controls,patch,session,device,onError});}};
 }catch(e){producer?.destroy();patch?.dispose();device?.removeEventListener('uncapturederror',onError);await session.dispose();throw e;}
}};
