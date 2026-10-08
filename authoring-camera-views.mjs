import {installSceneControlHistory,installRelativeNumberDrag} from './scene-control-history.mjs';

export function installCameraViewsPanel({document,views,edits,onError=()=>{}}) {
  const panel=document.getElementById('authoring-camera-properties');
  panel.innerHTML=`<h2>Saved views</h2><div id="camera-view-list" aria-label="Saved camera views"></div>
    <form id="camera-view-save"><input id="camera-view-name" aria-label="New view name" placeholder="Name this angle…" autocomplete="off"><button class="btn" type="submit">Save current view</button></form>
    <p id="camera-view-status" class="camera-note" aria-live="polite"></p>
    <label class="camera-lens-row" for="camera-view-fov"><span>Field of view</span><input id="camera-view-fov" class="transform-input" type="number" step="any" min="0.01" max="179.99" aria-label="Field of view in degrees"><span>°</span></label>
    <div class="camera-actions"><button class="btn" id="camera-view-update">Update from view</button><button class="btn" id="camera-view-capture">Capture saved view</button><button class="btn" id="camera-view-duplicate">Duplicate</button><button class="btn" id="camera-view-remove">Remove</button></div>
    <form id="camera-view-rename"><input id="camera-view-label" aria-label="Selected view name" autocomplete="off"><button class="btn" type="submit">Rename</button></form>
    <p class="camera-note">Orbit and pan freely, then update to keep the new framing. Saved views keep the perspective pose and lens; captures use the current viewport shape.</p>`;
  const byId=id=>document.getElementById(id),input=byId('camera-view-fov');
  let listKey,selectedKey,session;
  const fail=error=>{byId('camera-view-status').textContent=error.message;onError(error);};
  const run=fn=>{try{return fn();}catch(error){fail(error);return null;}};
  function refresh(){
    const state=views.read(),selected=state.items.find(item=>item.id===state.selectedId),editing=edits.state();
    const key=JSON.stringify([state.items.map(({id,label})=>({id,label})),state.selectedId]);
    if(key!==listKey){
      listKey=key;byId('camera-view-list').replaceChildren();
      if(!state.items.length){const empty=document.createElement('p');empty.className='camera-note';empty.textContent='No saved angles yet.';byId('camera-view-list').append(empty);}
      for(const item of state.items){const button=document.createElement('button');button.type='button';button.dataset.cameraViewId=item.id;button.textContent=item.label;button.title=item.label;button.setAttribute('aria-pressed',String(item.id===state.selectedId));button.onclick=()=>{run(()=>views.select(item.id));button.blur();};byId('camera-view-list').append(button);}
    }
    const selection=selected?JSON.stringify([selected.id,selected.label]):'';
    if(selection!==selectedKey){selectedKey=selection;byId('camera-view-label').value=selected?.label||'';}
    const busy=!!editing.active||editing.replaying;
    for(const button of panel.querySelectorAll('button'))button.disabled=busy||((button.id.startsWith('camera-view-')&&!['camera-view-save'].includes(button.id))&&!selected);
    byId('camera-view-label').disabled=!selected||busy;
    input.disabled=busy&&editing.active?.id!=='@viewport-lens';
    if(document.activeElement!==input&&!session?.state().pending)input.value=String(views.current().fov);
    const fov=views.current().fov;input.min=String(Math.min(.01,fov));input.max=String(Math.max(179.99,fov));
    byId('camera-view-status').textContent=selected?(views.differs()?'View has changed · Update to keep it':'Viewing '+selected.label):'Save an angle for this scene.';
  }
  byId('camera-view-save').onsubmit=event=>{event.preventDefault();if(run(()=>views.save(byId('camera-view-name').value))){byId('camera-view-name').value='';document.activeElement?.blur();}};
  byId('camera-view-rename').onsubmit=event=>{event.preventDefault();run(()=>views.rename(views.read().selectedId,byId('camera-view-label').value));};
  for(const action of ['update','duplicate','remove'])byId('camera-view-'+action).onclick=()=>{run(()=>views[action]());byId('camera-view-'+action).blur();};
  byId('camera-view-capture').onclick=async()=>{try{const result=await views.capture();if(result?.ok===false)throw Error(result.error);refresh();}catch(error){fail(error);}};
  // Check before the history adapter commits, including typed invalid values.
  const rejectInvalid=()=>{if(Number.isFinite(input.valueAsNumber)&&input.valueAsNumber>0&&input.valueAsNumber<180)return false;session.cancel();input.value=String(views.current().fov);fail(Error('Field of view must be between 0 and 180 degrees'));return true;};
  input.addEventListener('change',rejectInvalid);
  input.addEventListener('keydown',event=>{if(event.key==='Enter'&&rejectInvalid()){event.preventDefault();event.stopImmediatePropagation();input.blur();}},true);
  session=installSceneControlHistory({controls:[input],edits,id:'@viewport-lens',label:'Adjust camera lens',onError:fail});
  input.addEventListener('input',()=>{
    const fov=input.valueAsNumber;if(!Number.isFinite(fov)||fov<=0||fov>=180)return;
    if(!session.state().pending){input.value=String(views.current().fov);return;}
    run(()=>edits.preview({fov}));
  });
  const drag=installRelativeNumberDrag({input,step:.1});
  input.addEventListener('blur',()=>{if(!session.state().pending)input.value=String(views.current().fov);refresh();});
  document.addEventListener('kaminos-inspector-context-change',event=>{if(event.detail.context==='camera')refresh();});
  edits.subscribe(()=>{if(!session.state().pending)drag.stop();refresh();});
  refresh();
  return {refresh,session};
}
