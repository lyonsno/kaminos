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
const {readFileSync}=await import('node:fs'),vm=await import('node:vm');
const application=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const frameStart=application.indexOf('  function renderSceneFrame()'),armStart=application.indexOf('    if (localLiquidHost) {',frameStart),armEnd=application.indexOf('    sceneFrameCount++',armStart),arm=application.slice(armStart,armEnd);
for(const mode of ['continuous','finite_drop','failure']){
 const f=fixture();f.draftWidth(.75);let step=0,present=true;
 const host={render(){if(mode==='failure')throw Error('frame rejected');step=12;},state:()=>({mode,clock:{paused:false,step,timeSeconds:step/240}}),dispose(){present=false;}};
 // Keep the controls' read layer bound to the same current runtime.
 f.setRuntime({paused:false,step:0,particleCount:4096});
 const c={localLiquidHost:host,localLiquidFailure:null,console:{error(){}},String,authoredWaterControls:{refreshStatus(){f.setRuntime(present?{paused:false,step,particleCount:4096}:null);f.controls.refreshStatus();}},sharedWorkbench:{update(){}},refreshLocalLiquidPerformance(){},renderPipeline:{render(){}},setInfo(){}};
 vm.createContext(c);vm.runInContext(arm,c);
 if(mode==='failure'){assert.equal(c.localLiquidHost,null);assert.equal(f.input('[data-pause]').disabled,true,'Host loss disables playback actions');assert.doesNotMatch(f.input('[data-state]').textContent,/Playing/);}
 else assert.match(f.input('[data-state]').textContent,/tick 12/,'Both supported source modes publish the effective clock');
 assert.equal(Number(f.input('[data-width]').value),.75,'Runtime updates preserve drafts');
}
{
 const a=application.indexOf('window.kaminosPauseLocalLiquid = paused => {'),b=application.indexOf('\n};',a),f=fixture();let paused=false;f.setRuntime({paused:false,step:12,particleCount:4096});
 const c={Boolean,window:{_kaminosDirty(){}},localLiquidPaused:false,localLiquidHost:{setPaused(v){paused=v;}},refreshLocalLiquidPerformance(){},authoredWaterControls:{refreshStatus(){f.setRuntime({paused,step:12,particleCount:4096});f.controls.refreshStatus();}}};vm.createContext(c);vm.runInContext(application.slice(a,b+3),c);c.window.kaminosPauseLocalLiquid(true);assert.match(f.input('[data-state]').textContent,/Paused · tick 12/);
}
