export default {
 id:'water-jet-study',title:'Water jet playground',
 async create({host,inputs,record}){
  const session=await host.scene.open(),app=window.kaminosSceneAuthoring,water=window.kaminosWaterSources;
  let held=null,triggerRequested=false;
  const read=()=>({water:water.read(),view:session.readView()});
  async function addNozzle(){const id=await app.addWaterEmitter();water.edit(id,{mode:'continuous',baseRadius:.075,strength:1.5,flowMode:'speed',emissionEnabled:false});record({kind:'water-jet.add',phase:'applied',target:id,effective:read()});return id;}
  async function addPair(){
   await water.commitEdits();const initialize=!water.read().simulation.present,ids=[];
   for(const sign of [-1,1]){const id=await addNozzle();window.kaminosSetSceneObjectTransform(id,{position:[sign*.3,1,0],rotation:[0,-sign*Math.PI/2,0],scale:[1,1,1]});window.renameSceneObject(id,sign<0?'Left squirter':'Right squirter');ids.push(id);}
   const target=await water.createAimTarget(ids[0]);window.kaminosSetSceneObjectTransform(target,{position:[0,1,0]});water.edit(ids[1],{aimAt:target});
   if(initialize)water.editSimulation({cellSize:.05,timeStepSeconds:1/240,stepSubsteps:4,maxSubstepsPerBatch:24,timePolicy:'complete',particleCount:12000,waterSampling:{spacing:.05/Math.cbrt(3),container:null,worldBounds:{min:[-1.1,-.4,-1.1],max:[1.1,1.6,1.1]}}});
   session.setView({position:[1.6,1.5,2.7],target:[0,.7,0]});record({kind:'water-jet.pair',phase:'applied',targets:ids,effective:read()});return {ids,target};
  }
  async function squirt(pressed){
   triggerRequested=pressed;
   if(pressed){if(held)return read();await water.commitEdits();if(!triggerRequested)return read();held=new Map(app.read().objects.filter(row=>row.type==='local-liquid-emitter'&&row.localLiquidEmitter?.mode!=='finite_drop').map(row=>[row.id,row.localLiquidEmitter.emissionEnabled!==false]));
    const sourceIds=[...held.keys()];for(const id of sourceIds)water.edit(id,{emissionEnabled:true});
    if(!water.read().runtime){await water.release();
     // Release may complete while the host is mounting from its input snapshot.
     // Reconcile the mounted inlets with the current authored emission switches.
     for(const id of sourceIds){const row=app.read().objects.find(row=>row.id===id);if(row)water.edit(id,{emissionEnabled:row.localLiquidEmitter.emissionEnabled!==false});}
    }else if(water.read().runtime.paused)water.pause();
   }else if(held){const previous=held;held=null;for(const [id,enabled]of previous)if(app.read().objects.some(row=>row.id===id))water.edit(id,{emissionEnabled:enabled});}
   const effective=read();record({kind:'water-jet.squirt',phase:pressed?'pressed':'released',effective});return effective;
  }
  function addBackdrop(){const ids=[];for(let i=0;i<9;i++){const id=app.addMesh('box',{width:.15,height:1.5,depth:.02});window.kaminosSetSceneObjectTransform(id,{position:[(i-4)*.15,.65,-.4]});app.setMaterial(id,{color:i%2?'#eee8d8':'#172632',roughness:1});app.setWaterCollision(id,false);ids.push(id);}return app.group(ids,'Refraction backdrop');}
  if(inputs.seed!==false&&!app.read().objects.length)await addPair();
  return {read,operations:{addNozzle,addPair,addBackdrop,squirt,simulation:()=>water.selectSimulation()},
   mount({root,document,invoke}){
    const intro=document.createElement('p');intro.textContent='Select a squirter to change its aim target, aperture, speed and flow. Move the yellow target with the normal gizmo. The blue curve previews gravity before any fluid interaction.';
    const status=document.createElement('p');status.setAttribute('role','status');const call=(name,value)=>invoke(name,value).catch(error=>{status.textContent=error.message;});
    const button=(text,name)=>{const node=document.createElement('button');node.className='btn';node.textContent=text;node.onclick=()=>call(name);return node;};
    const trigger=document.createElement('button');trigger.className='btn';trigger.textContent='Hold to squirt';
    trigger.onpointerdown=event=>{if(event.button!==0)return;event.preventDefault();trigger.setPointerCapture(event.pointerId);void squirt(true).catch(error=>{status.textContent=error.message;});};
    trigger.onpointerup=trigger.onpointercancel=trigger.onlostpointercapture=()=>{void squirt(false).catch(error=>{status.textContent=error.message;});};
    const note=document.createElement('p');note.textContent='Release restores each source’s emission switch; existing water keeps moving. Use Water simulation for cell size, timestep, material controls, Play, Restart and exact Step. Ordinary Save retains your sources, targets and physics settings.';
    root.append(intro,button('Add striped backdrop','addBackdrop'),button('Add squirter','addNozzle'),button('Add opposing pair','addPair'),trigger,button('Water simulation','simulation'),note,status);
   },async dispose(){await squirt(false);await session.dispose();},
  };
 },
};
