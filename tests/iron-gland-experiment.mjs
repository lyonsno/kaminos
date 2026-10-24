// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from '../lib/three.core.js';
import { handObservation, createHoverController } from '../experiments/iron-gland/interaction.mjs';
import { createMechanism } from '../experiments/iron-gland/mechanism.mjs';
import { installOwnerExperimentEntry } from '../owner-experiment-entry.mjs';

// Exercise the actual experiment, substituting only camera, model loading and host I/O.
const source = (await fs.readFile(new URL('../experiments/iron-gland.experiment.mjs', import.meta.url), 'utf8'))
  .replace(/^import .*;$/gm, '').replace('export default', 'return');
const compile = new Function('Mesh', 'PlaneGeometry', 'MeshBasicMaterial', 'CanvasTexture', 'SRGBColorSpace',
  'createBrowserHandMeshRoute', 'readLocalModels', 'readServedModels', 'createModelStore',
  'handObservation', 'createHoverController', 'createMechanism', source);
const flush = () => new Promise(resolve => setImmediate(resolve));
const result = pinch => {
  const uv = new Float32Array(42).fill(.5);
  for (const [i, x, y] of [[0,.5,.8],[5,.3,.5],[9,.5,.4],[17,.7,.5],[4,.4,.25],[8,.4+pinch*.4,.25]]) { uv[2*i]=x; uv[2*i+1]=y; }
  return { hasHand:true, handedness:'right', cropUV:uv, cropBox:[100,40,300,240], acquisition:{fallback:false} };
};
async function fixture() {
  const tracks = [];
  let modelData={},sessionData={},releases=0,routeCreations=0;
  class Track extends EventTarget {
    readyState = 'live'; listeners = new Set();
    addEventListener(type, listener, options) { if(type==='ended')this.listeners.add(listener); super.addEventListener(type,listener,options); }
    removeEventListener(type, listener, options) { this.listeners.delete(listener); super.removeEventListener(type,listener,options); }
    stop() { this.readyState='ended'; }
    end() { this.stop(); this.dispatchEvent(new Event('ended')); }
  }
  const makeStream = () => {const t=new Track();tracks.push(t);return {getTracks:()=>[t],getVideoTracks:()=>[t]};};
  const video = { videoWidth:640, videoHeight:480, play:async()=>{},
    requestVideoFrameCallback(fn) { this.callback=fn; return 1; }, cancelVideoFrameCallback() { this.callback=null; } };
  const window = Object.assign(new EventTarget(), {innerWidth:1440,innerHeight:1000,indexedDB:{},
    navigator:{mediaDevices:{getUserMedia:async()=>makeStream()}},
    kaminosAppGpu:async()=>({session:async()=>sessionData})});
  const document = {defaultView:window,getElementById:()=>null,createElement:tag=>{
    if(tag==='video')return video;
    if(tag==='canvas')return {width:0,height:0,getContext:()=>({drawImage(){},setTransform(){},resetTransform(){}})};
    throw Error(`unexpected element ${tag}`);
  }};
  let pending = result(.6), frameCallback, disposed=0;
  const route = {identity:{routeId:'unit-fixture'},infer:()=>Promise.resolve(pending),release(){releases++;}};
  const definition = compile(THREE.Mesh,THREE.PlaneGeometry,THREE.MeshBasicMaterial,THREE.CanvasTexture,THREE.SRGBColorSpace,
    async()=>{routeCreations++;return route;},async()=>({}),async()=>({}),()=>({get:async()=>modelData}),handObservation,createHoverController,createMechanism);
  const attached=[],events=[];
  const scene = {attach:async(root,options)=>{attached.push({root,options});return {id:root.uuid,root};},
    setView:()=>{},redraw(){},onFrame:fn=>{frameCallback=fn;return()=>{frameCallback=null;};},dispose:async()=>{disposed++;}};
  const owner = await definition.create({host:{controls:{document},scene:{open:async()=>scene}},inputs:{},record:e=>events.push(e)});
  await owner.operations.loadModels();
  return {owner,tracks,attached,events,video,
    makeStream,setCameraRequest:value=>{window.navigator.mediaDevices.getUserMedia=value;},
    setModelData:value=>{modelData=value;},setSessionData:value=>{sessionData=value;},
    get releases(){return releases;},get routeCreations(){return routeCreations;},
    async frame(value) { await flush();pending=value;const cb=video.callback;video.callback=null;assert.ok(cb,'frame scheduled');cb();await flush(); },
    tick() { frameCallback?.({timestampMs:1000}); }, get disposed(){return disposed;}};
}

