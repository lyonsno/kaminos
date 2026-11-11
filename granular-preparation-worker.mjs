import {createGranularPreparation} from './granular-preparation.mjs';
let model;
self.onmessage=({data})=>{try{
 if(data.kind==='init'){const next=createGranularPreparation(data.recipe,data.snapshot);model?.dispose();model=next;}
 else if(!model)throw Error('Preparation is not initialized');
 else if(data.kind==='start')model.start(data.operation,data.options);
 else if(data.kind==='advance')model.advance(data.seconds);
 else if(data.kind!=='snapshot')throw Error('Unknown preparation worker message');
 self.postMessage({id:data.id,snapshot:model.snapshot(),state:model.read()});
}catch(error){self.postMessage({id:data.id,error:error.message});}};
