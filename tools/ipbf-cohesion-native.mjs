/** Diagnostic dispatch of the actual factory's isolated cohesion stage. */
export async function nativeCohesionFixture(cases,moduleURL,options={}) {
  const model=options.cohesionModel??'ipbf_free_surface';
  if(!['ipbf_free_surface','akinci_2013'].includes(model))throw Error('Unsupported native component');
  const published=model==='akinci_2013';
  const adapter=await navigator.gpu.requestAdapter();
  if(!adapter||adapter.info?.isFallbackAdapter!==false||adapter.info.vendor!=='apple')throw Error('Native Apple adapter unavailable/fallback');
  const device=await adapter.requestDevice({requiredLimits:{maxStorageBuffersPerShaderStage:adapter.limits.maxStorageBuffersPerShaderStage}});
  let solver;const buffers=new Map(),pipelines=new Map(),groups=[];let paramsBytes;
  const write=device.queue.writeBuffer.bind(device.queue);
  Object.defineProperty(device.queue,'writeBuffer',{configurable:true,value:(buffer,offset,data,...rest)=>{
    if(buffer===buffers.get('kaminos-finger-fluid-params')&&offset===0)paramsBytes=new Uint8Array(data instanceof ArrayBuffer?data:data.buffer,data.byteOffset??0,data.byteLength).slice();
    return write(buffer,offset,data,...rest);
  }});
  const create=device.createBuffer.bind(device);
  Object.defineProperty(device,'createBuffer',{configurable:true,value:d=>{const b=create(d);if(d.label)buffers.set(d.label,b);return b;}});
  const bind=device.createBindGroup.bind(device);
  Object.defineProperty(device,'createBindGroup',{configurable:true,value:d=>{const g=bind(d);groups.push({d,g});return g;}});
  const pipeline=device.createComputePipelineAsync.bind(device);
  Object.defineProperty(device,'createComputePipelineAsync',{configurable:true,value:async d=>{const p=await pipeline(d);pipelines.set(d.compute.entryPoint,p);return p;}});
  try {
    const core=await import(moduleURL);
    const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;
    const capacity=Math.max(1024,...cases.map(c=>c.positions?.length??3));
    solver=await core.createWebGPUFingerFluidSolver({canvas,webgpuDevice:device,particleCount:capacity,pressureSolver:'ipbf',livePressureControls:true,ipbfDamping:true,cohesionModel:model,capillaryStrength:0,energyDiagnosticsMode:'disabled',rendererMode:'screen_space_refraction'});
    if(!solver.available)throw Error('Actual factory unavailable: '+JSON.stringify(solver));
    solver.step(.01);await device.queue.onSubmittedWorkDone();
    const get=name=>{const b=buffers.get('kaminos-finger-fluid-'+name);if(!b)throw Error('Actual buffer missing: '+name);return b;};
    const particle=get('particles'),params=get('params'),rest=get('rest-state'),topology=get('neighbor-topology');
    const common=groups.find(x=>x.d.label==='kaminos-finger-fluid-compute-bind-group')?.g;
    const grid=groups.find(x=>x.d.label==='kaminos-finger-fluid-ipbf-grid-bind-group')?.g;
    const pressure=groups.find(x=>x.d.label==='kaminos-finger-fluid-ipbf-bind-group')?.g;
    const surface=groups.find(x=>x.d.label==='akinci-surface-bind-group')?.g;
    if(!common||!paramsBytes)throw Error('Actual factory inputs missing');
    const outputs=[];
    for(const c of cases){
      const count=published?c.positions.length:3;
      const packet=paramsBytes.slice(),p=new DataView(packet.buffer);
      p.setFloat32(0,c.dt,true);p.setUint32(4,count,true);p.setFloat32(80,-9.2,true);p.setFloat32(116,c.strength,true);p.setFloat32(104,0,true);
      const topologyWords=core.KAMINOS_FINGER_FLUID_NEIGHBOR_TOPOLOGY_WORDS;
      if(topologyWords!==36)throw Error('Native topology packing changed');
      const input=new Float32Array(count*16),topo=new Float32Array(count*topologyWords);
      for(let i=0;i<count;i++){
        const position=published?c.positions[i]:[-1.2+[0,.6,.95][i]*Math.fround(.185),1.5,.6];
        const predicted=published?position.map(x=>x+1):position;
        input.set([...position,1,...predicted,1,0,0,0,c.phases?.[i]??.08,0,0,0,4.86],i*16);
        topo[i*topologyWords+32]=1; // NeighborTopology.refinement.x: full equal volume.
      }
      device.pushErrorScope('validation');
      write(params,0,packet);write(particle,0,input);write(rest,0,new Float32Array(count*4));write(topology,0,topo);
      const readback=create({size:input.byteLength,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
      const fieldReadback=published?create({size:count*32,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}):null;
      const encoder=device.createCommandEncoder();const pass=encoder.beginComputePass();pass.setBindGroup(0,common);
      pass.setPipeline(pipelines.get('clear_grid'));pass.dispatchWorkgroups(Math.ceil(p.getUint32(12,true)/64));
      if(published){
        if(!grid||!pressure||!surface)throw Error('Actual surface component bindings missing');
        pass.setBindGroup(0,grid);pass.setBindGroup(1,pressure);pass.setBindGroup(2,surface);
        for(const stage of ['surface_build_grid','surface_density','surface_normals','surface_force']){
          pass.setPipeline(pipelines.get(stage));pass.dispatchWorkgroups(Math.ceil(count/64));
        }
      }else{
        pass.setPipeline(pipelines.get('build_linked_cell_grid'));pass.dispatchWorkgroups(1);
        pass.setPipeline(pipelines.get('apply_surface_cohesion'));pass.dispatchWorkgroups(1);
      }
      pass.end();
      encoder.copyBufferToBuffer(particle,0,readback,0,input.byteLength);device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone();const error=await device.popErrorScope();if(error)throw Error(error.message);
      await readback.mapAsync(GPUMapMode.READ);const output=Array.from(new Float32Array(readback.getMappedRange()));readback.unmap();readback.destroy();
      let fields;
      if(published){const e=device.createCommandEncoder();e.copyBufferToBuffer(buffers.get('akinci-surface-field'),0,fieldReadback,0,count*32);device.queue.submit([e.finish()]);await fieldReadback.mapAsync(GPUMapMode.READ);fields=Array.from(new Float32Array(fieldReadback.getMappedRange()));fieldReadback.unmap();fieldReadback.destroy();}
      outputs.push({...c,input:Array.from(input),output,...(published?{fields}:{}),simulationWords:Array.from(new Uint32Array(packet.buffer)),restInput:Array(count*4).fill(0),topologyInput:Array.from(topo)});
    }
    const state=solver.getDebugState();
    return {route:published?'actual-factory-akinci-surface':'actual-factory-ipbf-cohesion',moduleURL,adapter:{vendor:adapter.info.vendor,architecture:adapter.info.architecture,description:adapter.info.description,fallback:adapter.info.isFallbackAdapter,fallbackSource:'GPUAdapterInfo.isFallbackAdapter'},effective:{pressureSolver:state.pressureSolver,cohesionModel:state.cohesionModel,...(published?{surface:state.cohesionSettings}: {})},cases:outputs,
      claimLimit:'Only the isolated production cohesion dispatch, with explicit unsupported particles; pressure, damping, classification, contacts and basin motion are excluded.'};
  } finally {solver?.destroy();device.destroy();}
}
