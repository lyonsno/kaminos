import {Group,Color,AmbientLight,DirectionalLight} from '../lib/three.webgpu.js';
import {createCrust,advanceCrust,setCrustConditions,saveCrust,restoreCrust,readCrust,interfaceState} from '../mineral-worlds/crust.mjs';
import {createCrustSurface} from '../mineral-worlds/crust-surface.mjs';
export default {id:'mineral-crust',title:'Capillary salt crust',async create({host,inputs,record}){
 let state=inputs.state?restoreCrust(inputs.state):createCrust(inputs),surface=createCrustSurface(state),rate=inputs.rate??8,playing=false,closed=false,dirty=true,checkpoint=null,panel,status,play,fields=new Map(),interfaces=true,accumulator=0;
 if(!Number.isFinite(rate)||rate<0)throw Error('Invalid evolution rate');
 const session=await host.scene.open(),root=new Group();root.name='Capillary salt crust';root.add(surface.root);
 const ambient=new AmbientLight(0xe8f0ff,.25),sun=new DirectionalLight(0xffe6be,2);sun.position.set(3,6,2);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=sun.shadow.camera.bottom=-state.rows;sun.shadow.camera.right=sun.shadow.camera.top=state.rows;sun.shadow.bias=-.0005;root.add(ambient,sun);
 const doc=host.controls?.document,win=doc?.defaultView??globalThis;let scene=null,background=null,borrowedLights=[];
 const ground=doc?.getElementById('composition-ground-visible'),hadGround=ground?.checked;if(hadGround){ground.checked=false;ground.dispatchEvent(new win.Event('change',{bubbles:true}));}
 const priorView=session.readView();let asset;
 try{session.setView(inputs.view??{position:[state.rows*1.1,state.rows*.9,state.rows*1.2],target:[0,.15,0],fov:40});asset=await session.attach(root,{owned:true,metadata:{label:root.name,source:'mineral-crust:'+state.model,type:'experiment'}});let parent=root;while(parent.parent)parent=parent.parent;if(parent.isScene){scene=parent;background={background:scene.background,backgroundNode:scene.backgroundNode,fog:scene.fog,environmentIntensity:scene.environmentIntensity};scene.background=new Color(0x293b43);scene.backgroundNode=null;scene.fog=null;scene.environmentIntensity=.2;for(const object of scene.children)if(object.isLight){borrowedLights.push([object,object.visible]);object.visible=false;}}}catch(e){surface.dispose();session.setView(priorView);if(ground&&hadGround){ground.checked=true;ground.dispatchEvent(new win.Event('change',{bubbles:true}));}await session.dispose();throw e;}
 const active=()=>{if(closed)throw Error('Crust experiment is closed');};
 const read=()=>({objectId:asset.id,...readCrust(state),surface:surface.read(),playing,rate,view:session.readView()});
 const sync=()=>{if(play)play.textContent=playing?'Hold growth':'Continue growth';for(const [key,input]of fields)if(doc.activeElement!==input)input.value=key==='rate'?rate:state.settings[key];if(status)status.textContent=`${state.time.toFixed(1)} s · ${state.grains.length} crystals (${state.events.nucleations} new) · ${readCrust(state).connected} connected tracks`;};
 const present=()=>{if(dirty){surface.update(state);session.redraw();dirty=false;}sync();};
 const changed=(kind,requested)=>{dirty=true;present();const result=read();record({kind:'mineral-crust.'+kind,phase:'applied',requested,effective:result});return result;};
 const snapshot=()=>({schema:'kaminos.capillary-crust.v1',state:saveCrust(state),rate,view:session.readView(),interfaces});
 const replace=value=>{active();if(value?.schema!=='kaminos.capillary-crust.v1')throw Error('Unknown crust file');const next=restoreCrust(value.state),nextRate=value.rate??rate;if(!Number.isFinite(nextRate)||nextRate<0)throw Error('Invalid evolution rate');const candidate=createCrustSurface(next);try{if(value.view)session.setView(value.view);}catch(e){candidate.dispose();throw e;}root.remove(surface.root);surface.dispose();surface=candidate;root.add(surface.root);state=next;rate=nextRate;interfaces=value.interfaces??true;surface.interfaces(interfaces);playing=false;accumulator=0;return changed('restore',{time:state.time});};
 const stop=session.onFrame(({deltaSeconds})=>{if(closed||!playing||rate===0)return;accumulator+=deltaSeconds*rate;const steps=Math.floor((accumulator+1e-10)/.1);if(!steps)return;advanceCrust(state,steps*.1);accumulator-=steps*.1;dirty=true;present();});
 return {read,operations:{
  conditions(patch){active();setCrustConditions(state,patch);return changed('conditions',patch);},
  advance(seconds){active();advanceCrust(state,seconds);return changed('advance',{seconds});},
  play(value=true){active();playing=Boolean(value);sync();return read();},
  rate(value){active();if(!Number.isFinite(value)||value<0)throw Error('Invalid evolution rate');rate=value;sync();return read();},
  interfaces(value){active();interfaces=Boolean(value);surface.interfaces(interfaces);session.redraw();return read();},
  trace(){active();return state.pools.map(p=>interfaceState(state,p));},
  checkpoint(){active();return snapshot();},restore:replace,
  remember(){active();checkpoint=snapshot();return {time:state.time};},
  returnToCheckpoint(){active();if(!checkpoint)throw Error('Store a checkpoint first');return replace(checkpoint);},
  restart(){active();return replace({...snapshot(),state:createCrust({rows:state.rows,seed:state.seed,settings:state.settings})});},
  view(value){active();session.setView(value);session.redraw();return read();},
 },mount({root:target,document,invoke}){
  panel=target;const title=document.createElement('h2');title.textContent='Capillary salt crust';
  const description=document.createElement('p');description.textContent='Feed the gaps, watch films climb the crystals, and let drying concentrate the salt. Changes affect future growth; checkpoint to compare histories.';target.append(title,description);
  const failed=e=>{sync();if(status)status.textContent=e.message;};
  const button=(text,operation)=>{const el=document.createElement('button');el.textContent=text;el.type='button';el.onclick=()=>Promise.resolve(operation()).catch(failed);target.append(el);return el;};
  play=button('Continue growth',()=>invoke('play',!playing));
  const field=(key,label,help,step,op='conditions')=>{const row=document.createElement('label');row.style.cssText='display:flex;flex-wrap:wrap;gap:5px;align-items:center;margin:12px 0';const grip=document.createElement('span');grip.textContent=label;grip.title=help;const input=document.createElement('input');input.type='number';input.min='0';input.step='any';input.className='transform-input';input.setAttribute('aria-label',label);input.title=help;input.oninput=()=>{if(input.value.trim()&&Number.isFinite(Number(input.value)))invoke(op,op==='conditions'?{[key]:Number(input.value)}:Number(input.value)).catch(failed);};row.append(grip,input);target.append(row);fields.set(key,input);host.controls.installNumberDrag?.({input,grip,step});};
  field('feed','Brine feed','Total incoming liquid per model second, shared by the inlet junctions. More feed also brings more salt at the selected salinity.',.001);
  field('salinity','Feed salinity','Incoming dissolved salt per liquid volume. Saturation is 1 in this sketch. Existing liquid and crystals retain their history.',.02);
  field('evaporation','Evaporation','Liquid removed per wetted exposed area per model second. Concentrates salt and can disconnect feeding films.',.0002);
  field('rate','Evolution speed','Model seconds per real second. Changes viewing speed without changing physical feed, drying or reaction rates.',1,'rate');
  const advanced=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Growth and birth assumptions';const note=document.createElement('p');note.textContent='Restricted slit/film tracks with linearized capillary storage. Surface growth competes with a provisional concentration- and area-dependent birth law. This is an uncalibrated material sketch.';advanced.append(summary,note);target.append(advanced);
  const advancedField=(...args)=>{const previousChildren=target.children.length;field(...args);advanced.append(target.children[previousChildren]);};
  advancedField('growth','Face growth','Integration rate of excess dissolved salt onto the locally wetted crystal faces. Faster growth leaves less excess for new nuclei.',.005);
  advancedField('mobility','Capillary mobility','Effective inverse viscous resistance of the slot and film tracks. Higher values replenish and extend films faster at the same feed and evaporation. Its useful range is still exploratory.',2);
  advancedField('nucleation','Crystal birth','Provisional event rate per exposed wet area and squared logarithmic supersaturation. Zero disables new births while existing faces can still grow.',5);
  advancedField('barrier','Birth supersaturation','Birth law activates above this concentration. Must be at least 1. Existing faces can grow above saturation even below this barrier.',.05);
  const toggle=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.checked=interfaces;check.onchange=()=>invoke('interfaces',check.checked).catch(failed);toggle.append(check,document.createTextNode(' Show liquid–air fronts'));target.append(toggle);
  button('Store checkpoint',()=>invoke('remember'));button('Return to checkpoint',()=>invoke('returnToCheckpoint'));button('Restart with current conditions',()=>invoke('restart'));
  button('Save crust',async()=>{const data=await invoke('checkpoint'),url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`salt-crust-${state.tick}.json`;a.click();win.setTimeout(()=>URL.revokeObjectURL(url),0);});
  const load=document.createElement('input');load.type='file';load.accept='application/json';load.setAttribute('aria-label','Load salt crust');load.onchange=async()=>{try{if(load.files[0])await invoke('restore',JSON.parse(await load.files[0].text()));}catch(e){failed(e);}};target.append(load);
  status=document.createElement('p');status.setAttribute('role','status');target.append(status);sync();
 },async dispose(){if(closed)return;closed=true;playing=false;stop();surface.dispose();sun.shadow.dispose();if(scene&&background)Object.assign(scene,background);for(const [light,visible]of borrowedLights)light.visible=visible;if(ground&&hadGround){ground.checked=true;ground.dispatchEvent(new win.Event('change',{bubbles:true}));}await session.dispose();}};
}};
