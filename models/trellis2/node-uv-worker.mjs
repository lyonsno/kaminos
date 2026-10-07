// Execute the identical shipped CPU UV worker in an owned Node worker thread.
// This adapter changes transport only; UV generation/repacking remains owned
// by unwrapTrellisMesh and the observed SF3D worker bundle.
import {Worker} from 'node:worker_threads';
export class NodeTrellisUVWorker {
  constructor(url){
    this.worker=new Worker(`const {parentPort,workerData}=require('node:worker_threads');
      globalThis.self={postMessage:(data,transfer)=>parentPort.postMessage(data,transfer)};
      (async()=>{await import(workerData);parentPort.on('message',data=>self.onmessage({data}));})();`,
      {eval:true,workerData:url.href});
    this.worker.on('message',data=>this.onmessage?.({data}));
    this.worker.on('error',error=>this.onerror?.({message:error.message}));
    this.worker.on('messageerror',error=>this.onmessageerror?.(error));
  }
  postMessage(data,transfer){this.worker.postMessage(data,transfer);}
  terminate(){return this.worker.terminate();}
}
