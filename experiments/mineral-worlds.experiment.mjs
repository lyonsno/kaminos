import {Group,HemisphereLight,DirectionalLight,FogExp2,Color} from '../lib/three.webgpu.js';
import {createWorld,advance,checkpoint,restore,setConditions,summary} from '../mineral-worlds/state.mjs';
import {createSurface} from '../mineral-worlds/surface.mjs';

export default {
 id:'mineral-worlds',title:'Mineral worlds',
 async create({host,inputs,record}){
  const session=await host.scene.open(),document=host.controls.document,win=document.defaultView;
  let state=inputs.checkpoint?restore(inputs.checkpoint):createWorld({kind:inputs.kind??'flowstone',size:inputs.size??48,depth:6,seed:inputs.seed??17});
  let surface=createSurface(state),playing=false,busy=false,disposed=false,stepsPerSecond=8,accumulator=0,status,play,lightMode='cool';
  const beforeView=session.readView();
  const root=new Group();root.name=surface.root.name;root.add(surface.root);
  const fill=new HemisphereLight(0xc6d8e4,0x70634d,1.8),key=new DirectionalLight(0xfff1d4,3.2);
  key.position.set(-12,5,-8);root.add(fill,key,key.target);
  const env=document.getElementById("env-intensity-slider"),oldEnv=env?.value;
  if(env){env.value="0.12";env.dispatchEvent(new win.Event("input",{bubbles:true}));}
  let asset;
  try{asset=await session.attach(root,{owned:true,metadata:{label:root.name,source:'mineral-worlds:reduced-process-v1',type:'experiment'}});}catch(error){surface.dispose();await session.dispose();throw error;}
  let scene=root.parent;while(scene&&!scene.isScene)scene=scene.parent;
  const previousFog=scene?.fog,previousBackground=scene?.background;
  const fog=new FogExp2(0xa7b5ba,.065),background=new Color(0xa7b5ba);
  if(scene){scene.fog=fog;scene.background=background;}
  const ground=document.getElementById('composition-ground-visible'),priorGround=ground?.checked;
  if(ground&&ground.checked){ground.checked=false;ground.dispatchEvent(new win.Event('change',{bubbles:true}));}
  session.setView(inputs.view??{position:[7,3.4,12],target:[0,.6,-3],fov:48});
  const read=()=>({...summary(state),objectId:asset.id,playing,busy,stepsPerSecond,lightMode,surface:surface.read(),view:session.readView(),
    continuation:'Export/import full mineral checkpoint; independent of ordinary scene save',provenance:'Authored initial relief; reduced process evolution, not calibrated geology'});
  const sync=()=>{if(play)play.textContent=playing?'Hold growth':'Resume growth';if(status)status.textContent=`${state.kind==='salt'?'Salt plain':'Flowstone reach'} · ${state.tick} growth steps · ${surface.read().elements.toLocaleString()} surface elements${busy?' · evolving…':''}`;};
  const changed=(kind,requested)=>{surface.update(state);session.redraw();sync();const effective=read();record({kind:'mineral-worlds.'+kind,phase:'applied',requested,effective});return effective;};
  const grow=async steps=>{
    if(busy)throw Error('Growth is already advancing');if(!Number.isSafeInteger(steps)||steps<0)throw Error('steps must be a nonnegative integer');
    busy=true;sync();try{for(let i=0;i<steps;i++){
      if(disposed)throw Error('Mineral world closed during advance');advance(state,1);
      if(i%8===7){surface.update(state);session.redraw();await new Promise(resolve=>win.setTimeout(resolve,0));}
    }busy=false;return changed('advance',{steps});}finally{busy=false;sync();}
  };
  const stop=session.onFrame(({deltaSeconds})=>{
    if(!playing||busy||disposed)return;accumulator+=deltaSeconds*stepsPerSecond;
    // Backlog is retained, never discarded. One domain step per presentation
    // keeps this initial CPU model cooperative; effective tick is observable.
    if(accumulator>=1){advance(state,1);accumulator-=1;surface.update(state);session.redraw();sync();}
  });
  const replace=c=>{
    if(busy)throw Error('Hold until the current advance completes');const next=restore(c),candidate=createSurface(next);
    root.remove(surface.root);surface.dispose();surface=candidate;state=next;root.add(surface.root);playing=false;accumulator=0;return changed('restore',{tick:state.tick});
  };
  const operations={
    read,
    play(value){if(typeof value!=='boolean')throw Error('play expects a boolean');playing=value;sync();return read();},
    advance:grow,
    conditions(patch){if(busy)throw Error('Wait for current advance');setConditions(state,patch);return changed('conditions',patch);},
    rate(value){if(!Number.isFinite(value)||value<0)throw Error('Growth rate must be nonnegative');stepsPerSecond=value;return read();},
    checkpoint(){if(busy)throw Error('Wait for current advance');return {schema:'kaminos.mineral-world.v1',state:checkpoint(state),view:session.readView(),lightMode};},
    restore(value){if(value?.schema!=='kaminos.mineral-world.v1')throw Error('Unsupported mineral world file');const result=replace(value.state);if(value.view)session.setView(value.view);if(value.lightMode)operations.light(value.lightMode);return read();},
    view(value){session.setView(value);session.redraw();return read();},
    light(value){if(!['cool','kiln'].includes(value))throw Error('Unknown light');lightMode=value;key.color.set(value==='kiln'?0xffa654:0xfff1d4);key.intensity=value==='kiln'?5:3.2;fill.intensity=value==='kiln'?.6:1.8;key.position.set(-12,value==='kiln'?1.8:5,-8);session.redraw();return read();},
  };
  return {read,operations,
    mount({root:panel,document,invoke}){
      panel.style.cssText='display:flex;flex-direction:column;gap:12px;padding:14px;';
      const title=document.createElement('h3');title.textContent=state.kind==='salt'?'Salt plain':'Flowstone reach';panel.append(title);
      const desc=document.createElement('p');desc.textContent='Grow the surface, hold it to explore, then continue from its accumulated history.';panel.append(desc);
      const button=(label,action)=>{const b=document.createElement('button');b.className='btn';b.textContent=label;b.onclick=()=>Promise.resolve().then(action).catch(e=>{status.textContent=e.message;});panel.append(b);return b;};
      play=button('Resume growth',()=>invoke('play',!playing));button('Advance 120 steps',()=>invoke('advance',120));
      for(const [key,label] of [['supply','Water supply'],['evaporation','Drying'],['mineral','Mineral supply']]){
        const row=document.createElement('label');row.textContent=label+' ';const input=document.createElement('input');input.type='number';input.min='0';input.step='.1';input.value=state.settings[key];input.setAttribute('aria-label',label);input.className='transform-input';
        input.onchange=()=>invoke('conditions',{[key]:Number(input.value)}).catch(e=>{status.textContent=e.message;input.value=state.settings[key];});row.append(input);panel.append(row);
      }
      const lighting=document.createElement('select');lighting.setAttribute('aria-label','Lighting');for(const [value,label] of [['cool','Cool daylight'],['kiln','Low kiln light']]){const o=document.createElement('option');o.value=value;o.textContent=label;lighting.append(o);}lighting.onchange=()=>invoke('light',lighting.value);panel.append(lighting);
      button('Save mineral world',async()=>{const value=await invoke('checkpoint'),blob=new Blob([JSON.stringify(value)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${state.kind}-${state.tick}.mineral.json`;a.click();win.setTimeout(()=>URL.revokeObjectURL(url),0);});
      const file=document.createElement('input');file.type='file';file.accept='.json';file.setAttribute('aria-label','Open mineral world');file.onchange=async()=>{try{await invoke('restore',JSON.parse(await file.files[0].text()));}catch(e){status.textContent=e.message;}};panel.append(file);
      const detail=document.createElement('details'),heading=document.createElement('summary');heading.textContent='About this study';const note=document.createElement('p');note.textContent='Authored starting relief and reduced mineral dynamics. Save/Open retains the evolved material; ordinary scene save does not yet reconstruct this simulation. Salt uses shallow subsurface transport; polygon formation is not yet established.';detail.append(heading,note);panel.append(detail);
      status=document.createElement('p');status.setAttribute('role','status');panel.append(status);sync();
    },
    async dispose(){disposed=true;playing=false;stop();if(scene?.fog===fog)scene.fog=previousFog;if(scene?.background===background)scene.background=previousBackground;
      if(ground&&ground.checked===false){ground.checked=priorGround;ground.dispatchEvent(new win.Event('change',{bubbles:true}));}if(env&&env.value==="0.12"){env.value=oldEnv;env.dispatchEvent(new win.Event("input",{bubbles:true}));}session.setView(beforeView);await session.dispose();},
  };
 },
};
