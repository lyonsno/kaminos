import {createEarthTeacherSource} from './earth-surface.mjs';
self.onmessage=({data})=>{try{self.postMessage({source:createEarthTeacherSource(data)});}catch(error){self.postMessage({error:error.message});}};
