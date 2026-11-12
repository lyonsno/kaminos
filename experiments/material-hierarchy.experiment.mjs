import {FINE_COVERAGE_FIELDS} from '../volume-fine-coverage-controls.mjs';
import {Group,LineSegments,EdgesGeometry,BoxGeometry,LineBasicMaterial,BufferGeometry,Float32BufferAttribute} from '../lib/three.core.js';
export default {
 id:'material-hierarchy',title:'Adaptive fire material',
 async create({host,inputs={},record,updateInputs}){
  const session=await host.scene.open(),win=host.controls.document.defaultView;
  // Basin admission applies canonical controls asynchronously, even when no
  // saved scene is opening. Adopt legacy link policy only after that write.
  await host.volume?.ready;
  const settings=host.fire.adaptiveMaterial;
  settings.adopt(inputs);
  let coverageStatus;
  let overlay=inputs.overlay??false,lastRevision=-1,status,panel,controlError=null,disposed=false;
  const root=new Group();root.name='Material refinement';root.userData.kaminosEditorHelper=true;
  const asset=await session.attach(root,{owned:true,presentation:true,metadata:{label:root.name,source:'simulation:adaptive-material-allocation'}});
  const box=new BoxGeometry(1,1,1),geometry=new EdgesGeometry(box),unitEdges=geometry.attributes.position.array.slice();box.dispose();geometry.dispose();const colors=[0x7799bb,0x36cc9a,0xe5b45b,0xed7b51,0xda57ac],materials=colors.map(color=>new LineBasicMaterial({color,transparent:true,opacity:.4}));
  const source=()=>win.__kaminosVolumePrototype;
  const read=()=>{const {enabled,options}=settings.read();return {enabled,requested:options,overlay,objectId:asset.id,error:controlError??source()?.adaptiveMaterialState?.()?.error??null,effective:source()?.adaptiveMaterialState?.()?.effective??null,status:source()?.adaptiveMaterialState?'available':'awaiting-fire-runtime'};};
  const persist=()=>updateInputs({overlay});
  const clear=()=>{for(const child of [...root.children]){root.remove(child);child.geometry.dispose();}};
  const sync=()=>{
   if(disposed)return;
   const state=read(),effective=state.effective,{enabled,requested}=state;
   source()?.observeAdaptiveMaterial?.({header:true,topology:overlay});
   if(status)status.textContent=state.error?`Allocation unchanged: ${state.error}`:Number.isFinite(effective?.allocatedBricks)?`${effective.leafBricks.toLocaleString()} leaf bricks · ${effective.allocatedBricks.toLocaleString()} / ${effective.capacity.toLocaleString()} resident bricks · ${(effective.materialBytes/1048576).toFixed(1)} MiB material · ${effective.estimatedCellWork.toLocaleString()} estimated cell updates/restrictions. ${effective.error??''}`:effective?'GPU allocation active · awaiting observed counts.':enabled?'Enable the world field in the fire Quality controls to allocate material.':'Adaptive material off; ordinary world transport active.';
   if(panel){for(const el of panel.querySelectorAll('[data-setting]')){if(host.controls.document.activeElement===el)continue;const k=el.dataset.setting;el.value=String(k.startsWith('weight.')?requested.weights[k.slice(7)]:requested[k]);}for(const el of panel.querySelectorAll('[data-toggle]'))el.checked=el.dataset.toggle==='setEnabled'?enabled:overlay;}
   if(coverageStatus){const c=host.fire.coverage.read();for(const el of panel.querySelectorAll('[data-coverage]'))if(host.controls.document.activeElement!==el&&!el.classList.contains('scrubbing'))el.value=String(c.options[el.dataset.coverage]);
    const age=Number.isFinite(c.demandSampledAt)?Math.max(0,performance.now()/1000-c.demandSampledAt):null;
    coverageStatus.textContent=`${c.status}${c.error?': '+c.error:''} · ${c.moves} moves / ${c.checks} checks${c.sourceCoverage!==undefined?' · source coverage '+Math.round(c.sourceCoverage*100)+'%':''}${c.options.mode==='fire'?' · fire demand: '+(c.demandStatus??'awaiting measurement')+(age!==null?' ('+age.toFixed(1)+' s old)':''):''}${c.headroomPending?' · Headroom waiting for coverage or World bounds':''}${c.worldLimited?' · World bounds limit following':''}`;
   }
   root.visible=overlay&&!!effective;
   if(overlay&&effective&&lastRevision!==effective.revision){
    clear();const levels=new Map();for(const b of effective.bricks)if(b.level>0){if(!levels.has(b.level))levels.set(b.level,[]);levels.get(b.level).push(b);}
    for(const [level,bricks] of levels){
     const positions=new Float32Array(bricks.length*unitEdges.length);
     for(let i=0;i<bricks.length;i++)for(let j=0;j<unitEdges.length;j++)positions[i*unitEdges.length+j]=bricks[i].min[j%3]+(unitEdges[j]+.5)*bricks[i].width;
     const batch=new BufferGeometry();batch.setAttribute('position',new Float32BufferAttribute(positions,3));root.add(new LineSegments(batch,materials[level%materials.length]));
    }lastRevision=effective.revision;
   }
   if(effective?.anchor){root.position.fromArray(effective.anchor.translate);root.scale.setScalar(effective.anchor.scale);}
  };
  const stop=session.onFrame(sync);
  const operations={
   setCoverage(patch){if(!host.fire.coverage)throw Error('Fine coverage controls unavailable');host.fire.coverage.set(patch);controlError=null;sync();return host.fire.coverage.read();},
   setOptions(patch){settings.set({options:patch});controlError=null;persist();sync();record({kind:'material-allocation.policy',requested:patch,effective:read()});return read();},
   setEnabled(value){settings.set({enabled:value});lastRevision=-1;controlError=null;persist();sync();record({kind:'material-allocation.enabled',effective:read()});return read();},
   setOverlay(value){overlay=!!value;lastRevision=-1;persist();sync();session.redraw();return read();},
  };
  const drags=[];
  return {read,operations,
   mount({root:target,document,invoke}){
    panel=target;
    const heading=document.createElement('p');heading.textContent='Refinement follows reaction, mixing and material structure throughout the world field. Settings are saved with scenes and basins. Closing this panel keeps the simulation running.';target.append(heading);
    for(const [label,key] of [['Adaptive material','setEnabled'],['Show refinement','setOverlay']]){const row=document.createElement('label'),el=document.createElement('input');el.type='checkbox';el.dataset.toggle=key;if(key==='setEnabled')el.dataset.reconstructionSource='true';el.checked=key==='setEnabled'?read().enabled:overlay;el.addEventListener('change',()=>invoke(key,el.checked).catch(fail));row.style.cssText='display:block;margin:12px 0';row.append(el,document.createTextNode(' '+label));target.append(row);}
    const descriptions={budget:'Extra material work relative to the coarse world field. Includes resident parent bricks and restriction work; an estimate, not milliseconds.',spread:'Higher values favor covering more fire before spending another level on an already refined region.',maxDetail:'Maximum resolution doublings above the world material grid. Rendering currently uses the world material texture resolution.',lookahead:'Motion guard in multiples of the current material transport step. An interpolation footprint is always retained.',persistence:'Additional priority for keeping an existing split. Zero reallocates solely from current demand.'};
    function fail(e){controlError=e.message;sync();}
    const control=(label,key,step,parent=target)=>{const row=document.createElement('label'),grip=document.createElement('span'),el=document.createElement('input');grip.textContent=label;el.type='number';el.min='0';el.step=key==='maxDetail'?'1':'any';el.className='transform-input';el.dataset.setting=key;el.dataset.reconstructionSource='true';el.setAttribute('aria-label',label);row.title=descriptions[key]??'Importance weight in the allocation objective; zero ignores this signal.';
     el.addEventListener('input',()=>{if(!el.value.trim()||!Number.isFinite(Number(el.value)))return;const value=Number(el.value);invoke('setOptions',key.startsWith('weight.')?{weights:{[key.slice(7)]:value}}:{[key]:value}).catch(fail);});row.style.cssText='display:grid;grid-template-columns:1fr 8rem;align-items:center;gap:12px;margin:10px 0';el.style.width='100%';row.append(grip,el);parent.append(row);drags.push(host.controls.installNumberDrag({input:el,grip,step}));el.title=row.title;};
    control('Extra material budget','budget',.1);control('Spread','spread',.1);control('Maximum detail','maxDetail',1);control('Persistence','persistence',.05);control('Motion lookahead','lookahead',.1);
    const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Refinement priorities';details.append(summary);target.append(details);
    for(const k of ['reaction','mixing','thermal','smoke'])control(k[0].toUpperCase()+k.slice(1),'weight.'+k,.1,details);
    if(host.fire.coverage){
     const group=document.createElement('details'),title=document.createElement('summary');title.textContent='Fine coverage · follow moving fire';group.open=true;group.append(title);target.append(group);
     const explanation=document.createElement('p');explanation.textContent='Move fixed-size Fine coverage while gas stays in world space. Manual box edits hold following until a source or setting changes. Fire + sources uses adaptive material measurements.';group.append(explanation);
     for(const f of FINE_COVERAGE_FIELDS){const row=document.createElement('label'),label=document.createElement('span'),el=document.createElement(f.key==='mode'?'select':'input');label.textContent=f.label;row.title=f.description;el.title=f.description;el.dataset.coverage=f.key;el.dataset.reconstructionSource='true';el.setAttribute('aria-label',f.label);el.className='transform-input';
      if(f.key==='mode'){el.style.padding='2px 7px';for(const [value,text] of [['off','Off'],['sources','Sources'],['fire','Fire + sources']]){const option=document.createElement('option');option.value=value;option.textContent=text;el.append(option);}}
      else{el.type='number';el.min='0';el.step='any';drags.push(host.controls.installNumberDrag({input:el,grip:label,step:(f.key==='interval'||f.key==='hysteresis') ? .05 : .1}));}
      el.addEventListener('change',()=>{if(!el.value.trim())return;invoke('setCoverage',{[f.key]:f.key==='mode'?el.value:Number(el.value)}).catch(fail);});
      row.style.cssText='display:grid;grid-template-columns:1fr 8rem;align-items:center;gap:12px;margin:10px 0';row.append(label,el);group.append(row);
     }
     coverageStatus=document.createElement('p');coverageStatus.style.cssText='font-size:12px;line-height:1.6;color:#b2c6d2';coverageStatus.setAttribute('role','status');group.append(coverageStatus);
    }
    status=document.createElement('p');status.style.cssText='font-size:12px;line-height:1.6;color:#b2c6d2';status.setAttribute('role','status');target.append(status);sync();
   },
   async dispose(){disposed=true;source()?.observeAdaptiveMaterial?.({header:false,topology:false});stop();for(const d of drags)d?.dispose?.();clear();for(const m of materials)m.dispose();await session.dispose();},
  };
 },
};
