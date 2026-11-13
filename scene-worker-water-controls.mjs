// Playback controls send intents to the retained worker water owner. The page
// neither constructs a solver nor changes authored setup on Play/Pause/Reset.
export function mountSceneWorkerWaterControls({document,page,readUi,report=()=>{}}){
 const root=document.getElementById('water-simulation-property-slot'),section=document.getElementById('selected-water-simulation-properties');
 if(!root||!section)return null;
 const node=document.createElement('div'),actions=document.createElement('div'),status=document.createElement('p'),error=document.createElement('p');
 actions.className='authoring-actions';status.className='hint';status.setAttribute('role','status');error.setAttribute('role','alert');
 node.dataset.sceneWorkerWaterControls='';node.append(actions,status,error);root.append(node);
 let busy=false,closed=false;
 const buttons={};
 async function run(operation,input){
  if(closed||busy)return;busy=true;error.textContent='';render(readUi());
  try{await page.request(operation,input).completion;}
  catch(cause){if(!closed){error.textContent=cause.message;report('Water: '+cause.message);}}
  finally{busy=false;if(!closed)render(readUi());}
 }
 for(const [name,label,action]of [
  ['play','Play',()=>{const water=readUi()?.water;return water?.simulationMounted?run('water.pause',{paused:!water.paused}):run('water.release');}],
  ['restart','Restart',()=>run('water.release')],['reset','Reset',()=>run('water.reset')],
 ]){const button=document.createElement('button');button.type='button';button.className='btn';button.dataset.workerWaterAction=name;button.textContent=label;button.onclick=action;actions.append(button);buttons[name]=button;}
 function render(ui){
  if(closed)return;
  const water=ui?.water,ids=ui?.selection?.ids??[],selected=ids.includes('water-field')||ui?.objects?.some(row=>row.type==='local-liquid-emitter'&&ids.includes(row.id));
  section.hidden=!(water?.present&&selected);
  for(const button of Object.values(buttons))button.disabled=busy||!water?.present;
  buttons.play.textContent=water?.simulationMounted&&!water.paused?'Pause':'Play';
  const host=water?.host;
  status.textContent=!water?.present?'Water state unavailable':water.failure?'Water stopped: '+water.failure:host?`${water.paused?'Paused':'Playing'} · MLS · tick ${host.clock?.step??host.solver?.stepCount??0}`:water.preview?'Initial water preview. Play releases water from the saved sources.':'Water has no running simulation';
 }
 render(readUi());
 return Object.freeze({render,dispose(){closed=true;for(const button of Object.values(buttons))button.onclick=null;node.remove();section.hidden=true;}});
}
