import {createShapeProcessor} from './fracture-shape-worker-core.mjs';
const process=createShapeProcessor();
self.onmessage=({data})=>{try{const reply=process(data);self.postMessage(reply,[reply.result.labels.buffer,...(reply.result.hierarchy?[reply.result.hierarchy.faceOwners.buffer]:[])]);}catch(error){self.postMessage({id:data.id,error:error.message});}};
