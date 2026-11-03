import {createFormation,encodeFormation} from './formation.mjs';
self.onmessage=({data})=>{try{const f=createFormation(data);while(!f.done){const step=f.step();if(step%10===0)self.postMessage({step,total:data.iterations});}const buffer=encodeFormation(f.result());self.postMessage({buffer},[buffer]);}catch(e){self.postMessage({error:e.message});}};
