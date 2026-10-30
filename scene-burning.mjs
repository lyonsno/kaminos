// One fluid consumer gathers any number of independently owned material fields.
export function createSceneBurning({objects,retained=()=>[],runtime,createBody,createGas,onError=()=>{},dirty=()=>{}}){
  const bodies=new Map(),failures=new Map(),generations=new WeakMap();
  let binding=null,pending=null,disposed=false,fault=null,resync=false;
  const mounted=entry=>objects().some(row=>row.id===entry.id&&row.object===entry.object&&row.burnable?.enabled);
  function active(){return [...bodies.values()].filter(row=>mounted(row.entry));}
  function release(){binding?.detach();binding?.gas.dispose();binding=null;}
  function forget(object){
    generations.set(object,(generations.get(object)??0)+1);
    bodies.get(object)?.body.dispose();bodies.delete(object);failures.delete(object);
  }
  async function reconcile(){
    const entries=new Map([...retained(),...objects()].map(entry=>[entry.object,entry]));
    const wanted=new Map([...entries].filter(([,entry])=>entry.burnable?.enabled));
    for(const [object,row]of bodies){
      if(!wanted.has(object)){row.body.dispose();bodies.delete(object);}
      else {row.entry=entries.get(object);row.body.setMounted(mounted(row.entry));row.body.setSettings?.(row.entry.burnable);}
    }
    for(const object of failures.keys())if(!wanted.has(object))failures.delete(object);
    const host=runtime(),contextState=host?.debugState();
    if(fault?.host!==host)fault=null;
    if(binding&&binding.host!==host)release();
    if(!objects().some(entry=>entry.burnable?.enabled)){
      release();fault=null;return;
    }
    // Merely checking Burnable must not boot a cold volume or start a fire.
    if(!host||!contextState?.active||fault)return;
    if(!binding){
      const context=await host.borrowThermalGpuContext();
      if(disposed||host!==runtime())return;
      const gas=await createGas(context);
      if(disposed){gas.dispose();return;}
      try{
        const consumer={device:context.device,gasSource:gas.descriptor,
          resizeGrid:dimensions=>gas.resize(dimensions),
          materialMasks:()=>active().map(row=>row.body.materialMask()),
          prepareSource(encoder,frame){gas.begin(encoder);for(const row of active())row.body.encodeGasSource(encoder,frame,gas);gas.resolve(encoder);},
          encode(encoder,frame){for(const row of active())row.body.encode(encoder,frame);dirty();},
          read:()=>({identity:'kaminos.scene-burning.v1',objects:active().map(row=>row.body.read()),gasSource:gas.read()}),
        };
        binding={host,gas,detach:host.bindGpuThermalConsumer(consumer)};
      }catch(error){gas.dispose();throw error;}
    }
    for(const entry of objects()){
      if(!entry.burnable?.enabled||bodies.has(entry.object)||failures.has(entry.object))continue;
      try{
        const generation=generations.get(entry.object)??0;
        const body=await createBody(entry);
        if(disposed||!mounted(entry)||generation!==(generations.get(entry.object)??0)){body.dispose();continue;}
        bodies.set(entry.object,{entry,body});dirty();
      }catch(error){failures.set(entry.object,error.message);onError(error);}
    }
  }
  function sync(){
    if(disposed)return Promise.resolve();
    if(pending){resync=true;return pending;}
    pending=(async()=>{do{resync=false;await reconcile();}while(resync&&!disposed);})().catch(error=>{fault={host:runtime(),message:error.message};onError(error);}).finally(()=>{pending=null;});
    return pending;
  }
  return {sync,forget,
    setAppearance(id,value){const entry=objects().find(row=>row.id===id),row=entry&&bodies.get(entry.object);
      if(!row)throw Error('Burnable material is not resident');row.body.setAppearance(value);dirty();return row.body.read();},
    snapshot(id){
      if(runtime()?.debugState().simulationPaused!==true)throw Error('Pause before material diagnosis');
      const entry=objects().find(row=>row.id===id),row=entry&&bodies.get(entry.object);
      if(!row)throw Error('Burnable material is not resident');return row.body.snapshot();
    },
    read(id){const entry=objects().find(row=>row.id===id),row=entry&&bodies.get(entry.object),error=entry&&(failures.get(entry.object)??fault?.message);
      return {enabled:entry?.burnable?.enabled===true,status:error?'failed':!entry?.burnable?.enabled?'off':row?'resident':'waiting-for-fire',error:error??null,state:row?.body.read()??null};},
    async dispose(){disposed=true;await pending;release();for(const {body}of bodies.values())body.dispose();bodies.clear();failures.clear();},
  };
}
