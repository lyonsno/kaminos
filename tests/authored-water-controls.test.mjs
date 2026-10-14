// kaminos-test: node
import assert from 'node:assert/strict';
import {mountAuthoredWaterControls} from '../authored-water-controls.mjs';
function fixture(){
 const nodes=new Map(),numbers=[],boundInputs=[];
 const input=selector=>{if(!nodes.has(selector)){const node={value:'',checked:false,dataset:{},classList:{add(){}},listeners:{},addEventListener(k,fn){this.listeners[k]=fn;}};nodes.set(selector,node);}return nodes.get(selector);};
 for(const name of ['width','samples','rate','radius','strength'])numbers.push(input('[data-'+name+']'));
 const section={querySelector:input,querySelectorAll(selector){if(selector==='label')return [];if(selector==='input[type=number]')return [...numbers,...boundInputs];if(selector==='[data-bound]')return boundInputs;const kind=selector.match(/data-bound=(min|max)/)?.[1];return boundInputs.filter(n=>n.dataset.bound===kind);},remove(){}};
 input('[data-bounds]').append=row=>boundInputs.push(...row.children);
 const document={createElement(tag){if(tag==='section')return section;return {type:'',dataset:{},children:[],classList:{add(){}},listeners:{},setAttribute(){},addEventListener(k,fn){this.listeners[k]=fn;},append(child){this.children.push(child);}};}};
 const source=(id,width)=>({id,label:id,settings:{mode:'finite_drop',rate:1200,baseRadius:.08,strength:1.15,drop:{width,samplesPerUnit:32,container:{min:[-2,-1,-2],max:[2,3,2]}}}});
 let selected=source('A',.5),runtime=null,hold=null;const edits=[];
 const api={read:()=>({selected,runtime}),edit:(id,settings)=>{edits.push({id,settings});return hold??Promise.resolve();},add(){},release(){},pause(){}};
 const controls=mountAuthoredWaterControls({document,root:{prepend(){}},controls:{installNumberDrag:()=>({stop(){}})},api});
 return {controls,input,edits,select(id,width){selected=source(id,width);controls.refresh();},draftWidth(width){input('[data-width]').value=width;input('[data-width]').listeners.input();},setRuntime(value){runtime=value;},hold(p){hold=p;}};
}
{
 const f=fixture();f.draftWidth(.75);f.select('B',1);assert.equal(Number(f.input('[data-width]').value),1,'Source B must not inherit source A pending amount');await f.input('[data-apply]').onclick();assert.equal(f.edits[0].id,'B');assert.equal(f.edits[0].settings.drop.width,1);
}
{
 const f=fixture();let complete;f.hold(new Promise(r=>complete=r));f.draftWidth(.75);const pending=f.input('[data-apply]').onclick();f.select('B',1);f.draftWidth(1.25);complete();await pending;assert.equal(Number(f.input('[data-width]').value),1.25,'Old action completion must preserve a newer source draft');
 f.setRuntime({paused:true,step:12,particleCount:4096});f.controls.refreshStatus();assert.match(f.input('[data-state]').textContent,/tick 12/);assert.equal(Number(f.input('[data-width]').value),1.25,'Clock refresh must not rewrite draft');
}
console.log('Source drafts retain identity and current playback status does not overwrite pending edits');
