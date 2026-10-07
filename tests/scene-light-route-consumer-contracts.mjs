import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const refresh=html.slice(html.indexOf('function refreshRenderingControls()'),html.indexOf('let ordinarySceneDepthProvider'));
const counts=html.slice(html.indexOf('let previousAngularCount='),html.indexOf("document.getElementById('rendering-angular-samples').addEventListener"));
const initStart=html.indexOf("for(const [key,id]of [['rendering_angular_pattern'");
const init=html.slice(initStart,html.indexOf("document.getElementById('rendering-shared-gain-value').textContent = `${renderingGainStops",initStart));
assert(refresh&&counts&&init,'actual route/consumer functions must be located');
function run(requested){
 const nodes=new Map(),calls=[];
 const node=id=>{if(!nodes.has(id))nodes.set(id,{value:id==='rendering-angular-samples'?'24':id==='rendering-angular-pattern'?'fixed':'0',checked:false,disabled:true,style:{},dataset:{},options:id==='rendering-angular-samples'?[8,10,12,16,24,48,96].map(value=>({value:String(value)})):['fixed','spatial','source','guided'].map(value=>({value}))});return nodes.get(id);};
 const context=vm.createContext({URLSearchParams,document:{getElementById:node,querySelector:node},window:{},renderingMode:'shared',renderingGainStops:0,renderingSourcePosition:null,fireLightFieldPass:null,sceneGISettings:{mode:'combined',view:'scene'},fireLightFieldRouteParams:()=>new URLSearchParams('volume_light_field_shared_source=1'),renderingChannelsForMode:()=>({shared:true,flameField:false}),renderingUrlState:new URLSearchParams(requested===null?'':`rendering_angular_pattern=guided&rendering_directions=${requested}&rendering_match_camera=1`)});
 vm.runInContext(refresh+counts+init,context);
 // Seat the real consumer only after route initialization, as the browser does.
 let effective=24,pattern='fixed';const source={debugState:()=>({identity:'distributed-volume-direct-radiance-v0',directions:effective,status:'mounted'}),setDirections:n=>{calls.push(n);effective=n;},setAngularPattern:p=>{pattern=p;}};
 for(const name of ['setGain','setSurfaceGain','setSurfaceScattering','setSmokeMode','setSourceSoftness','setSurfaceReconstruction','setReceiverSpacing','setRetainComparisons'])source[name]=()=>{};
 context.window.__kaminosSceneRadiance=source;vm.runInContext('refreshRenderingControls()',context);
 const wanted=requested??24;assert.equal(effective,wanted,'URL count must reach the mounted gather before manual interaction');
 assert.equal(vm.runInContext('currentAngularCount',context),wanted,'count-swap baseline must match the mounted initial count');
 assert.equal(vm.runInContext('previousAngularCount',context),null,'unvisited default must not become an A/B history entry');
 if(requested!==null)assert.equal(pattern,'guided');
 vm.runInContext('selectAngularCount(16)',context);assert.equal(effective,16);assert.equal(vm.runInContext('previousAngularCount',context),wanted);
 assert(calls.length);return context;
}
for(const count of [8,12,96,null])run(count);
assert.throws(()=>run(5),/unsupported requested/);
const witness=readFileSync(new URL('../scratch/beaming-source-guide-witness.mjs',import.meta.url),'utf8');
const selection=witness.match(/const canvas=page\.locator\([^;]+?rect=await canvas\.boundingBox\(\);/)[0];
const hostId=html.match(/renderer\.domElement\.id = '([^']+)'/)[1],firstCanvas=html.match(/<canvas id="([^"]+)"/)[1];
let selectedId;
const page={locator(selector){selectedId=selector==='canvas'?firstCanvas:selector.replace(/^#/,'');const locator={first(){return locator;},async boundingBox(){return {x:0,y:0,width:100,height:100};}};return locator;}};
await vm.runInNewContext(`(async()=>{${selection}})()`,{page});
assert.equal(selectedId,hostId,'inspection must select the actual host renderer, not the first diagnostic canvas');
console.log('URL sampling count reaches consumer before interaction and seats accurate swap history');
