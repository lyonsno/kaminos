import {Group,HemisphereLight,DirectionalLight,Color} from '../lib/three.webgpu.js';
import {createReach,advanceReach,conditions,readReach,saveReach,restoreReach} from '../mineral-worlds/reach.mjs';
import {createReachSurface} from '../mineral-worlds/reach-surface.mjs';
export default {id:'mineral-reach',title:'Layered mineral reach',async create({host,inputs,record}){
 const session=await host.scene.open(),doc=host.controls.document,win=doc.defaultView;
 let state;try{state=inputs.checkpoint?restoreReach(inputs.checkpoint):createReach(inputs);}catch(e){await session.dispose();throw e;}let surface,asset,playing=false,busy=false,closed=false,rate=12,accumulator=0,dirty=false,staged=null,status,playButton;
 const fields=new Map(),root=new Group();root.name='Layered mineral reach';
 const beforeView=session.readView();
 const fill=new HemisphereLight(0xdde4e8,0x8e7961,.75),key=new DirectionalLight(0xffe4ba,1.6);key.position.set(-12,7,3);root.add(fill,key,key.target);
 try{surface=createReachSurface(state,inputs.surface);root.add(surface.root);session.setView(inputs.view??{position:[9,6,11],target:[0,0,0],fov:44});asset=await session.attach(root,{owned:true,metadata:{label:root.name,source:'mineral-reach:sparse-v1',type:'experiment'}});}catch(error){surface?.dispose();session.setView(beforeView);await session.dispose();throw error;}
 let scene=root.parent;while(scene&&!scene.isScene)scene=scene.parent;
 const previous=scene?{fog:scene.fog,fogNode:scene.fogNode,background:scene.background,backgroundNode:scene.backgroundNode}:null;
 const backdrop=new Color(0x677279);if(scene){scene.fog=null;scene.fogNode=null;scene.background=backdrop;scene.backgroundNode=null;}
 const ground=doc.getElementById('composition-ground-visible'),priorGround=ground?.checked;
 if(ground?.checked){ground.checked=false;ground.dispatchEvent(new win.Event('change',{bubbles:true}));}
 const active=()=>{if(closed)throw Error('Mineral reach is closed');};
 const read=()=>({...readReach(state),playing,busy,rate,objectId:asset.id,surface:surface.read(),view:session.readView(),checkpointStored:!!staged});
 const sync=()=>{if(playButton)playButton.textContent=playing?'Hold growth':'Continue growth';for(const[k,e]of fields){if(doc.activeElement!==e)e.value=k in state.settings?state.settings[k]:k==='rate'?rate:surface.read()[k];}if(status)status.textContent=`${state.tick} steps · ${state.features.length} retained features (${readReach(state).children} children) · ${state.layers.length} layers${busy?' · advancing':''}`;};
 const changed=(kind,requested)=>{sync();record({kind:'mineral-reach.'+kind,phase:'applied',requested,effective:read()});return read();};
 const present=()=>{surface.focus(session.readView().target);if(dirty||surface.read().tick<0){surface.update(state);dirty=false;session.redraw();}sync();};
 const grow=async steps=>{active();if(busy)throw Error('Advance already in progress');if(!Number.isSafeInteger(steps)||steps<0)throw Error('Invalid steps');busy=true;try{for(let i=0;i<steps;i++){active();advanceReach(state,1);dirty=true;if(i%4===3){present();await new Promise(r=>win.setTimeout(r,0));}}present();busy=false;return changed('advance',{steps});}finally{busy=false;sync();}};
 const exportWorld=()=>({schema:'kaminos.mineral-reach.v1',state:saveReach(state),surface:{segments:surface.read().segments,depth:surface.read().depth,finish:surface.read().finish},view:session.readView(),rate});
 const replace=value=>{active();if(busy)throw Error('Advance is still in progress');if(value?.schema!=='kaminos.mineral-reach.v1')throw Error('Unknown mineral reach file');const next=restoreReach(value.state),nextRate=value.rate??rate;if(!Number.isFinite(nextRate)||nextRate<0)throw Error('Invalid evolution rate');const candidate=createReachSurface(next,value.surface);try{if(value.view)session.setView(value.view);}catch(e){candidate.dispose();throw e;}root.remove(surface.root);surface.dispose();surface=candidate;root.add(surface.root);state=next;rate=nextRate;playing=false;accumulator=0;dirty=false;session.redraw();return changed('restore',{tick:state.tick});};
 const operations={read,advance:grow,
  play(value){active();if(typeof value!=='boolean')throw Error('Expected play boolean');playing=value;accumulator=0;return changed('play',value);},
  conditions(patch){active();conditions(state,patch);return changed('conditions',patch);},
  rate(value){active();if(!Number.isFinite(value)||value<0)throw Error('Invalid evolution rate');rate=value;accumulator=0;return changed('rate',value);},
  appearance(patch){active();surface.appearance(patch);session.redraw();return changed('appearance',patch);},
  checkpoint(){active();return exportWorld();},restore:replace,
  remember(){active();if(busy)throw Error('Advance is still in progress');staged=exportWorld();return changed('remember',state.tick);},
  returnToCheckpoint(){active();if(!staged)throw Error('Store a checkpoint first');return replace(staged);},
  restart(){active();if(busy)throw Error('Advance is still in progress');const next=createReach({size:state.size,seed:state.seed,extent:state.extent});conditions(next,state.settings);return replace({...exportWorld(),state:saveReach(next)});},
  view(value){active();session.setView(value);surface.focus(session.readView().target);dirty=true;present();session.redraw();return changed('view',value);},
 };
 const stop=session.onFrame(({deltaSeconds})=>{if(closed)return;if(playing&&!busy){accumulator+=deltaSeconds*rate;if(accumulator>=1){const due=Math.floor(accumulator);advanceReach(state,due);accumulator-=due;dirty=true;}}present();});
 return {read,operations,mount({root:panel,document,invoke}){
  panel.style.cssText='display:flex;flex-direction:column;gap:10px;padding:14px;';
  const h=document.createElement('h3');h.textContent='Layered mineral reach';panel.append(h);
  const p=document.createElement('p');p.textContent='A stratified starting bed, with sparse deposits grown by shallow flow. Live edits affect future growth; the specimen keeps its history.';panel.append(p);
  const failed=e=>{if(status)status.textContent=e.message;};
  const button=(label,action)=>{const b=document.createElement('button');b.className='btn';b.textContent=label;b.onclick=()=>Promise.resolve().then(action).catch(failed);panel.append(b);return b;};
  playButton=button('Continue growth',()=>invoke('play',!playing));
  const field=(key,label,help,step,operation,range)=>{const row=document.createElement('label');row.style.cssText='display:flex;flex-wrap:wrap;gap:4px;align-items:center;';const grip=document.createElement('span');grip.textContent=label;grip.title=help;const e=document.createElement('input');e.type='number';e.step=step;e.min='0';if(range)e.max=range;e.className='transform-input';e.setAttribute('aria-label',label);e.title=help;fields.set(key,e);e.oninput=()=>{if(e.value.trim()&&Number.isFinite(Number(e.value)))invoke(operation,{conditions:{[key]:Number(e.value)},appearance:{[key]:Number(e.value)},rate:Number(e.value)}[operation]).catch(failed);};row.append(grip,e);host.controls.installNumberDrag?.({input:e,grip,step});e.title=help+'\nDrag to adjust · Click to type · Shift for fine';panel.append(row);};
  field('supply','Water supply','Incoming water per step. At fixed concentration, more water also brings more mineral and can carry it farther.',.1,'conditions');
  field('mineral','Mineral concentration','Mineral carried by new water. Existing dissolved and deposited mineral remains after this changes.',.1,'conditions');
  field('drying','Drying','Water removed per step. Concentrates remaining mineral; interacts with supply and residence time.',.1,'conditions');
  field('rate','Evolution speed','Growth steps per second. Changes the playback rate, not the deposition law. Zero pauses immediately; edits begin a new playback interval.',1,'rate');
  field('depth','Layer exposure','Inspect deeper authored bedding and expose more stratification through the growing coating. Presentation only; does not erase deposited material.',.01,'appearance');
  field('finish','Surface finish','0 is matte, 1 is smoother. Presentation only; no change to mineral history.',.05,'appearance','1');
  button('Store checkpoint',()=>invoke('remember'));button('Return to checkpoint',()=>invoke('returnToCheckpoint'));button('Restart with current conditions',()=>invoke('restart'));
  const info=document.createElement('small');info.textContent='Ranges are exploratory. Continue to perturb this specimen; restart for a clean comparison. Starting layers are authored. Deposits use a provisional two-level growth rule.';panel.append(info);
  button('Save mineral reach',async()=>{const v=await invoke('checkpoint'),url=URL.createObjectURL(new Blob([JSON.stringify(v)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`mineral-reach-${state.tick}.json`;a.click();win.setTimeout(()=>URL.revokeObjectURL(url),0);});
  const load=document.createElement('input');load.type='file';load.accept='application/json';load.setAttribute('aria-label','Load mineral reach');load.onchange=async()=>{try{if(load.files[0])await invoke('restore',JSON.parse(await load.files[0].text()));}catch(e){failed(e);}};panel.append(load);
  status=document.createElement('div');status.setAttribute('role','status');panel.append(status);sync();
 },async dispose(){if(closed)return;closed=true;playing=false;stop();surface.dispose();if(scene&&scene.background===backdrop){Object.assign(scene,previous);}if(ground&&ground.checked===false&&priorGround){ground.checked=true;ground.dispatchEvent(new win.Event('change',{bubbles:true}));}await session.dispose();}};
}};
