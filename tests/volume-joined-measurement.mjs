// kaminos-test: node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import {createJoinedExterior} from '../volume-joined-exterior.mjs';
import {joinedRouteParams,writeJoinedRoute} from '../volume-joined-route.mjs';

test('exterior receipt distinguishes producer rebuilds, including identical dimensions',()=>{
  const owner=createJoinedExterior({});
  const p={dims:[32,32,32],pitch:2/32,allocation:1};
  owner.prepare(p);const first=owner.receipt().generation;
  assert.ok(Number.isInteger(first),'receipt must identify its resource generation');
  owner.prepare(p);assert.equal(owner.receipt().generation,first);
  owner.prepare({...p,allocation:2});assert.equal(owner.receipt().generation,first+1);
  owner.destroy();
});

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('function wireJoinedProvisionalControls(');
const end=html.indexOf('\nfunction readVolumeControls()',start);
assert.ok(start>=0&&end>start);
const sampled={status:'sampled',iterations:16,budget:32,maxDivergenceError:9e-4,steps:20};
function fixture(){
  const elements=new Map(),timers=[];
  const el=id=>{
    if(!elements.has(id))elements.set(id,{value:'',checked:false,style:{},textContent:'',options:[],listeners:{},addEventListener(type,fn){this.listeners[type]=fn;}});
    return elements.get(id);
  };
  for(const [id,value] of Object.entries({'boundary':'on','exterior-size':'2','exterior-ratio':'32','exterior-wall':'none','exterior-budget':'32'}))el('volume-joined-'+id).value=value;
  const receipt=()=>({admitted:true,generation:1,shape:[32,64,32],ratio:2,cellWidth:.125,cells:97792,steps:20,lastStep:{stepped:true}});
  const state={active:true,simGridDimensions:[32,32,32],joinedBoundary:{admitted:true},joinedGhosts:{bound:true},joinedRendering:{enabled:true},joinedExterior:receipt()};
  const api={debugState:()=>state,setJoinedBoundary(){},setJoinedExterior(config){state.joinedExterior=config?receipt():null;return {receipt:state.joinedExterior};},probeJoinedExterior:async()=>sampled};
  const sandbox={document:{getElementById:el},location:{href:'http://localhost/?volume_joined=1',search:'?volume_joined=1&volume_joined_bounds=0',hash:''},history:{replaceState(){}},URL,URLSearchParams,joinedRouteParams,writeJoinedRoute,requestAnimationFrame(){},setInterval(fn){timers.push(fn);},setTimeout(){},api};
  vm.runInNewContext(html.slice(start,end)+'\nwireJoinedProvisionalControls(api);',sandbox);
  return {el,state,api,measure:()=>el('volume-joined-measure').listeners.click(),tick:()=>timers.forEach(fn=>fn()),text:()=>el('volume-joined-exterior-solve-val').textContent,
    change(id,value){el(id).value=value;el(id).listeners.change();}};
}
for(const [control,value] of [['size','3'],['ratio','24'],['wall','+y'],['budget','64']])test(`changing exterior ${control} invalidates its measured pressure`,async()=>{
  const f=fixture();await f.measure();assert.match(f.text(),/16\/32/);
  f.change('volume-joined-exterior-'+control,value);f.tick();assert.match(f.text(),/not measured/);
  await f.measure();assert.match(f.text(),/16\/32/);
});
for(const rejects of [false,true])test(`late ${rejects?'failure':'sample'} cannot overwrite a replacement's readout`,async()=>{
  const f=fixture();let resolve,reject;f.api.probeJoinedExterior=()=>new Promise((a,b)=>{resolve=a;reject=b;});
  const pending=f.measure();f.change('volume-joined-exterior-wall','+y');
  if(rejects)reject(Error('old owner destroyed'));else resolve(sampled);
  await pending;assert.match(f.text(),/not measured/);assert.doesNotMatch(f.text(),/16\/32|old owner destroyed/);
});
test('producer allocation rebuild invalidates a measurement without a cockpit change event',async()=>{
  const f=fixture();await f.measure();f.state.joinedExterior.generation++;f.tick();assert.match(f.text(),/not measured/);
});
test('in-flight producer rebuild rejects the old sample even before the periodic readout',async()=>{
  const f=fixture();let resolve;f.api.probeJoinedExterior=()=>new Promise(r=>{resolve=r;});const pending=f.measure();
  f.state.joinedExterior.generation++;resolve(sampled);await pending;assert.match(f.text(),/not measured/);
});
test('ordinary simulation steps do not erase an explicit pressure snapshot',async()=>{
  const f=fixture();await f.measure();const before=f.text();f.state.joinedExterior.steps++;f.tick();assert.equal(f.text(),before);
});
