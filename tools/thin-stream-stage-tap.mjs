// Evidence-only instrumentation. It copies native buffers between selected
// dispatches by splitting their compute pass. It does not change shader inputs.
export function installThinStreamStageTap() {
  const trace=window.__thinStreamTrace={route:'native-dispatch-copy-with-pass-splitting.v1',active:null,records:[],devices:[]};
  const buffers=new WeakMap(),pipelines=new WeakMap();
  const selected=new Set(['predict_positions','compute_density_lambda','solve_position_delta','apply_position_delta','classify_free_surface','compute_velocity_viscosity','apply_vorticity_confinement','apply_surface_cohesion','apply_velocity_position']);
  const bufferNames=['kaminos-finger-fluid-particles','kaminos-finger-fluid-rest-state','kaminos-finger-fluid-params'];
  const createBuffer=GPUDevice.prototype.createBuffer;
  GPUDevice.prototype.createBuffer=function(d){const b=createBuffer.call(this,d);let m=buffers.get(this);if(!m){m=new Map();buffers.set(this,m)}if(bufferNames.includes(d.label))m.set(d.label,b);return b};
  const createPipeline=GPUDevice.prototype.createComputePipelineAsync;
  GPUDevice.prototype.createComputePipelineAsync=async function(d){const p=await createPipeline.call(this,d);pipelines.set(p,d.compute.entryPoint);return p};
  const createEncoder=GPUDevice.prototype.createCommandEncoder;
  GPUDevice.prototype.createCommandEncoder=function(d={}){
    const encoder=createEncoder.call(this,d),device=this;
    if(d.label!=='kaminos-finger-fluid-simulation-step')return encoder;
    const begin=encoder.beginComputePass.bind(encoder);
    encoder.beginComputePass=function(desc={}){
      let pass=begin(desc),pipeline=null;const groups=new Map();
      return {
        setPipeline(p){pipeline=p;pass.setPipeline(p)},
        setBindGroup(...args){groups.set(args[0],args);pass.setBindGroup(...args)},
        dispatchWorkgroups(...args){
          pass.dispatchWorkgroups(...args);
          const entry=pipelines.get(pipeline);
          if(!trace.active||!selected.has(entry))return;
          if(desc.timestampWrites)throw Error('stage trace must run outside timestamp measurement');
          const sources=buffers.get(device);
          for(const name of bufferNames)if(!sources?.get(name))throw Error('native trace buffer missing: '+name);
          pass.end();
          const row={step:trace.active.step,entry,ordinal:trace.records.length,buffers:[]};
          if(!trace.devices.includes(device))trace.devices.push(device);
          for(const name of bufferNames){
            const source=sources.get(name),copy=createBuffer.call(device,{label:'thin-stream-stage-readback',size:source.size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
            encoder.copyBufferToBuffer(source,0,copy,0,source.size);row.buffers.push({label:name,size:source.size,buffer:copy});
          }
          trace.records.push(row);
          pass=begin({label:'thin-stream-stage-continuation'});for(const group of groups.values())pass.setBindGroup(...group);pass.setPipeline(pipeline);
        },
        end(){pass.end()},
      };
    };
    return encoder;
  };
  trace.finish=async()=>{
    trace.active=null;
    await Promise.all(trace.devices.map(d=>d.queue.onSubmittedWorkDone()));
    const output=[];
    try{
      for(const row of trace.records){
        const r={step:row.step,entry:row.entry,ordinal:row.ordinal,buffers:[]};
        for(const b of row.buffers){
          await b.buffer.mapAsync(GPUMapMode.READ);const bytes=new Uint8Array(b.buffer.getMappedRange());
          let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
          r.buffers.push({label:b.label,size:b.size,bytes:btoa(binary)});b.buffer.unmap();
        }
        output.push(r);
      }
      return {schema:'soggy.native-fluid-stage-trace.v1',route:trace.route,records:output,meaning:'Native buffer copies at selected dispatch boundaries; instrumented pass splitting, no timing claim.'};
    }finally{for(const row of trace.records)for(const b of row.buffers)b.buffer.destroy();trace.records=[];trace.devices=[]}
  };
}
export function validateThinStreamStageTrace(value,step,count,densityIterations){
  if(value?.schema!=='soggy.native-fluid-stage-trace.v1'||value.route!=='native-dispatch-copy-with-pass-splitting.v1')throw Error('wrong native stage trace route');
  const entries=['predict_positions',...Array.from({length:densityIterations},()=>['compute_density_lambda','solve_position_delta','apply_position_delta']).flat(),'classify_free_surface','compute_velocity_viscosity'];
  // Vorticity is dispatched every third frame. The actual native order is preserved.
  const names=value.records?.map(r=>r.entry);
  if((step-1)%3===0)entries.push('apply_vorticity_confinement');
  entries.push('apply_surface_cohesion','apply_velocity_position');
  if(JSON.stringify(names)!==JSON.stringify(entries))throw Error('missing, duplicate or reordered native stages');
  for(const [i,r] of value.records.entries()){
    if(r.step!==step||r.ordinal!==i)throw Error('stale step or trace ordinal');
    const sizes=[count*64,count*16,224],labels=['kaminos-finger-fluid-particles','kaminos-finger-fluid-rest-state','kaminos-finger-fluid-params'];
    if(r.buffers?.length!==3)throw Error('missing native stage buffers');
    for(let j=0;j<3;j++){
      const b=r.buffers[j];if(b.label!==labels[j]||b.size!==sizes[j]||typeof b.bytes!=='string')throw Error('native stage buffer shape mismatch');
      const bytes=Buffer.from(b.bytes,'base64');if(bytes.length!==b.size)throw Error('partial native stage buffer');
      if(j===2){if(bytes.readUInt32LE(4)!==count||bytes.readUInt32LE(8)!==step-1)throw Error('native params count/frame mismatch')}
      if(j<2){const floats=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.length/4);if(!floats.every(Number.isFinite))throw Error('nonfinite native stage state')}
    }
  }
  const final=Buffer.from(value.records.at(-1).buffers[0].bytes,'base64');
  let densityPresent=false;
  for(let i=0;i<count;i++)if(final.readFloatLE(i*64+60)>0)densityPresent=true;
  if(!densityPresent)throw Error('blank final material');
  return {step,stages:names,particleCount:count,complete:true};
}
// Chrome writes the chosen port and browser path into its fresh profile.
export function validateOwnedCdpEndpoint(activePortText,version){
  const lines=activePortText.trim().split('\n'),port=Number(lines[0]),browserPath=lines[1];
  if(lines.length!==2||!Number.isInteger(port)||port<1||port>65535||!browserPath?.startsWith('/devtools/browser/'))throw Error('malformed owned profile DevToolsActivePort');
  const u=new URL(version.webSocketDebuggerUrl);
  if(u.protocol!=='ws:'||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||Number(u.port)!==port||u.pathname!==browserPath)throw Error('owned profile CDP endpoint mismatch');
  return {port,browserPath};
}
