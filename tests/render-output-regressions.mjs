// kaminos-test: node
import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
import {installRenderOutput} from '../render-output-ui.mjs';
import {captureStill} from '../render-output.mjs';
import SceneGIHistory from '../scene-gi-history.mjs';
const source=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
function heldFixture(){
 const at=source.indexOf('    async holdPresentationForStill('),end=source.indexOf('    setCapturePaused(',at);
 const start=source.indexOf('  function render(now) {'),stop=source.indexOf('\n  function invalidateRaymarchReadouts(',start);
 let admitted,complete;
 const calls=[];const queue={},device={queue,limits:{maxTextureDimension2D:8192}},scope={deviceRetired:false,state:{active:true,width:320,height:240,frameCount:0,simStepCount:0},device,productFrameOwner:'prototype',boundarySplatRequested:()=>false,browserResidualCanApply:()=>false,canvasPresentationSuppressed:false,sceneTransportConsumer:null,sceneLightingRebuildPending:false,exactCapturePause:null,capturePaused:false,stillPresentationHeld:false,controlsSnapshot:{renderScale:1,raySteps:160},cancelAnimationFrame(){},requestAnimationFrame(){calls.push('scheduled');return 1;},raf:0,foregroundPending:null,foregroundSequence:0,foregroundDrain:Promise.resolve(),performance:{now:()=>100},canvas:{classList:{remove(){calls.push('removed');}}},emitStatus:s=>calls.push(s),resize(){},sampleFrame:async()=>({ok:true,image:{width:320,height:240,rgba:[]}})};
 scope.foregroundRequester=request=>{admitted=request;return {completion:new Promise(resolve=>{complete=resolve;})};};
 scope.renderOrdinaryFrame=()=>{if(scope.capturePaused)return;scope.state.frameCount++;scope.state.simStepCount++;return {status:'submitted'};};
 scope.state.ordinaryForeground={completedFrames:0};vm.createContext(scope);vm.runInContext(source.slice(start,stop)+'\nglobalThis.hold=({'+source.slice(at,end)+'}).holdPresentationForStill;',scope);
 return {scope,calls,async queue(){scope.render(0);await Promise.resolve();return ()=>{const result=admitted.run({device,queue,submit(){}});complete({status:'completed',result});};}};
}
test('capture acquisition lets an admitted foreground frame finish and blocks new work until release',async()=>{
 const f=heldFixture(),finish=await f.queue(),pending=f.scope.hold();
 finish();const hold=await pending;assert.equal(f.scope.state.active,true);assert.equal(f.scope.state.ordinaryForeground.completedFrames,1);
 const step=f.scope.state.simStepCount;f.scope.render(1);await Promise.resolve();assert.equal(f.scope.state.simStepCount,step);
 await hold.draw();assert.equal(f.scope.state.simStepCount,step);hold.release();assert.equal(f.scope.capturePaused,false);assert.ok(f.calls.includes('scheduled'));assert.ok(!f.calls.includes('removed'));
});
test('cancellation during foreground acquisition releases a live unpaused renderer',async()=>{
 const f=heldFixture(),finish=await f.queue(),abort=new AbortController();
 const capture=captureStill({async begin({signal}){const held=await f.scope.hold();try{signal.throwIfAborted();return {draw:held.draw,capture:()=>({dataUrl:'data:image/png;base64,AAAA',width:320,height:240}),release:held.release};}catch(error){held.release();throw error;}}});
 const pending=capture({width:320,height:240},{signal:abort.signal});abort.abort();finish();await assert.rejects(pending,error=>error.name==='AbortError');
 assert.equal(f.scope.state.active,true);assert.equal(f.scope.capturePaused,false);assert.equal(f.scope.state.error,undefined);assert.ok(f.calls.includes('scheduled'));
});

