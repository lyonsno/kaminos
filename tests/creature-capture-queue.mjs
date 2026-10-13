// kaminos-test: node
// Actual serialized entry + creature + scoped session; synthetic DOM/loader.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {pathToFileURL} from 'node:url';
import './creature-body-fixture.mjs';
import * as THREE from '../lib/three.core.js';
import {installOwnerExperimentEntry} from '../owner-experiment-entry.mjs';
import {createOwnerSceneSession} from '../owner-scene-session.mjs';
import {withHeldCreatureFrame} from '../experiments/creature-motion/held-capture.mjs';
class Element {
 constructor(){this.children=[];this.isConnected=true;this.style={};this.nodes=new Map();}
 append(...nodes){for(const n of nodes){this.children.push(n);n.parent=this;}}
 replaceChildren(...nodes){for(const n of this.children)n.isConnected=false;this.children=[];this.append(...nodes);}
 querySelector(name){if(!this.nodes.has(name))this.nodes.set(name,new Element());return this.nodes.get(name);}
 setAttribute(){}addEventListener(){}remove(){this.isConnected=false;if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);}
}
globalThis.Option=class extends Element{constructor(label,value){super();this.textContent=label;this.value=value;}};
const document={createElement:()=>new Element()},id='marionette/retained-creature';
for(const boundary of ['hold','restore'])await test(`queued replacement before ${boundary} stays untouched`,async()=>{
 const scene=new THREE.Scene(),unrelated=new THREE.Group();scene.add(unrelated);let next=0;
 const source={source_sha256:'a'.repeat(64),frames:60,fps:30,retargeted:false};
 const host={controls:{document},scene:{open:()=>createOwnerSceneSession({
  async loadAsset(options){const root=new THREE.Group(),bone=new THREE.Object3D();bone.name='pelvis';root.add(bone);root.userData.native_motion=source;scene.add(root);
   const clip=new THREE.AnimationClip('trot',59/30,[new THREE.VectorKeyframeTrack('pelvis.position',[0,59/30],[0,0,0,0,0,1])]);
   return {id:`asset-${++next}`,root,clips:[clip],source:options.metadata.source,owned:true};},
  attach:()=>{},remove:({root})=>scene.remove(root),onFrame:()=>()=>{},redraw:()=>{},readView:()=>({}),setView:()=>{},
 })}};
 const api=await installOwnerExperimentEntry({document,root:new Element(),host,discover:()=>[pathToFileURL(new URL('../experiments/creature-motion/retained.experiment.mjs',import.meta.url).pathname).href]});
 const inputs={asset:'/body.glb',source_sha256:source.source_sha256,frame:15};
 let replacement,reads=0;
 try{
  await api.open(id,inputs);await api.invoke('resume');const original=await api.read();
  const entry={...api,async read(){const state=await api.read();if(++reads===(boundary==='hold'?1:4))replacement=api.open(id,inputs);return state;}};
  const transaction=withHeldCreatureFrame({entry,frame:30,present:async()=>{},capture:async()=>({report:'synthetic-retained-frame'})});
  if(boundary==='hold')await assert.rejects(transaction,/changed/);
  else assert.equal((await transaction).restore.status,'skipped-changed');
  await replacement;const current=await api.read();assert.notEqual(current.rootUuid,original.rootUuid);
  assert.equal(current.status,'paused','old transaction must not resume the queued replacement');
  assert.equal(current.frame,15,'old transaction must not seek/hold the queued replacement');
  assert.equal(scene.children.includes(unrelated),true);
 }finally{await api.close();assert.deepEqual(scene.children,[unrelated]);}
});
