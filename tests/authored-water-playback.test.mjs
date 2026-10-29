// kaminos-test: node
import assert from 'node:assert/strict';
import {mountAuthoredWaterControls} from '../authored-water-controls.mjs';
function fixture({sourceRoot=null,simulationRoot=null}={}){
 const nodes=new Map(),numbers=[],boundInputs=[];
 const input=selector=>{if(!nodes.has(selector)){const node={value:'',checked:false,dataset:{},classList:{add(){}},listeners:{},addEventListener(k,fn){this.listeners[k]=fn;}};nodes.set(selector,node);}return nodes.get(selector);};
 for(const name of ['width','samples','rate','radius','strength','passes','target'])numbers.push(input('[data-'+name+']'));
 const section={querySelector:input,querySelectorAll(selector){if(selector==='label')return [];if(selector==='input[type=number]')return [...numbers,...boundInputs];if(selector==='[data-bound]')return boundInputs;const kind=selector.match(/data-bound=(min|max)/)?.[1];return boundInputs.filter(n=>n.dataset.bound===kind);},remove(){}};
 input('[data-bounds]').append=row=>boundInputs.push(...row.children);
 input('[data-simulation]').querySelectorAll=section.querySelectorAll.bind(section);
 const document={createElement(tag){if(tag==='section')return section;return {type:'',dataset:{},children:[],classList:{add(){}},listeners:{},setAttribute(){},addEventListener(k,fn){this.listeners[k]=fn;},append(child){this.children.push(child);}};}};
 const source=(id,width)=>({id,label:id,settings:{mode:'finite_drop',rate:1200,baseRadius:.08,strength:1.15,drop:{width,samplesPerUnit:32,container:{min:[-2,-1,-2],max:[2,3,2]}}}});
 let selected=source('A',.5),runtime=null,hold=null,simulation=null;const edits=[];
 const api={read:()=>({selected,runtime,simulation}),edit:(id,settings)=>{edits.push({id,settings});return hold??Promise.resolve();},add(){},release(){},pause(){}};
 const controls=mountAuthoredWaterControls({schedule:()=>1,cancel(){},document,root:{prepend(){}},sourceRoot,simulationRoot,controls:{installNumberDrag:()=>({stop(){}})},api});
 return {controls,input,edits,api,select(id,width){selected=source(id,width);controls.refresh();},draftWidth(width){input('[data-width]').value=width;input('[data-width]').listeners.input();},setRuntime(value){runtime=value;},setSimulation(value){simulation=value;controls.refresh();},hold(p){hold=p;}};
}
{
 const f=fixture();let reset=0,replay=0,toggled=0;f.api.reset=()=>reset++;f.api.release=()=>replay++;f.api.pause=()=>toggled++;
 assert.equal(typeof f.input('[data-reset]').onclick,'function','Reset must have its own action');
 await f.input('[data-reset]').onclick();assert.equal(reset,1);assert.equal(replay,0);
 await f.input('[data-pause]').onclick();assert.equal(replay,1,'Play starts initial water');assert.equal(toggled,0);
 f.setRuntime({paused:false,step:12,particleCount:4096});f.controls.refreshStatus();await f.input('[data-pause]').onclick();assert.equal(toggled,1,'Pause preserves the live allocation');assert.equal(replay,1);
 await f.input('[data-release]').onclick();assert.equal(replay,2,'Replay always starts over');
 assert.equal(f.input('[data-release]').textContent,'Replay');
 f.setRuntime(null);f.controls.refreshStatus();assert.equal(f.input('[data-pause]').textContent,'Play');
}
console.log('Three distinct Water actions preserve Reset, Replay, and Play/Pause semantics');

{
 const f=fixture();let reject;f.api.release=()=>new Promise((_,r)=>reject=r);f.api.reset=()=>{};const pending=f.input('[data-release]').onclick();await Promise.resolve();await Promise.resolve();await Promise.resolve();await f.input('[data-reset]').onclick();reject(Error('Superseded release'));await pending;assert.equal(f.input('[data-run-error]').textContent,'','A completed Reset must not show the obsolete Replay error');
}
const {authoredDropSetup}=await import('../authored-water-host.mjs');
{
 const sources=['A','B'].map((id,i)=>({id,transform:{position:[i*.8,1,0],rotation:[0,0,0],scale:[1,1,1]},localLiquidEmitter:{mode:'finite_drop',drop:{width:.5,samplesPerUnit:16}}}));
 const setup=authoredDropSetup(sources,{densityIterations:3});assert.equal(setup.solver.particleCount,1024);assert.deepEqual(setup.sourceIds,['A','B']);assert.equal(setup.route,'kaminos/mls-mpm-finger-juice-v1','Both sources share the rebuilt engine');
}

{
 const f=fixture();let fitted=0;f.api.fitBounds=()=>{fitted++;};
 f.setSimulation({present:true,sourceCount:2,compatibility:{compatible:false,sourceCount:2,message:'Water drop 2 extends outside the box.'},boundsFit:{changed:true,bounds:{min:[-2,-1,-2],max:[2.1,3,2]}}});
 assert.equal(f.input('[data-pause]').disabled,true);
 assert.match(f.input('[data-play-blocked]').textContent,/Water drop 2 extends outside/,'The disabled Play button must explain its blocker beside the button');
 assert.equal(f.input('[data-fit-bounds]').hidden,false);await f.input('[data-fit-bounds]').onclick();assert.equal(fitted,1);
 f.setSimulation({present:true,sourceCount:2,compatibility:{compatible:true,sourceCount:2},boundsFit:{changed:false}});
 assert.equal(f.input('[data-play-blocked]').textContent,'');assert.equal(f.input('[data-pause]').disabled,false);assert.equal(f.input('[data-fit-bounds]').hidden,true);
}
