// kaminos-test: node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createFireProxySync} from '../fire-proxy-sync.mjs';
import {createProxySnapshotRegistry} from '../proxy-snapshot.mjs';

const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=source.indexOf('  function syncAuthoredWaterFlameTransport()');
const end=source.indexOf('  window.kaminosWaterFlameRenderingState=',start);
assert.ok(start>0&&end>start);
for(const unregister of ['depth','water','request']) {
  const canvas={style:{visibility:''}},registry=createProxySnapshotRegistry();
  let consumer=null;
  const prototype={isActive:()=>true,canvasElement:()=>canvas,setSceneTransportConsumer(fn){consumer=fn;},
    getResidualFieldGeneration:()=>1,setResidualPartialsConsumer:()=>true,
    setCanvasPresentationSuppressed:value=>value,setProxyPacing:value=>value};
  const proxy=createFireProxySync({registry,readDomain:()=>({translation:[0,0,0],scale:1}),
    createLayer:()=>({setSnapshot(){},dispose(){},clear(){},state:()=>({}),group:{visible:true}})});
  registry.publish('fire',{fieldGeneration:1,count:0});
  const context={volumePrototype:prototype,localLiquidHost:{presentation:'full'},viewportDisplay:{fire:'full'},
    ordinaryDepthEnabled:true,requested:true,transportPrototype:null,transportCanvasVisibility:'',
    authoredWaterFlameTransportActive:false,consumeSceneTransportFrame(){},fireProxySync:proxy};
  context.fireLightFieldRouteParams=()=>new URLSearchParams({volume_light_field_water_transport:context.requested?'1':'0'});
  context.syncFireProxy=()=>proxy.sync({prototype,display:context.viewportDisplay.fire==='proxy',required:false,
    camera:{layers:{enable(){},disable(){}}},layerId:4,canvas});
  runInNewContext(source.slice(start,end),context);
  const frame=()=>{context.syncAuthoredWaterFlameTransport();context.syncFireProxy();};
  frame();assert.ok(consumer);assert.equal(canvas.style.visibility,'hidden');
  context.viewportDisplay.fire='proxy';frame();assert.equal(consumer,null);assert.equal(proxy.effective(),true);
  context.viewportDisplay.fire='full';frame();
  assert.ok(consumer);assert.equal(proxy.effective(),false);
  assert.equal(canvas.style.visibility,'hidden','proxy release must preserve active transport hiding in the same frame');
  frame();
  if(unregister==='depth')context.ordinaryDepthEnabled=false;
  if(unregister==='water')context.localLiquidHost.presentation='proxy';
  if(unregister==='request')context.requested=false;
  frame();
  assert.equal(consumer,null);assert.equal(proxy.effective(),false);
  assert.equal(canvas.style.visibility,'','ordinary native flame must return after transport unregistration');
}
console.log('native transport / fire proxy presentation ownership passed');