// Use the real serialized Workbench entry; only discovery's fixture and DOM are substituted.
async function workbenchEntry(owner) {
  const oldOption=globalThis.Option, oldOwner=globalThis.__ironGlandEntryFixture;
  globalThis.Option=class {constructor(text,value){this.text=text;this.value=value;}};
  globalThis.__ironGlandEntryFixture={read:owner.read,operations:owner.operations,dispose:()=>owner.dispose()};
  try {
    const nodes=new Map(), section={querySelector:key=>{
      if(!nodes.has(key))nodes.set(key,{value:'',textContent:'',addEventListener(){},replaceChildren(){}});
      return nodes.get(key);
    }};
    const definition='data:text/javascript,'+encodeURIComponent("export default {id:'iron-gland',title:'Iron Gland',create(){return globalThis.__ironGlandEntryFixture;}}");
    const entry=await installOwnerExperimentEntry({document:{createElement:()=>section},root:{append(){}},host:{},discover:async()=>[definition]});
    await entry.open('iron-gland');return entry;
  } finally {globalThis.Option=oldOption;globalThis.__ironGlandEntryFixture=oldOwner;}
}

for(const action of ['stop','close'])test(`Workbench ${action} completes while camera permission remains unresolved`, async()=>{
  const f=await fixture();let grant,starting,ending,entry,completed=false;
  const grantCamera=()=>{if(grant){const resolve=grant;grant=null;resolve(f.makeStream());}};
  try {
    f.setCameraRequest(()=>new Promise(resolve=>{grant=resolve;}));
    entry=await workbenchEntry(f.owner);
    starting=entry.invoke('start');await flush();
    assert.equal(f.owner.read().starting,true);assert.equal(f.tracks.length,0);
    ending=(action==='close'?entry.close():entry.invoke('stop')).then(()=>{completed=true;});
    await flush();
    assert.equal(completed,true,`${action} must not wait for a human permission decision`);
    assert.equal(f.owner.read().starting,false);
    if(action==='close')assert.equal(f.disposed,1);
    grantCamera();await starting;await flush();
    assert.ok(f.tracks.every(track=>track.readyState==='ended'),'every late camera track must stop');
    assert.equal(f.owner.read().running,false);assert.equal(f.owner.read().cameraVisible,false);
    assert.equal(f.attached.find(a=>!a.options.presentation).root.visible,false);
  } finally {
    grantCamera();await starting;await ending;
    if(entry)await entry.close();else await f.owner.dispose();
  }
});

test('asynchronous camera denial remains visible after Start acknowledges initiation', async()=>{
  const f=await fixture();let deny;
  try {
    f.setCameraRequest(()=>new Promise((resolve,reject)=>{deny=reject;}));
    const started=f.owner.operations.start();
    assert.equal(started.starting,true,'Start acknowledges initiation rather than waiting on permission');
    deny(Error('camera permission denied'));await flush();
    assert.equal(f.owner.read().starting,false);assert.equal(f.owner.read().running,false);
    assert.equal(f.owner.read().cameraVisible,false);assert.match(f.owner.read().error,/permission denied/);
  } finally {deny?.(Error('camera permission denied'));await f.owner.dispose();}
});

