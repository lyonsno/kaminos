import {Group,LineSegments,EdgesGeometry,BoxGeometry,LineBasicMaterial} from '../lib/three.core.js';
import {validateAllocation} from '../volume-material-hierarchy.mjs';
export default {
 id:'material-hierarchy',title:'Adaptive fire material',
 async create({host,inputs={},record,updateInputs}){
  const session=await host.scene.open(),win=host.controls.document.defaultView;
  let requested=validateAllocation(inputs.options),enabled=inputs.enabled??true,overlay=inputs.overlay??false,lastRuntime=null,lastRevision=-1,status,panel,controlError=null,disposed=false;
  const root=new Group();root.name='Material refinement';root.userData.kaminosEditorHelper=true;
  const asset=await session.attach(root,{owned:true,metadata:{label:root.name,type:'experiment',source:'simulation:adaptive-material-allocation'}});
  const box=new BoxGeometry(1,1,1),geometry=new EdgesGeometry(box);box.dispose();const colors=[0x7799bb,0x36cc9a,0xe5b45b,0xed7b51,0xda57ac],materials=colors.map(color=>new LineBasicMaterial({color,transparent:true,opacity:.4}));
  const source=()=>win.__kaminosVolumePrototype;
  const read=()=>({enabled,requested,overlay,objectId:asset.id,error:controlError??source()?.adaptiveMaterialState?.()?.error??null,effective:source()?.adaptiveMaterialState?.()?.effective??null,status:source()?.adaptiveMaterialState?'available':'awaiting-fire-runtime'});
  const persist=()=>updateInputs({...inputs,enabled,options:requested,overlay});
  const clear=()=>{while(root.children.length)root.remove(root.children[0]);};
  const apply=()=>{const runtime=source();if(runtime?.configureAdaptiveMaterial){runtime.configureAdaptiveMaterial(enabled?requested:null);lastRuntime=runtime;}else lastRuntime=null;};
  const sync=()=>{
   if(disposed)return;
   try{if(source()!==lastRuntime)apply();}catch(e){if(status)status.textContent=e.message;return;}
   const state=read(),effective=state.effective;
   if(status)status.textContent=state.error?`Allocation unchanged: ${state.error}`:effective?`${effective.leafBricks.toLocaleString()} leaf bricks · ${effective.allocatedBricks.toLocaleString()} / ${effective.capacity.toLocaleString()} resident bricks · ${(effective.materialBytes/1048576).toFixed(1)} MiB material · ${effective.estimatedCellWork.toLocaleString()} estimated cell updates/restrictions. ${effective.error??''}`:enabled?'Enable the world field in the fire Quality controls to allocate material.':'Adaptive material off; ordinary world transport active.';
   if(panel){for(const el of panel.querySelectorAll('[data-setting]')){if(host.controls.document.activeElement===el)continue;const k=el.dataset.setting;el.value=String(k.startsWith('weight.')?requested.weights[k.slice(7)]:requested[k]);}for(const el of panel.querySelectorAll('[data-toggle]'))el.checked=el.dataset.toggle==='setEnabled'?enabled:overlay;}
   root.visible=overlay&&!!effective;
   if(overlay&&effective&&lastRevision!==effective.revision){clear();for(const b of effective.bricks.filter(b=>b.level>0)){const line=new LineSegments(geometry,materials[b.level%materials.length]);line.position.fromArray(b.min.map(v=>v+b.width/2));line.scale.setScalar(b.width);root.add(line);}lastRevision=effective.revision;}
   if(effective?.anchor){root.position.fromArray(effective.anchor.translate);root.scale.setScalar(effective.anchor.scale);}
  };
  const stop=session.onFrame(sync);
  const operations={
   setOptions(patch){const next=validateAllocation({...requested,...patch,weights:{...requested.weights,...patch.weights}});source()?.configureAdaptiveMaterial?.(enabled?next:null);requested=next;controlError=null;persist();sync();record({kind:'material-allocation.policy',requested:patch,effective:read()});return read();},
   setEnabled(value){if(typeof value!=='boolean')throw Error('Expected enabled boolean');source()?.configureAdaptiveMaterial?.(value?requested:null);enabled=value;controlError=null;persist();sync();record({kind:'material-allocation.enabled',effective:read()});return read();},
   setOverlay(value){overlay=!!value;lastRevision=-1;persist();sync();session.redraw();return read();},
  };
  const drags=[];
  return {read,operations,
   mount({root:target,document,invoke}){
    panel=target;
    const heading=document.createElement('p');heading.textContent='Refinement follows reaction, mixing and material structure throughout the world field. The existing fine source and flow solvers continue to supply it.';target.append(heading);
    for(const [label,key] of [['Adaptive material','setEnabled'],['Show refinement','setOverlay']]){const row=document.createElement('label'),el=document.createElement('input');el.type='checkbox';el.dataset.toggle=key;el.checked=key==='setEnabled'?enabled:overlay;el.addEventListener('change',()=>invoke(key,el.checked).catch(fail));row.style.cssText='display:block;margin:12px 0';row.append(el,document.createTextNode(' '+label));target.append(row);}
    const descriptions={budget:'Extra material work relative to the coarse world field. Includes resident parent bricks and restriction work; an estimate, not milliseconds.',spread:'Higher values favor covering more fire before spending another level on an already refined region.',maxDetail:'Maximum resolution doublings above the world material grid. Rendering currently uses the world material texture resolution.',lookahead:'Motion guard in multiples of the observed allocation feedback interval. An interpolation footprint is always retained.',persistence:'Additional priority for keeping an existing split. Zero reallocates solely from current demand.'};
    function fail(e){controlError=e.message;sync();}
    const control=(label,key,step,parent=target)=>{const row=document.createElement('label'),grip=document.createElement('span'),el=document.createElement('input');grip.textContent=label;el.type='number';el.min='0';el.step=key==='maxDetail'?'1':'any';el.className='transform-input';el.dataset.setting=key;el.setAttribute('aria-label',label);row.title=descriptions[key]??'Importance weight in the allocation objective; zero ignores this signal.';
     el.addEventListener('input',()=>{if(!el.value.trim()||!Number.isFinite(Number(el.value)))return;const value=Number(el.value);invoke('setOptions',key.startsWith('weight.')?{weights:{[key.slice(7)]:value}}:{[key]:value}).catch(fail);});row.style.cssText='display:grid;grid-template-columns:1fr 8rem;align-items:center;gap:12px;margin:10px 0';el.style.width='100%';row.append(grip,el);parent.append(row);drags.push(host.controls.installNumberDrag({input:el,grip,step}));el.title=row.title;};
    control('Extra material budget','budget',.1);control('Spread','spread',.1);control('Maximum detail','maxDetail',1);control('Persistence','persistence',.05);control('Motion lookahead','lookahead',.1);
    const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Refinement priorities';details.append(summary);target.append(details);
    for(const k of ['reaction','mixing','thermal','smoke'])control(k[0].toUpperCase()+k.slice(1),'weight.'+k,.1,details);
    status=document.createElement('p');status.style.cssText='font-size:12px;line-height:1.6;color:#b2c6d2';status.setAttribute('role','status');target.append(status);sync();
   },
   async dispose(){disposed=true;stop();source()?.configureAdaptiveMaterial?.(null);for(const d of drags)d?.dispose?.();clear();geometry.dispose();for(const m of materials)m.dispose();await session.dispose();},
  };
 },
};
