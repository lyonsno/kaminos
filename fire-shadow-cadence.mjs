export function validateShadowCaptureBudget(value){
  if(!Number.isSafeInteger(value)||value<0)throw Error('solid cube capture budget must be a nonnegative integer');
  return value;
}

// A plan becomes visible only after every selected complete cube was captured.
// Failed/abandoned plans neither advance the round robin nor claim freshness.
export function createShadowCaptureSchedule({count,budget=0}){
  if(!Number.isSafeInteger(count)||count<1)throw Error('positive source count required');
  validateShadowCaptureBudget(budget);
  let ordinal=0,next=0,key=null,pending=null,last=null;
  const captured=Array(count).fill(null),sources=Array(count).fill(null);
  const clone=value=>value===null?null:structuredClone(value);
  return {
    setBudget(value){budget=validateShadowCaptureBudget(value);pending=null;},
    invalidate(){key=null;pending=null;},
    begin(revision){
      const reason=ordinal===0?'initialize':revision!==key?'invalidate':'round-robin';
      const n=reason==='round-robin'?Math.min(count,budget||count):count;
      pending={ordinal:ordinal+1,revision,reason,indices:Array.from({length:n},(_,i)=>(reason==='round-robin'?next+i:i)%count)};
      return pending;
    },
    commit(plan,source={}){
      if(!pending||plan!==pending)throw Error('expired or foreign shadow capture plan');
      ordinal=plan.ordinal;key=plan.revision;
      for(const i of plan.indices){captured[i]=ordinal;sources[i]={...source};}
      next=plan.reason==='round-robin'?(next+plan.indices.length)%count:0;
      const ages=captured.map(n=>n===null?null:ordinal-n);
      last={strategy:'round-robin-whole-cubes',ordinal,requestedBudget:budget,effectiveBudget:Math.min(count,budget||count),
        residentCount:captured.filter(n=>n!==null).length,refreshedCount:plan.indices.length,refreshedIndices:[...plan.indices],
        ages,oldestAge:Math.max(...ages),sourceFrames:clone(sources),reason:plan.reason};
      pending=null;return clone(last);
    },
    read(){return clone(last);},
  };
}

// Copy only the chosen GPU centroids. Each consumer also retains that slot's
// CPU-known local-to-world transform. RGB stays in the live point texture.
export function createShadowSourceSnapshots(device,{points,count}){
  if(!points||!Number.isSafeInteger(count)||count<1)throw Error('point texture and positive source count required');
  const texture=device.createTexture({label:'retained solid shadow source positions',size:[count,1],format:'rgba32float',
    usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC});
  let disposed=false;
  return {texture,
    capture(indices){
      if(disposed)throw Error('shadow source snapshots disposed');
      if(!Array.isArray(indices)||new Set(indices).size!==indices.length||indices.some(i=>!Number.isInteger(i)||i<0||i>=count))throw Error('unique valid source indices required');
      if(!indices.length)return;
      const encoder=device.createCommandEncoder({label:'retain selected solid shadow source positions'});
      for(const i of indices)encoder.copyTextureToTexture({texture:points,origin:[i,0,0]},{texture,origin:[i,0,0]},[1,1,1]);
      device.queue.submit([encoder.finish()]);
    },
    async readback(){
      if(disposed)throw Error('shadow source snapshots disposed');
      const bytesPerRow=Math.ceil(count*16/256)*256;
      const buffer=device.createBuffer({label:'solid shadow source diagnostic readback',size:bytesPerRow,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
      try{
        const encoder=device.createCommandEncoder();encoder.copyTextureToBuffer({texture},{buffer,bytesPerRow},[count,1,1]);device.queue.submit([encoder.finish()]);
        await buffer.mapAsync(GPUMapMode.READ);const values=new Float32Array(buffer.getMappedRange());
        return Array.from({length:count},(_,i)=>Array.from(values.slice(i*4,i*4+4)));
      }finally{buffer.destroy();}
    },
    destroy(){disposed=true;texture.destroy();},
  };
}