function uiFixture(){
 const nodes=new Map();class Element{
  constructor(tag){this.tagName=tag.toUpperCase();this.options=[];this.dataset={};this.style={};this.value='';this.open=false;this.isConnected=true;}
  set innerHTML(text){for(const match of text.matchAll(/<(input|select|button|a|p|h2)[^>]*\bid="([^"]+)"/g)){const child=new Element(match[1]);child.id=match[2];nodes.set(child.id,child);}nodes.set('form',new Element('form'));nodes.set('close',new Element('button'));}
  append(){}after(){}addEventListener(){}setAttribute(){}focus(){}click(){}reportValidity(){return true;}showModal(){this.open=true;}close(){this.open=false;}
  add(option){this.options.push(option);}replaceChildren(...options){this.options=options;this.value=options[0]?.value??'';}
  get valueAsNumber(){return this.value===''?NaN:Number(this.value);}
  querySelector(selector){return nodes.get(selector==='form'?'form':selector==='[data-action=close]'?'close':selector.replace('#',''));}querySelectorAll(){return [...nodes.values()].filter(n=>['INPUT','SELECT'].includes(n.tagName));}
 }
 const document={createElement:tag=>new Element(tag),getElementById:id=>{if(!nodes.has(id))nodes.set(id,new Element('button'));return nodes.get(id);},head:{append(){}},body:{append(){}},defaultView:{addEventListener(){}}};
 const item={id:'portrait',name:'Portrait',settings:{cameraId:null,width:600,height:900,percentage:50,quality:'full',filename:'portrait.png'}},saves=[];
 const previous=globalThis.Option;globalThis.Option=class{constructor(text,value){Object.assign(this,{text,value});}};
 const ui=installRenderOutput({document,cameras:()=>[],profiles:{load:async()=>({items:[structuredClone(item)]}),save:async(name,settings,id)=>{saves.push({name,settings,id});return {items:[{...item,name,settings}]};}},capture:async settings=>({width:20,height:10,dataUrl:'data:image/png;base64,AAAA',settings})});
 return {ui,nodes,item,saves,restore(){globalThis.Option=previous;}};
}
test('selected preset survives close/reopen/save, including a different previous capture',async()=>{
 const f=uiFixture();try{
  await f.ui.open();f.nodes.get('output-width').value='200';await f.nodes.get('form').onsubmit({preventDefault(){},target:{reportValidity:()=>true}});
  f.nodes.get('output-preset').value=f.item.id;f.nodes.get('output-preset').onchange();f.ui.close();await f.ui.open();
  assert.equal(f.nodes.get('output-preset').value,'portrait');assert.deepEqual(f.ui.read(),f.item.settings);
  await f.nodes.get('output-save-preset').onclick();assert.deepEqual(f.saves[0],{name:'Portrait',settings:f.item.settings,id:'portrait'});
 }finally{f.restore();}
});

for(const outcome of ['success','failure','cancel'])test(`host-composed still keeps source state and restores presentation after ${outcome}`,async()=>{
 const f=heldFixture(),consumer=()=>{};f.scope.sceneTransportConsumer=consumer;
 const controls=f.scope.controlsSnapshot,requests=[];
 f.scope.sampleFrame=async options=>{requests.push(options);assert.equal(options.advanceSim,false);if(outcome==='failure')throw Error('capture GPU failed');return {ok:true};};
 const abort=new AbortController();
 const capture=captureStill({async begin(){const held=await f.scope.hold({raySteps:8});return {...held,async draw(){const frame=await held.draw();assert.equal(frame.receipt.presentation,'host-composed');assert.equal(frame.image,undefined);if(outcome==='cancel')abort.abort();},capture:()=>({dataUrl:'data:image/png;base64,AAAA',width:320,height:240})};}});
 const result=capture({width:320,height:240},{signal:abort.signal});
 if(outcome==='success')await result;else await assert.rejects(result,outcome==='cancel'?{name:'AbortError'}:/capture GPU failed/);
 assert.equal(requests.length,1);assert.equal(requests[0].includeRgba,false);
 assert.equal(f.scope.sceneTransportConsumer,consumer);assert.equal(f.scope.state.simStepCount,0);
 assert.equal(f.scope.controlsSnapshot,controls);assert.equal(f.scope.capturePaused,false);assert.equal(f.scope.stillPresentationHeld,false);assert.equal(f.scope.state.active,true);
});

// Execute the actual page output owner: it must request the composed frame
// during GI refinement and never overlay the stale private flame canvas.
for(const asynchronous of [false,true])test(`page still output captures presented host pixels after ${asynchronous?'asynchronous refinement':'responsive history'}`,async()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const start=html.indexOf('  const renderOutput=captureStill('),end=html.indexOf('  const viewportRecording=',start);
 const f=heldFixture(),released=[];let ratio=2,frames=0,canvasCurrent=false;
 const history=Object.assign(Object.create(SceneGIHistory.prototype),{refine:asynchronous,converged:false,checkFailure:null,pendingFrames:2});
 const ctx={captureStill,recordingExtent:null,vantageBusy:()=>null,sceneDocument:{state:()=>({})},workingScene:{objects:[]},sceneCameras:{read:()=>({cameras:[]})},activeSceneComposition:{},isSceneItemVisible:()=>true,isFireLightFieldRoute:()=>true,viewportDisplay:{fire:'full'},camera:{aspect:1,zoom:1,updateProjectionMatrix(){}},readAuthoredCameraView:()=>({}),writeAuthoredCameraView(){},viewProjection:{state:()=>({orthographic:false}),setOrthographic(){}},controls:{enabled:true},holdViewportForVantage:()=>()=>released.push('viewport'),suspendEditorDrawingForVantage:()=>()=>released.push('drawing'),window:{__kaminosBeginSceneInspection:()=>()=>released.push('inspection')},outputCaptureExtent:null,outputCaptureFrame:null,manualInspectionRender:false,sceneFrameCount:0,syncViewportRendererSize(){},markDirty(){},sceneGI:{resetHistory(){},needsHistoryFrame:()=>history.needsFrame(),debugState:()=>({})},fireLightFieldPass:null,transportPrototype:{},frameComposition:{transportFrame:{}},waterFeature:{host:{state:()=>({})}},requestAnimationFrame:fn=>fn(),document:{},renderer:{backend:{device:{limits:{maxTextureDimension2D:4096}}},getPixelRatio:()=>ratio,setPixelRatio:v=>ratio=v,domElement:{id:'host'}},renderSceneFrame(){throw Error('scene draw outside held source frame');},captureComposedCanvases({host,volumeRaster}){assert.ok(canvasCurrent,'canvas must be copied in its presenting task');assert.equal(host.id,'host');assert.equal(volumeRaster,null);return {image:'data:image/png;base64,AAAA',width:320,height:240,layers:['host']};}};
 f.scope.sceneTransportConsumer=()=>{};
 f.scope.sampleFrame=async()=>{frames++;ctx.sceneFrameCount++;history.pendingFrames--;canvasCurrent=true;ctx.outputCaptureFrame?.();await Promise.resolve();canvasCurrent=false;if(asynchronous&&frames>=2)history.converged=true;return {ok:true};};
 ctx.volumePrototype={holdPresentationForStill:options=>f.scope.hold(options)};
 vm.runInNewContext(html.slice(start,end)+'\nglobalThis.capture=renderOutput;',ctx);
 const result=await ctx.capture({width:320,height:240});
 assert.equal(frames,asynchronous?3:2);assert.equal(result.rendering.fire.presentation,'host-composed');
 assert.equal(ctx.outputCaptureExtent,null);assert.equal(ctx.outputCaptureFrame,null);assert.equal(ctx.controls.enabled,true);assert.equal(ratio,2);
 assert.deepEqual(released,['drawing','inspection','viewport']);assert.equal(f.scope.stillPresentationHeld,false);
});
