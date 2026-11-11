import {createEarthDynamicsKernel} from './earth-dynamics.mjs';
const kernel=createEarthDynamicsKernel();
self.onmessage=({data})=>{try{self.postMessage({id:data.id,result:kernel.apply(data)});}catch(error){self.postMessage({id:data.id,error:error.message});}};
