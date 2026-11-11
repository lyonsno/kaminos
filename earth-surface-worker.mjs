import {createEarthTeacherSource} from './earth-surface.mjs';
self.onmessage=({data})=>{try{self.postMessage({id:data.id,source:createEarthTeacherSource(data)});}catch(error){self.postMessage({id:data.id,error:error.message});}};
