import {prepareWholeFracture} from './fracture-whole-prepare.mjs';
self.onmessage=({data})=>{try{self.postMessage({id:data.id,prepared:prepareWholeFracture(data.arrays,data.view,data.options)});}catch(error){self.postMessage({id:data.id,error:error.message});}};
