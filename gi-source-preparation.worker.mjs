import {mergeSurfelLevel} from './trellis-surfels.mjs';
self.onmessage=({data})=>{
  try {self.postMessage({field:mergeSurfelLevel(data.field,data.factor).field});}
  catch(error){self.postMessage({error:error.message});}
};
