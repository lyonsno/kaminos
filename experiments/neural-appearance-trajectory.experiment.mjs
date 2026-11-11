import {readAppearanceTrajectory,loadResponseSlice,responseDisplayPixels,assertTrajectoryContinuation,trajectorySceneState} from '../neural-appearance-trajectory.mjs';
import {neuralAppearanceProgram} from '../neural-appearance-program.mjs';
export default {
 id:'neural-appearance-trajectory',title:'NVIDIA training trajectory',
 async create({host,inputs,record,updateInputs}){
  if(typeof inputs.run!=='string')throw Error('Choose a retained training trajectory URL');
  const response=await fetch(inputs.run);if(!response.ok)throw Error('Training trajectory HTTP '+response.status);
  let run=readAppearanceTrajectory(await response.json()),step=inputs.step??run.checkpoints.at(-1).step,viewId=inputs.responseView??run.views[0].id,exposure=inputs.exposure??4,disposed=false,generation=0,drawGeneration=0,pending=false,drawing=false,problem=null;
  const session=await host.scene.open();if(inputs.cameraView)session.setView(inputs.cameraView);let panel,status,checkpointControl,viewControl,images,loss,drag;
  const recipes=()=>{const library=host.scene.materials.read(),live=new Set(host.scene.objects().map(o=>o.id)),bound=new Set(library.bindings.filter(b=>live.has(b.objectId)).map(b=>b.recipeId));return library.recipes.filter(r=>r.implementation==='neural-appearance'&&bound.has(r.id));};
  if(!recipes().length){await session.dispose();throw Error('Open a scene with an assigned NVIDIA material first');}
  const checkpoint=()=>run.checkpoints.find(c=>c.step===step),view=()=>run.views.find(v=>v.id===viewId);
  const read=()=>({run:inputs.run,step,sceneState:trajectorySceneState(run,recipes()).state,installedStep:trajectorySceneState(run,recipes()).step,view:viewId,exposure,pending:pending||drawing,error:problem,slices:run.status,checkpoint:checkpoint(),effective:recipes().map(r=>({id:r.id,source:r.parameters.source})),camera:session.readView()});
  const persist=()=>updateInputs({...inputs,step,responseView:viewId,exposure});
  const draw=async()=>{
   if(!images)return;const token=++drawGeneration;if(run.status!=='complete'){images.replaceChildren();return;}
   drawing=true;images.replaceChildren();sync();try{
   const [reference,predicted]=await Promise.all([loadResponseSlice(view().reference,run.width,run.height),loadResponseSlice(checkpoint().slices[viewId],run.width,run.height)]);
   if(disposed||token!==drawGeneration)return;
   const difference=Float32Array.from(predicted,(x,i)=>Math.abs(x-reference[i])*8);images.replaceChildren();
   for(const [label,data] of [['Source integral',reference],['Learned response',predicted],['Absolute error ×8',difference]]){
    const figure=panel.ownerDocument.createElement('figure'),caption=panel.ownerDocument.createElement('figcaption'),canvas=panel.ownerDocument.createElement('canvas');caption.textContent=label;canvas.width=run.width;canvas.height=run.height;canvas.style.cssText='width:100%;image-rendering:pixelated';canvas.getContext('2d').putImageData(new ImageData(responseDisplayPixels(data,exposure),run.width,run.height),0,0);figure.style.margin='8px 0';figure.append(caption,canvas);images.append(figure);
   }
   }finally{if(token===drawGeneration){drawing=false;sync();}}
  };
  const sync=()=>{if(!status)return;checkpointControl.value=String(step);viewControl.value=viewId;const scene=trajectorySceneState(run,recipes()),busy=pending||drawing;status.textContent=problem??(busy?'Loading retained checkpoint or response slices…':scene.state!=='matched'?`Scene has ${scene.state} checkpoint sources. Response slices show step ${step}; they do not match all scene surfaces.`:run.status==='complete'?'Matched checkpoint and projected-response slices. The 3D scene uses its ordinary camera and lights.':'Saved checkpoints are available; matched source slices are pending.');status.dataset.state=problem?'failed':busy?'loading':scene.state;viewControl.disabled=pending;loss.textContent=run.checkpoints.map(c=>`${c.step}: ${c.heldoutLogL1.toPrecision(5)}${c.step===step?' ←':''}`).join('\n');};
  const select=async requested=>{
   const selected=run.checkpoints.find(c=>c.step===Number(requested));if(!selected)throw Error('Retained checkpoint unavailable');const token=++generation;pending=true;problem=null;sync();
   try{
    await neuralAppearanceProgram.prepare({source:selected.source});if(disposed||token!==generation)return read();
    for(const recipe of recipes()){if(disposed||token!==generation)return read();await host.scene.materials.edit(recipe.id,{parameters:{source:selected.source}});}
    if(disposed||token!==generation)return read();step=selected.step;persist();session.redraw();await draw();record({kind:'neural-appearance.checkpoint',phase:'applied',effective:read()});return read();
   }catch(e){if(token===generation)problem=e.message;throw e;}finally{if(token===generation){pending=false;reconcile();sync();}}
  };
  const repaint=async()=>{problem=null;try{await draw();persist();return read();}catch(e){problem=e.message;sync();throw e;}};
  const reconcile=()=>{if(disposed)return;const actual=trajectorySceneState(run,recipes());if(!pending&&actual.state==='matched'&&actual.step!==step){step=actual.step;persist();void draw().catch(e=>{problem=e.message;sync();});}sync();};
  try{await select(step);}catch(error){await session.dispose();throw error;}
  const unsubscribe=host.scene.materials.subscribe?.(reconcile)??(()=>{});
  return {read,operations:{selectCheckpoint:select,setCameraView:value=>session.setView(value),
   setResponseView(id){if(!run.views.some(v=>v.id===id))throw Error('Unknown retained view');viewId=id;return repaint();},
   setExposure(value){if(!Number.isFinite(value)||value<=0)throw Error('Positive display exposure required');exposure=value;return repaint();},
   async refreshSlices(){const response=await fetch(inputs.slices??inputs.run);if(!response.ok)throw Error('Matched slices not published yet');const next=readAppearanceTrajectory(await response.json());assertTrajectoryContinuation(run,next);run=next;if(!run.views.some(v=>v.id===viewId))viewId=run.views[0].id;if(viewControl){viewControl.replaceChildren(...run.views.map(v=>new panel.ownerDocument.defaultView.Option(v.label,v.id)));}sync();return repaint();}},
   async mount({root,document,invoke}){
    panel=root;const heading=document.createElement('p');heading.textContent='Retained training stages · same learned architecture and source';root.append(heading);
    const field=(label,entries,operation)=>{const row=document.createElement('label'),select=document.createElement('select');select.setAttribute('aria-label',label);for(const [value,text] of entries)select.add(new document.defaultView.Option(text,value));select.onchange=()=>invoke(operation,select.value).catch(e=>{problem=e.message;sync();});row.append(label,select);root.append(row);return select;};
    checkpointControl=field('Training step ',run.checkpoints.map(c=>[String(c.step),`Step ${c.step} · log error ${c.heldoutLogL1.toPrecision(4)}`]),'selectCheckpoint');
    viewControl=field('Response slice ',run.views.map(v=>[v.id,v.label]),'setResponseView');
    const row=document.createElement('label'),grip=document.createElement('span'),number=document.createElement('input');grip.textContent='Slice exposure ';number.type='number';number.value=exposure;number.min='.001';number.step='any';number.className='transform-input';number.oninput=()=>{if(number.validity.valid)invoke('setExposure',number.valueAsNumber).catch(e=>{problem=e.message;sync();});};row.append(grip,number);root.append(row);drag=host.controls.installNumberDrag({input:number,grip,step:.1});
    const refresh=document.createElement('button');refresh.textContent='Refresh slices';refresh.onclick=()=>invoke('refreshSlices').catch(e=>{problem=e.message;sync();});
    status=document.createElement('p');status.setAttribute('role','status');loss=document.createElement('pre');loss.setAttribute('aria-label','Held-out log response error');images=document.createElement('div');images.className='neural-trajectory-slices';images.style.cssText='display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px';root.append(refresh,status,loss,images);sync();await draw();
   },async dispose(){disposed=true;generation++;drawGeneration++;unsubscribe();drag?.dispose();await session.dispose();}}
 }
};
