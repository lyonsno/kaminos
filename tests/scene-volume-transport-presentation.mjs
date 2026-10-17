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
for(const unregister of ['depth','water','request','hidden-water','hidden-fire']) {
  const canvas={style:{visibility:''}},registry=createProxySnapshotRegistry();
  let consumer=null;
  const prototype={isActive:()=>true,canvasElement:()=>canvas,setSceneTransportConsumer(fn){consumer=fn;},
    getResidualFieldGeneration:()=>1,setResidualPartialsConsumer:()=>true,
    setCanvasPresentationSuppressed:value=>value,setProxyPacing:value=>value};
  const proxy=createFireProxySync({registry,readDomain:()=>({translation:[0,0,0],scale:1}),
    createLayer:()=>({setSnapshot(){},dispose(){},clear(){},state:()=>({}),group:{visible:true}})});
  registry.publish('fire',{fieldGeneration:1,count:0});
  const context={volumePrototype:prototype,localLiquidHost:{presentation:'full'},viewportDisplay:{fire:'full'},
    hidden:new Set(),isSceneItemVisible:id=>!context.hidden.has(id),syncWaterProxy(){},
    ordinaryDepthEnabled:true,requested:true,transportPrototype:null,transportCanvasVisibility:'',
    authoredWaterFlameTransportActive:false,consumeSceneTransportFrame(){},fireProxySync:proxy};
  context.fireLightFieldRouteParams=()=>new URLSearchParams({volume_light_field_water_transport:context.requested?'1':'0'});
  context.syncFireProxy=()=>proxy.sync({prototype,visible:context.isSceneItemVisible('flame-field'),display:context.viewportDisplay.fire==='proxy',required:false,
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
  if(unregister==='hidden-water')context.hidden.add('water-field');
  if(unregister==='hidden-fire'){
    context.hidden.add('flame-field');
    context.syncFireProxy(); // A separate scene draw can reconcile visibility first.
  }
  frame();
  assert.equal(consumer,null);assert.equal(proxy.effective(),false);
  assert.equal(canvas.style.visibility,unregister==='hidden-fire'?'hidden':'','ordinary native flame must obey current visibility after transport unregistration');
  if(unregister==='hidden-fire'){
    context.hidden.clear();frame();assert.ok(consumer);assert.equal(canvas.style.visibility,'hidden');
    context.ordinaryDepthEnabled=false;frame();assert.equal(canvas.style.visibility,'');
  }
}
console.log('native transport / fire proxy presentation ownership passed');
