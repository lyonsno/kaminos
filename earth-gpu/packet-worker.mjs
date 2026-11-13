import {makePacketState} from './packets.mjs';
self.onmessage=({data})=>{try{const state=makePacketState(data);self.postMessage({state},[state.floats.buffer]);}catch(e){self.postMessage({error:e.message});}};
