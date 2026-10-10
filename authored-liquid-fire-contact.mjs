// The envelope owns authored scene provenance; the GPU descriptor retains its
// producer's header identity. Binding is by allocation, never by scene labels.
export function createAuthoredLiquidFireContactBridge() {
  let owner=null, receiver=null, descriptor=null;
  let current={status:'unbound',sourceIds:[]};
  function clear() {
    const previous=receiver;
    owner=null;receiver=null;descriptor=null;
    current={status:'unbound',sourceIds:[]};
    previous?.clearLiquidFireContactDescriptor();
  }
  function sync(host,nextReceiver) {
    try {
      const frame=host?.contactFrame?.();
      if(!frame || !nextReceiver){clear();return current;}
      if(frame.schema!=='kaminos.authored-liquid-contact-frame.v1'
        || !frame.hostFrameId || !Number.isSafeInteger(frame.producerTick) || frame.producerTick<1
        || !Number.isSafeInteger(frame.sceneGeneration) || frame.sceneGeneration<0
        || !Number.isSafeInteger(frame.sourceGeneration) || frame.sourceGeneration<0
        || !Array.isArray(frame.sourceIds) || frame.sourceIds.some(id=>typeof id!=='string'||!id)
        || !frame.descriptor?.device || frame.descriptor.queue!==frame.descriptor.device.queue)throw Error('Invalid authored liquid contact frame');
      const d=frame.descriptor;
      const changed=owner!==host || receiver!==nextReceiver || !descriptor
        || descriptor.headerBuffer!==d.headerBuffer || descriptor.recordsBuffer!==d.recordsBuffer
        || descriptor.allocationGeneration!==d.allocationGeneration || descriptor.epoch!==d.epoch;
      if(changed){
        clear();
        // Seat the receiver first so a failed binding is also retired.
        receiver=nextReceiver;
        const receipt=receiver.setLiquidFireContactDescriptor(d);
        if(receipt.sameDevice!==true)throw Error('Authored liquid contact receiver did not admit shared device');
        owner=host;descriptor=d;
      }
      current={status:'bound',hostFrameId:frame.hostFrameId,sceneGeneration:frame.sceneGeneration,
        sourceGeneration:frame.sourceGeneration,sourceIds:[...frame.sourceIds],producerTick:frame.producerTick,
        allocationGeneration:d.allocationGeneration,epoch:d.epoch,sourceFrameId:d.sourceFrameId};
      return current;
    } catch(error){clear();current={status:'failed',sourceIds:[],failure:String(error.message||error)};throw error;}
  }
  return {sync,retire(host){if(owner===host)clear();},state:()=>structuredClone(current)};
}
