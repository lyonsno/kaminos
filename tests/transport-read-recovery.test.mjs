import assert from 'node:assert/strict';
import {mountSimulationTransport} from '../simulation-transport.mjs';
const nodes=new Map(),get=q=>{if(!nodes.has(q))nodes.set(q,{textContent:'',value:'',disabled:false,hidden:false});return nodes.get(q);};
const document={activeElement:null,createElement(){return {setAttribute(){},querySelector:get,querySelectorAll(){return [get('[data-action=play]'),get('select')];},remove(){}};}};
let fail=false;
const transport={state:()=>({busy:false}),read(){if(fail)throw Error('Water renewing');return {step:0,dt:1/240,paused:true,rate:1,cadence:'render_cadence'};},toggle:()=>Promise.reject(Error('Action rejected')),dispose:async()=>{}};
const ui=mountSimulationTransport({document,root:{append(){}},transport});
try{
 fail=true;ui.update();assert.equal(get('[role=alert]').textContent,'Water renewing');
 fail=false;ui.update();assert.equal(get('[role=alert]').textContent,'','recovered read must remove obsolete warning');
 get('[data-action=play]').onclick();await new Promise(setImmediate);ui.update();assert.equal(get('[role=alert]').textContent,'Action rejected','successful reads must retain action failures');
}finally{await ui.dispose();}
const ui2=mountSimulationTransport({document,root:{append(){}},transport});
try{
 get('[data-action=play]').onclick();await new Promise(setImmediate);
 fail=true;ui2.update();fail=false;ui2.update();
 assert.equal(get('[role=alert]').textContent,'Action rejected','read fault and recovery must retain the independently failed action');
}finally{await ui2.dispose();}
