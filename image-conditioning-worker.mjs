import {smoothConditioningCloud} from './image-conditioning.mjs';
let cloud;
self.onmessage=({data})=>{try{if(data.cloud)cloud=data.cloud;if(!cloud)throw Error('No conditioning source');const result=smoothConditioningCloud(cloud,data.form);self.postMessage({id:data.id,positions:result.positions,normals:result.normals});}catch(error){self.postMessage({id:data.id,error:error.message});}};
