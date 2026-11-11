import {buildSceneOutline,visibleOutlineRows} from './scene-outline-tree.mjs';
import {promptForFileName,sanitizeFileStem} from './scene-file-names.mjs';
import {savedSceneLocation} from './scene-authoring.mjs';

// The existing editor DOM renders a worker projection. No Three roots, GPU
// resources, file parsing or canonical document construction live on the page.
export function mountSceneWorkerEditor({document,window,page,readCamera,readUi,report=()=>{}}){
 const list=document.getElementById('scene-object-list'),empty=document.getElementById('scene-object-empty');
 const inspector=document.getElementById('transform-inspector'),fields=document.getElementById('transform-inspector-fields'),none=document.getElementById('transform-inspector-empty');
 const inputs=[...document.querySelectorAll('[data-transform-field]')],collapsed=new Set(),stops=[];
 let closed=false;
 const call=async(name,input)=>{const reply=await page.request(name,input).completion;return reply.output?.value??reply.output;};
 const run=action=>Promise.resolve().then(action).catch(error=>{report(error.message);render(readUi());});
 function listen(target,type,fn,options){target?.addEventListener(type,fn,options);stops.push(()=>target?.removeEventListener(type,fn,options));}
 function render(ui){
  if(closed)return;
  const objects=ui?.objects??[],selection=ui?.selection??{ids:[],activeId:null};
  if(empty)empty.style.display=objects.length?'none':'';
  if(list){list.replaceChildren();
   for(const row of visibleOutlineRows(buildSceneOutline({objects,groups:ui?.groups??[],fields:ui?.fields??[],emitterFields:{'flame-emitter':'flame-field','local-liquid-emitter':'water-field'}}),collapsed)){
    const id=row.kind==='group'?'@group:'+row.id:row.id;
    const record=row.kind==='object'?objects.find(e=>e.id===row.id):row.kind==='group'?ui.groups.find(e=>e.id===row.id):ui.fields.find(e=>e.id===row.id);
    const item=document.createElement('div');item.className='scene-object-row'+(selection.activeId===id?' active':selection.ids.includes(id)?' selected':'');item.dataset.sceneWorkerItemId=id;item.tabIndex=0;item.setAttribute('role','button');item.setAttribute('aria-pressed',String(selection.ids.includes(id)));item.style.paddingLeft=(8+row.depth*16)+'px';
    if(row.childCount){const toggle=document.createElement('button');toggle.type='button';toggle.textContent=row.collapsed?'▸':'▾';toggle.setAttribute('aria-label',(row.collapsed?'Expand ':'Collapse ')+(record?.label??id));toggle.onclick=event=>{event.stopPropagation();collapsed.has(row.key)?collapsed.delete(row.key):collapsed.add(row.key);render(readUi());};item.appendChild(toggle);}
    const name=document.createElement('span');name.textContent=record?.label??record?.fileName??id;item.appendChild(name);
    const select=event=>{const previous=readUi()?.selection?.ids??[];const ids=event.shiftKey?(previous.includes(id)?previous.filter(value=>value!==id):[...previous,id]):[id];void run(()=>call('scene.select',{ids,activeId:ids.includes(id)?id:ids.at(-1)??null}));};
    item.onclick=select;item.onkeydown=event=>{if(event.target===item&&['Enter',' '].includes(event.key)){event.preventDefault();select(event);}};list.appendChild(item);
   }
  }
  const selected=selection.ids.length===1?objects.find(row=>row.id===selection.activeId):null;
  if(inspector){inspector.hidden=false;inspector.dataset.selectedObjectId=selected?.id??'';inspector.dataset.selectionCount=String(selection.ids.length);}
  if(fields)fields.hidden=!selected;if(none){none.hidden=!!selected;none.textContent=selection.ids.length?'Choose one source or mesh to edit its transform':'No object selected';}
  if(selected){document.getElementById('transform-inspector-name').textContent=selected.label??selected.id;document.getElementById('transform-inspector-id').textContent=selected.id;}
  for(const input of inputs){input.disabled=!selected;const [group,axis]=input.dataset.transformField.split('.');const value=selected?.transform?.[group]?.[{x:0,y:1,z:2}[axis]];if(document.activeElement!==input)input.value=value===undefined?'':String(group==='rotation'?value*180/Math.PI:value);}
 }
 for(const input of inputs)listen(input,'change',()=>{const id=readUi()?.selection?.activeId,value=input.value.trim()?Number(input.value):NaN;if(!id||!Number.isFinite(value)){report('Enter a finite transform value');return;}void run(()=>call('scene.transformComponent',{id,field:input.dataset.transformField,value:input.dataset.transformField.startsWith('rotation.')?value*Math.PI/180:value}));});
 async function save({result=false,saveAs=false,promptName=false,name=null}={}){
  try{
   let stem=name===null?null:sanitizeFileStem(name,'.kaminos.json'),overwrite=false;
   if(promptName){stem=await promptForFileName({title:'Save scene as',defaultStem:(readUi()?.document?.filename??'scene').replace(/\.kaminos\.json$/,''),extension:'.kaminos.json'});if(!stem)return result?{ok:false,canceled:true}:false;}
   for(;;){const saved=await call('scene.save',{camera:readCamera(),saveAs,name:stem,overwrite});
    if(saved.exists&&promptName){const next=await promptForFileName({title:'Save scene as',defaultStem:stem,extension:'.kaminos.json',message:saved.exists+' already exists. Save again to replace it, or choose another name.',confirmLabel:'Replace'});if(!next)return result?{ok:false,canceled:true}:false;overwrite=next===stem;stem=next;continue;}
    if(saved.ok){window.history.replaceState(window.history.state,'',saved.url);report('Saved: '+saved.filename);}else report('Save failed: '+saved.error);
    return result?saved:saved.ok;
   }
  }catch(error){report('Save failed: '+error.message);return result?{ok:false,error:error.message}:false;}
 }
 async function load(file,{sceneFile=null}={}){
  const data=typeof file.json==='function'?await file.json():JSON.parse(await file.text());
  const result=await call('scene.applyDocument',{document:data,sceneFile,emptySettings:true});
  if(sceneFile)window.history.replaceState(window.history.state,'',savedSceneLocation(window.location.href,sceneFile));
  report('Loaded: '+(sceneFile??file.name??'scene'));return {ok:true,...result};
 }
 const previous={saveScene:window.saveScene,saveSceneAs:window.saveSceneAs};
 const saveScene=options=>save(options),saveSceneAs=options=>save({...options,saveAs:true});window.saveScene=saveScene;window.saveSceneAs=saveSceneAs;
 listen(window,'keydown',event=>{
  if(event.target?.closest?.('input,textarea,select,[contenteditable="true"]'))return;
  if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='z'){event.preventDefault();event.stopImmediatePropagation();void run(()=>call(event.shiftKey?'scene.redo':'scene.undo'));}
 },true);
 render(null);
 return Object.freeze({render,save,load,dispose(){closed=true;for(const stop of stops)stop();if(window.saveScene===saveScene)window.saveScene=previous.saveScene;if(window.saveSceneAs===saveSceneAs)window.saveSceneAs=previous.saveSceneAs;}});
}