test('camera background cannot depth-clip the closed, open or rotated mechanism', async () => {
  const f=await fixture();
  try {
    const plane=f.attached.find(a=>a.options.presentation).root;
    const mechanism=f.attached.find(a=>!a.options.presentation).root;
    assert.equal(plane.material.depthWrite,false,'camera pixels must not occlude the hovering object');
    assert.equal(plane.material.depthTest,false);
    assert.ok(plane.renderOrder<mechanism.renderOrder,'background draws before opaque mechanism');
    await f.owner.operations.start();
    await f.frame(result(.6)); await f.frame(result(.2));
    const box=new THREE.Box3().setFromObject(mechanism);
    assert.ok(box.min.z<plane.position.z,'fixture actually exercises geometry behind the camera plane');
  } finally { await f.owner.dispose(); }
});

test('model replacement is rejected while stopped inference drains, then succeeds', async () => {
  const f=await fixture();let complete,stopping;
  try {
    await f.owner.operations.start();await f.frame(new Promise(resolve=>{complete=resolve;}));
    stopping=f.owner.operations.stop();
    await assert.rejects(async()=>f.owner.operations.loadModels(),/inference.*finish|drain/i);
    assert.equal(f.releases,0,'active inference still owns the route resources');
    complete(result(.6));await stopping;
    await f.owner.operations.loadModels();
    assert.equal(f.releases,1);assert.equal(f.routeCreations,2);
  } finally {complete?.(result(.6));await stopping;await f.owner.dispose();}
});

test('Start cannot overlap an asynchronous model replacement', async () => {
  const f=await fixture();let complete,loading;
  try {
    f.setModelData(new Promise(resolve=>{complete=resolve;}));
    loading=f.owner.operations.loadModels();
    assert.throws(()=>f.owner.operations.start(),/model.*load|loading/i);
    assert.equal(f.tracks.length,0);
    complete({});await loading;
    await f.owner.operations.start();assert.equal(f.tracks.length,1);
  } finally {complete?.({});await loading;await f.owner.dispose();}
});

test('disposal during asynchronous session acquisition never creates a new route', async () => {
  const f=await fixture();let complete,loading,disposing;
  try {
    f.setSessionData(new Promise(resolve=>{complete=resolve;}));
    loading=f.owner.operations.loadModels();await flush();
    disposing=f.owner.dispose();complete({});await loading;await disposing;
    assert.equal(f.routeCreations,1,'disposed consumer must not allocate another model route');
    assert.equal(f.releases,1);
  } finally {complete?.({});await loading;if(disposing)await disposing;else await f.owner.dispose();}
});

test('external camera end hides a held pinch and rejects its late inference', async () => {
  const f=await fixture();
  let complete;
  try {
    await f.owner.operations.start();await f.frame(result(.6));await f.frame(result(.2));
    assert.equal(f.owner.read().interaction.mode,'grab');
    const pending=new Promise(resolve=>{complete=resolve;});
    await f.frame(pending);
    const track=f.tracks.at(-1);track.end();f.tick();
    const ended=f.owner.read();
    assert.equal(ended.running,false,'an ended source must not remain live');
    assert.equal(ended.cameraVisible,false);assert.equal(ended.interaction.visible,false);
    assert.match(ended.error,/camera.*(ended|disconnected)/i);
    assert.equal(track.listeners.size,0,'stop detaches owned track listeners');
    complete(result(.2));await flush();f.tick();
    assert.equal(f.owner.read().interaction.visible,false,'late inference must not restore the hand');
    assert.equal(f.attached.find(a=>!a.options.presentation).root.visible,false);
    await f.owner.operations.start();await f.frame(result(.6));
    assert.equal(f.owner.read().error,null);
    track.dispatchEvent(new Event('ended'));
    assert.equal(f.owner.read().running,true,'old stream cannot stop the replacement');
  } finally { complete?.(result(.2));await f.owner.dispose(); }
  assert.ok(f.tracks.every(t=>t.readyState==='ended'&&t.listeners.size===0));
  assert.equal(f.disposed,1);
});
