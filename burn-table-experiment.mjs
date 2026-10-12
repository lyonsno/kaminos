import * as THREE from './lib/three.webgpu.js';
import {BURN_TABLE_STATES,BURN_TABLE_ASSET,checkedBurnControls} from './burn-table-core.mjs';
import {createBurnMaterial} from './burn-table-material.mjs';

export function installBurnTable({document,ready,renderer,load,clone,register,objects,frame,initialView,select,dirty,enterWorkbench}) {
  const node=document.createElement('section');node.id='burn-table';node.className='panel';
  node.innerHTML=`<h3>Material experiments</h3>
    <label>Experiment<select id="burn-table-experiment"><option value="none">None</option><option value="burn-table">Burn Table</option></select></label>
    <div id="burn-table-controls" hidden><h3>Burn Table</h3><p id="burn-table-status" role="status">Held material states</p>
    <label>Sample<select id="burn-table-sample"></select></label>
    <label>Material response<select id="burn-table-profile"><option value="wood">Wood</option><option value="metal">Metal</option></select></label>
    <label>Heat <output id="burn-table-heat-value"></output><input id="burn-table-heat" type="range" min="0" max="1" step="0.01"></label>
    <label>Char <output id="burn-table-char-value"></output><input id="burn-table-char" type="range" min="0" max="1" step="0.01"></label>
    <label>Reaction <output id="burn-table-reaction-value"></output><input id="burn-table-reaction" type="range" min="0" max="1" step="0.01"></label>
    <label class="burn-table-toggle"><input id="burn-table-animation" type="checkbox" checked> Ember motion</label>
    <div class="burn-table-actions"><button type="button" id="burn-table-reset">Reset states</button><button type="button" id="burn-table-frame">Frame table</button><button type="button" id="burn-table-rebuild" hidden>Rebuild missing samples</button></div>
    <details><summary>Source</summary><p id="burn-table-source"></p></details></div>`;
  document.getElementById('tab-assets').prepend(node);
  const byId=id=>document.getElementById(id);
  const labels=document.createElement('div');labels.id='burn-table-labels';labels.setAttribute('aria-hidden','true');document.getElementById('viewport').append(labels);
  const records=[],states=BURN_TABLE_STATES.map(s=>({...s,profile:'wood'}));
  for(const state of states){const option=document.createElement('option');option.value=state.id;option.textContent=state.label;byId('burn-table-sample').append(option);}
  let status='idle',active=false,loading=null,generation=0;
  const source=`/api/read?root=${BURN_TABLE_ASSET.root}&path=${encodeURIComponent(BURN_TABLE_ASSET.path)}`;
  byId('burn-table-source').textContent=`Synthetic held states / GLB ${BURN_TABLE_ASSET.sha256.slice(0,8)} / no combustion simulation`;
  function sync(){
    const state=states.find(s=>s.id===byId('burn-table-sample').value);
    for(const key of ['heat','char','reaction']){byId('burn-table-'+key).value=state[key];byId('burn-table-'+key).disabled=state.id==='original';byId('burn-table-'+key+'-value').textContent=state[key].toFixed(2);}
    byId('burn-table-profile').value=state.profile;
    byId('burn-table-profile').disabled=state.id==='original';
  }
  function setSample(id,patch){
    const index=states.findIndex(s=>s.id===id);if(index<0)throw new Error('Unknown Burn Table sample');
    const next=checkedBurnControls({...states[index],...patch});
    if(index===0&&(next.heat!==0||next.char!==0||next.reaction!==0||next.profile!=='wood'))throw new Error('Original is the unchanged asset control');
    states[index]=next;
    for(const binding of records[index]?.materials||[])binding.set(next);
    dirty();sync();return {...next};
  }
  function reconcile(){
    const members=objects();let missing=false;
    for(let i=0;i<records.length;i++)if(records[i]&&!members.some(e=>e.object===records[i].object)){
      // Shared removal/history owns object resources; retire only local references.
      records[i].label.remove();records[i]=null;missing=true;
    }
    if(missing&&status==='mounted'){
      status='unavailable';byId('burn-table-status').textContent='Samples removed from scene';byId('burn-table-rebuild').hidden=false;
    }
  }
  const liveRecords=()=>records.filter(Boolean);
  async function mount(){
    reconcile();const missing=states.map((_,index)=>index).filter(index=>!records[index]);
    if(!missing.length)return;
    await ready;
    const model=await load(source,{clear:false,arrival:'append',isCurrent:()=>active,
      metadata:{label:'Burn Table / '+states[missing[0]].label,fileName:BURN_TABLE_ASSET.path}});
    const prepared=missing.map((_,offset)=>offset===0?model:clone(model));
    for(let offset=0;offset<missing.length;offset++){
      const index=missing[offset],object=prepared[offset];object.visible=false;
      // Prepare all clones before any per-sample material conversion.
      object.position.set(index%2===0?-1:1,-.5,index<2?-1:1);
      object.rotation.y=Math.PI/2;
      const materials=[];
      object.traverse(mesh=>{if(!mesh.isMesh)return;
        const originals=Array.isArray(mesh.material)?mesh.material:[mesh.material];
        // Original sample retains the source material unmodified.
        if(index>0){mesh.geometry.computeBoundingBox();const converted=originals.map(original=>{
          const binding=createBurnMaterial({renderer:renderer(),original,bounds:mesh.geometry.boundingBox,settings:states[index]});materials.push(binding);return binding.material;});
          mesh.material=Array.isArray(mesh.material)?converted:converted[0];}
      });
      if(offset>0)register(object,{type:'glb',source,fileName:BURN_TABLE_ASSET.path,label:'Burn Table / '+states[index].label});
      const label=document.createElement('span');label.textContent=states[index].label;labels.append(label);
      records[index]={object,materials,label};
    }
  }
  async function open(){
    const epoch=++generation;
    enterWorkbench();active=true;byId('burn-table-experiment').value='burn-table';byId('burn-table-controls').hidden=false;
    status='loading';byId('burn-table-status').textContent='Loading log asset';
    const pending=loading ||= mount();
    try{await pending;
      if(epoch!==generation||!active)return false;
      reconcile();if(states.some((_,index)=>!records[index]))throw new Error('Samples were removed during loading');
      for(const record of liveRecords())record.object.visible=true;
      initialView();frame(liveRecords().map(r=>r.object));
      const original=objects().find(e=>e.object===records[0].object);if(original)select(original.id);
      status='mounted';byId('burn-table-rebuild').hidden=true;byId('burn-table-status').textContent='Held material states / no simulation';labels.hidden=false;dirty();return true;
    }catch(error){if(epoch!==generation||!active)return false;status='failed';byId('burn-table-status').textContent='Load failed: '+error.message;throw error;}
    finally{if(loading===pending)loading=null;}
  }
  byId('burn-table-experiment').onchange=()=>{
    if(byId('burn-table-experiment').value==='burn-table')void open().catch(console.error);
    else{generation++;active=false;status='idle';for(const record of liveRecords())record.object.visible=false;labels.hidden=true;byId('burn-table-controls').hidden=true;dirty();}
  };
  byId('burn-table-sample').onchange=()=>{sync();const index=states.findIndex(s=>s.id===byId('burn-table-sample').value);const entry=objects().find(e=>e.object===records[index]?.object);if(entry)select(entry.id);};
  for(const key of ['heat','char','reaction','profile'])byId('burn-table-'+key).oninput=()=>setSample(byId('burn-table-sample').value,{[key]:key==='profile'?byId('burn-table-profile').value:Number(byId('burn-table-'+key).value)});
  byId('burn-table-animation').onchange=dirty;
  byId('burn-table-frame').onclick=()=>frame(liveRecords().map(r=>r.object));
  byId('burn-table-rebuild').onclick=()=>void open().catch(console.error);
  byId('burn-table-reset').onclick=()=>{states.forEach((state,index)=>setSample(state.id,{...BURN_TABLE_STATES[index],profile:'wood'}));};
  sync();labels.hidden=true;
  return {open,setSample,state:()=>{reconcile();return {identity:'kaminos.burn-table.held-material.v1',status,active,source,asset:BURN_TABLE_ASSET,
    simulation:false,states:states.map(s=>({...s})),objects:records.flatMap((r,index)=>r?[{id:objects().find(e=>e.object===r.object)?.id,stage:states[index].id,materials:r.materials.map(m=>m.read())}]:[])};},
    update(seconds,camera,viewport){
      reconcile();
      if(!active||status!=='mounted')return false;
      labels.hidden=document.body.dataset.workspace!=='workbench'||document.querySelector('.tab.active')?.dataset.tab!=='assets';
      const rect=viewport.getBoundingClientRect();
      liveRecords().forEach(record=>{const point=new THREE.Vector3();record.object.getWorldPosition(point);point.y-=.36;point.project(camera);
        record.label.style.left=`${(point.x+1)*rect.width/2}px`;record.label.style.top=`${(1-point.y)*rect.height/2}px`;
        record.label.hidden=point.z< -1||point.z>1;
        if(byId('burn-table-animation').checked)for(const binding of record.materials)binding.update(seconds);
      });
      return !labels.hidden&&byId('burn-table-animation').checked;
    }};
}
