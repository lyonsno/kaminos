/** Diagnostic dispatch of the actual factory's isolated cohesion stage. */
export async function nativeCohesionFixture(cases,moduleURL) {
  const adapter=await navigator.gpu.requestAdapter();
  if(!adapter||adapter.isFallbackAdapter||adapter.info.vendor!=='apple')throw Error('Native Apple adapter unavailable/fallback');
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
    solver=await core.createWebGPUFingerFluidSolver({canvas,webgpuDevice:device,particleCount:1024,pressureSolver:'ipbf',livePressureControls:true,ipbfDamping:true,cohesionModel:'ipbf_free_surface',capillaryStrength:0,energyDiagnosticsMode:'disabled',rendererMode:'screen_space_refraction'});
    if(!solver.available)throw Error('Actual factory unavailable: '+JSON.stringify(solver));
    solver.step(.01);await device.queue.onSubmittedWorkDone();
    const get=name=>{const b=buffers.get('kaminos-finger-fluid-'+name);if(!b)throw Error('Actual buffer missing: '+name);return b;};
    const particle=get('particles'),params=get('params'),rest=get('rest-state'),topology=get('neighbor-topology');
    const common=groups.find(x=>x.d.label==='kaminos-finger-fluid-compute-bind-group')?.g;
    if(!common||!paramsBytes)throw Error('Actual factory inputs missing');
    const outputs=[];
    for(const c of cases){
      const packet=paramsBytes.slice(),p=new DataView(packet.buffer);
      p.setFloat32(0,c.dt,true);p.setUint32(4,3,true);p.setFloat32(80,-9.2,true);p.setFloat32(116,c.strength,true);p.setFloat32(104,0,true);
      const topologyWords=core.KAMINOS_FINGER_FLUID_NEIGHBOR_TOPOLOGY_WORDS;
      if(topologyWords!==36)throw Error('Native topology packing changed');
      const input=new Float32Array(48),topo=new Float32Array(3*topologyWords);
      for(let i=0;i<3;i++){
        const position=[-1.2+[0,.6,.95][i]*Math.fround(.185),1.5,.6];
        input.set([...position,1,...position,1,0,0,0,.08,0,0,0,4.86],i*16);
        topo[i*topologyWords+32]=1; // NeighborTopology.refinement.x: full equal volume.
      }
      device.pushErrorScope('validation');
      write(params,0,packet);write(particle,0,input);write(rest,0,new Float32Array(3*4));write(topology,0,topo);
      const readback=create({size:input.byteLength,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
      const encoder=device.createCommandEncoder();const pass=encoder.beginComputePass();pass.setBindGroup(0,common);
      pass.setPipeline(pipelines.get('clear_grid'));pass.dispatchWorkgroups(Math.ceil(p.getUint32(12,true)/64));
      pass.setPipeline(pipelines.get('build_linked_cell_grid'));pass.dispatchWorkgroups(1);
      pass.setPipeline(pipelines.get('apply_surface_cohesion'));pass.dispatchWorkgroups(1);pass.end();
      encoder.copyBufferToBuffer(particle,0,readback,0,input.byteLength);device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone();const error=await device.popErrorScope();if(error)throw Error(error.message);
      await readback.mapAsync(GPUMapMode.READ);const output=Array.from(new Float32Array(readback.getMappedRange()));readback.unmap();readback.destroy();
      outputs.push({...c,input:Array.from(input),output,simulationWords:Array.from(new Uint32Array(packet.buffer)),restInput:Array(12).fill(0),topologyInput:Array.from(topo)});
    }
    const state=solver.getDebugState();
    return {route:'actual-factory-ipbf-cohesion',moduleURL,adapter:{vendor:adapter.info.vendor,architecture:adapter.info.architecture,description:adapter.info.description,fallback:adapter.isFallbackAdapter},effective:{pressureSolver:state.pressureSolver,cohesionModel:state.cohesionModel},cases:outputs,
      claimLimit:'Only the isolated production cohesion dispatch, with explicit unsupported particles; pressure, damping, classification, contacts and basin motion are excluded.'};
  } finally {solver?.destroy();device.destroy();}
}
