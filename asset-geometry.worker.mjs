import {prepareAssetGeometryArrival,prepareAssetGeometryBounds} from './asset-geometry-preparation.mjs';
self.onmessage=({data})=>{
  try{if(data.task&&data.task!=='bounds')throw Error('Unknown asset geometry task');
    self.postMessage({result:data.task==='bounds'?prepareAssetGeometryBounds(data.snapshots,data.options):prepareAssetGeometryArrival(data.snapshot,data.options)});}
  catch(error){self.postMessage({error:error?.stack||String(error)});}
};
