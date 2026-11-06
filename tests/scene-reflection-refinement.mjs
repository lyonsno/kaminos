// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene,PerspectiveCamera,StandardNodeLibrary,TSL} from '../lib/three.webgpu.js';
import {registerHooks} from 'node:module';
// Match the application's import map for the bundled production Three build.
registerHooks({resolve(specifier,context,next){
 const local={'three/webgpu':'../lib/three.webgpu.js','three/tsl':'../lib/three.tsl.js'}[specifier];
 return local?{url:new URL(local,import.meta.url).href,shortCircuit:true}:next(specifier,context);
}});
const {createSceneGI}=await import('../scene-gi.mjs');

test('the actual host lighting contract keeps temporal SSR drawing with GI off',()=>{
 const renderer={library:new StandardNodeLibrary()},gi=createSceneGI(new Scene(),new PerspectiveCamera(),TSL.uniform(0),{renderer,reflections:{enabled:true}});
 try{
  gi.setSettings({mode:'gtao'});gi.requestHistoryFrames();
  assert.equal(gi.needsHistoryFrame(),true,'temporal reflections must request host frames independently of GI');
 }finally{gi.dispose();}
});

test('reflection refinement uses the history weight and disabled routes do not extend host activity',()=>{
 const renderer={library:new StandardNodeLibrary()},gi=createSceneGI(new Scene(),new PerspectiveCamera(),TSL.uniform(0),{renderer,reflections:{enabled:true}});
 try{
  gi.setSettings({mode:'gtao'});gi.requestHistoryFrames();
  const {pendingHistoryFrames,historyRemainderTarget,historyWeight}=gi.reflections.state();
  assert.ok(Math.pow(historyWeight,pendingHistoryFrames-1)<=historyRemainderTarget);
  assert.ok(Math.pow(historyWeight,pendingHistoryFrames-2)>historyRemainderTarget,'history tail requests the first frame meeting its remainder target');
  for(const settings of [{enabled:false},{enabled:true,temporal:false},{enabled:true,temporal:true,historyWeight:0}]){
   gi.reflections.setSettings(settings);gi.requestHistoryFrames();assert.equal(gi.needsHistoryFrame(),false);assert.equal(gi.reflections.state().pendingHistoryFrames,0);
  }
 }finally{gi.dispose();}
});

test('projection suspension bypasses refinement and perspective restoration requests a fresh history',async()=>{
 const {createViewProjection}=await import('../view-projection.mjs');const {Vector3}=await import('../lib/three.webgpu.js');
 const camera=new PerspectiveCamera(),renderer={library:new StandardNodeLibrary()},gi=createSceneGI(new Scene(),camera,TSL.uniform(0),{renderer,reflections:{enabled:true}}),view=createViewProjection({camera,target:()=>new Vector3()});
 try{
  gi.setSettings({mode:'gtao'});assert.equal(gi.needsHistoryFrame(),true);
  view.setOrthographic(true);assert.equal(gi.needsHistoryFrame(),false);
  view.setOrthographic(false);assert.equal(gi.needsHistoryFrame(),true);
 }finally{gi.dispose();}
});
