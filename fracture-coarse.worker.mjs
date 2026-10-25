import {prepareCoarseFracture} from './fracture-coarse-prepare.mjs';
self.onmessage=({data})=>{try{self.postMessage({id:data.id,prepared:prepareCoarseFracture(data.arrays,data.faces,data.options)});}catch(error){self.postMessage({id:data.id,error:error.message});}};
