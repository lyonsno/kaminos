import {createInferenceKiln} from '../inference-kiln.mjs';

export default {id:'inference-kiln',title:'Inference Kiln',async create({host,inputs={},record}){
  const session=await host.scene.open(),doc=host.controls.document;
  let kiln;
  const ground=doc.getElementById('composition-ground-visible'),groundVisible=ground?.checked,helpers=[];
  let asset,flame,runtime,restoreControls,wasPaused,canvas,opacity,stop=()=>{},status,cooling=0,closed=false;
  const hideHelpers=()=>{for(const entry of host.scene.objects())if(entry.type==='flame-emitter'){
    if(!helpers.some(([o])=>o===entry.object))helpers.push([entry.object,entry.object.visible]);entry.object.visible=false;
  }};
  const setGround=value=>{if(ground){ground.checked=value;ground.onchange({target:ground});}};
  const setFeed=value=>flame.setControls({'volume-flow-rate':value?2.5:0,'volume-immersed-fuel':value?.55:0});
  const showFire=value=>{if(canvas)canvas.style.opacity=String(value);};
  async function dispose(){
    if(closed)return;closed=true;stop();
    try{if(restoreControls)flame.setControls(restoreControls);}
    finally{
      if(runtime)runtime.setSimulationPaused(wasPaused);
      if(canvas)canvas.style.opacity=opacity;
      for(const [o,visible] of helpers)o.visible=visible;setGround(groundVisible);
      try{await session.dispose();}finally{kiln?.dispose();}
    }
  }
  try{
    kiln=createInferenceKiln({document:doc,prompt:inputs.prompt??'A weathered bronze lantern',duration:inputs.duration??6});
    asset=await session.attach(kiln.root,{owned:true,metadata:{label:'Inference Kiln',type:'experiment',source:'inference-kiln:prompt-study'}});
    await host.volume.ready;flame=await host.flame.open();
    if(!flame.read().active)throw Error('Inference Kiln needs the flame route; open inference-kiln-study.html');
    const original=flame.read().settings;
    restoreControls=Object.fromEntries(['volume-flow-rate','volume-immersed-fuel','volume-ray-start-noise','volume-ray-noise-animated'].map(id=>[id,(original.domControls[id]??original.rendererControls?.[id]).value]));
    runtime=host.volume.get();wasPaused=runtime.debugState().simulationPaused===true;
    canvas=runtime.canvasElement?.();opacity=canvas?.style.opacity;
    runtime.setSimulationPaused(true);flame.setControls({'volume-ray-start-noise':false,'volume-ray-noise-animated':false});setFeed(false);showFire(0);hideHelpers();setGround(false);
    doc.defaultView.kaminosSelection?.clear();
    const read=()=>({...kiln.read(),cooling:cooling>0,objectId:asset.id,flame:flame.read().clock,
      controls:flame.read().runtime.controls,scope:'visual-study-no-model-inference'});
    const sync=()=>{if(status)status.textContent=kiln.read().running?'Burning prompt…':kiln.read().consumed?'Prompt consumed. Replay or write another.':'Write a prompt, then ignite.';};
    const assertOpen=()=>{if(closed)throw Error('Inference Kiln study is closed');};
    const reset=()=>{assertOpen();runtime.setSimulationPaused(true);runtime.resetThermalExperimentFluid();cooling=0;setFeed(false);showFire(0);kiln.reset();session.redraw();sync();return read();};
    const operations={read,
      setPrompt(value){assertOpen();kiln.setPrompt(value);reset();record({kind:'inference-kiln.prompt',effective:kiln.read()});return read();},
      ignite(){assertOpen();reset();kiln.ignite();setFeed(true);hideHelpers();showFire(1);runtime.setSimulationPaused(false);sync();return read();},
      reset,
      frame(){assertOpen();return session.setView({position:[0,.1,4.5],target:[0,0,0]});},
    };
    stop=session.onFrame(({deltaSeconds})=>{
      if(closed)return;hideHelpers();
      const before=kiln.read().running;kiln.advance(deltaSeconds);
      if(before&&!kiln.read().running){setFeed(false);cooling=2;sync();}
      if(cooling>0){cooling=Math.max(0,cooling-deltaSeconds);showFire(cooling/2);if(!cooling){runtime.setSimulationPaused(true);runtime.resetThermalExperimentFluid();}}
      if(before||cooling>0)session.redraw();
    });
    operations.frame();
    return {read,operations,mount({root,document,invoke}){
      const label=document.createElement('label');label.textContent='Prompt';
      const field=document.createElement('textarea');field.value=kiln.read().prompt;field.rows=4;
      field.style.cssText='display:block;width:100%;box-sizing:border-box;background:#202327;color:#eee;border:1px solid #42464c;border-radius:6px;padding:10px;margin:8px 0;font:inherit;';field.setAttribute('aria-label','Kiln prompt');label.append(field);
      field.addEventListener('change',()=>invoke('setPrompt',field.value).catch(e=>{status.textContent=e.message;}));
      const actions=document.createElement('div');actions.className='flame-basin-actions';
      for(const [name,op] of [['Ignite','ignite'],['Reset','reset'],['Frame','frame']]){
        const button=document.createElement('button');button.type='button';button.className='btn';button.textContent=name;
        button.onclick=()=>invoke(op).catch(e=>{status.textContent=e.message;});actions.append(button);
      }
      status=document.createElement('p');status.setAttribute('role','status');root.append(label,actions,status);sync();
    },dispose};
  }catch(error){await dispose();throw error;}
}};
