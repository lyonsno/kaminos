// Immutable renderer inputs. These are render frames, never solver checkpoints.
export function createFluidRenderHistory({device,sources,usage}){
 const frames=new Map();let disposed=false,ordinal=0,bytes=0;
 for(const name of ['particles','topology','tracers'])if(!sources[name]?.buffer||!Number.isSafeInteger(sources[name].bytes)||sources[name].bytes<=0)throw Error('Missing render source '+name);
 const active=()=>{if(disposed)throw Error('Render history disposed');};
 function capture(metadata){
  active();const buffers={},size=Object.values(sources).reduce((n,s)=>n+s.bytes,0),index=ordinal++;
  try{
   const encoder=device.createCommandEncoder({label:'retain-fluid-render-frame-'+index});
   for(const [name,source]of Object.entries(sources)){
    buffers[name]=device.createBuffer({label:`retained-fluid-${name}-${index}`,size:source.bytes,usage});
    encoder.copyBufferToBuffer(source.buffer,0,buffers[name],0,source.bytes);
   }
   device.queue.submit([encoder.finish()]);
  }catch(error){for(const buffer of Object.values(buffers))buffer.destroy();throw error;}
  const entry={buffers,released:false,size};
  const frame=Object.freeze({...structuredClone(metadata),kind:'retained-render-inputs',bytes:size,release(){if(entry.released)return;entry.released=true;for(const buffer of Object.values(buffers))buffer.destroy();bytes-=size;}});
  frames.set(frame,entry);bytes+=size;return frame;
 }
 return{capture,buffers(frame){active();const entry=frames.get(frame);if(!entry)throw Error('Unknown render frame');if(entry.released)throw Error('Render frame released');return entry.buffers;},state:()=>({frames:[...frames.values()].filter(x=>!x.released).length,bytes,kind:'volatile-render-history',simulationCheckpoint:false}),dispose(){if(disposed)return;for(const frame of frames.keys())frame.release();frames.clear();disposed=true;}};
}
