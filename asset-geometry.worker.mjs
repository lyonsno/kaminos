import {prepareAssetGeometryArrival} from './asset-geometry-preparation.mjs';
self.onmessage=({data})=>{
  try{self.postMessage({result:prepareAssetGeometryArrival(data.snapshot,data.options)});}
  catch(error){self.postMessage({error:error?.stack||String(error)});}
};
