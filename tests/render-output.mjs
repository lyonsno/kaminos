// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {checkedRenderOutput, outputPixels, createOutputProfiles, captureStill} from '../render-output.mjs';
const settings={cameraId:null,width:1200,height:800,percentage:50,quality:'scene',filename:'kiln.png'};
test('output pixels use requested dimensions and percentage without a viewport or DPR cap',()=>{
 assert.deepEqual(outputPixels(settings),{width:600,height:400});
 assert.deepEqual(outputPixels({...settings,width:12001,height:701,percentage:100}),{width:12001,height:701});
 for(const patch of [{width:0},{height:NaN},{percentage:0},{width:1.2},{percentage:Infinity},{quality:'mystery'},{cameraId:3},{filename:'../a.png'}])assert.throws(()=>checkedRenderOutput({...settings,...patch}));
 assert.throws(()=>outputPixels({...settings,width:1,height:1,percentage:.1}),/pixel/i);
});
test('profiles edit only their own preference subset and preserve revision conflicts',async()=>{
 let stored={schema:'kaminos.preferences.v1',sceneDefaults:null,navigationInput:'mouse',future:7},revision=0,conflict=false;
 const controller={async load(){return structuredClone(stored);},async save(next){if(conflict)throw Error('changed elsewhere');stored=structuredClone(next);revision++;return structuredClone(stored);}};
 const profiles=createOutputProfiles({controller,makeId:()=> 'profile-a'});
 await profiles.save('Kiln still',settings);
 assert.equal(stored.sceneDefaults,null);assert.equal(stored.future,7);assert.equal(revision,1);
 stored.navigationInput='trackpad';await profiles.save('Kiln still',{...settings,width:800},'profile-a');
 assert.equal(stored.navigationInput,'trackpad');assert.equal((await profiles.load()).items[0].settings.width,800);
 conflict=true;await assert.rejects(profiles.save('Changed',settings,'profile-a'),/elsewhere/);
 assert.equal(stored.renderOutput.items[0].name,'Kiln still');
});
test('capture restores on successful, failed, cancelled and blank output, and refuses overlap',async()=>{
 let held=false,releases=0,mode='ok';
 const host={async begin(request){assert.equal(request.pixels.width,600);assert.equal(held,false);held=true;return {async draw(){if(mode==='fail')throw Error('water failed');if(mode==='cancel')throw new DOMException('Cancelled','AbortError');},async capture(){return mode==='blank'?{dataUrl:'data:,',width:600,height:400}:{dataUrl:'data:image/png;base64,AAAA',width:600,height:400};},async release(){held=false;releases++;}};}};
 const capture=captureStill(host);
 assert.equal((await capture(settings)).width,600);assert.equal(held,false);
 for(const m of ['fail','cancel','blank']){mode=m;await assert.rejects(capture(settings));assert.equal(held,false);}
 assert.equal(releases,4);
 let unblock;mode='ok';host.begin=async()=>{await new Promise(resolve=>{unblock=resolve;});return {draw(){},capture:()=>({dataUrl:'data:image/png;base64,AAAA',width:600,height:400}),release(){}};};
 const pending=capture(settings);await assert.rejects(capture(settings),/progress/);unblock();await pending;
});
test('fire resize follows an explicit presentation extent instead of CSS dimensions',()=>{
 const source=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8'),start=source.indexOf('  function resize() {'),end=source.indexOf('\n  function ensureFrameTexture()',start);
 const canvas={width:0,height:0,style:{}},state={};
 const scope={canvas,state,viewport:{getBoundingClientRect:()=>({width:900,height:500,left:0}),ownerDocument:{defaultView:{devicePixelRatio:2}}},getPresentationSize:()=>({width:600,height:400}),controlsSnapshot:{renderScale:1},normalizeRenderScale:x=>x,boundarySplatRequested:()=>false,browserResidualCanApply:()=>false,frameTextureSize:'',browserResidualFeatureTextureSize:''};
 vm.createContext(scope);vm.runInContext(source.slice(start,end)+'\nresize();',scope);
 assert.deepEqual([canvas.width,canvas.height],[600,400]);
});
test('a profile controller refuses overlapping saves instead of sharing a moving revision',async()=>{
 const loads=[];
 const profiles=createOutputProfiles({makeId:()=> 'x',controller:{load:()=>new Promise(resolve=>loads.push(resolve)),save:async doc=>doc}});
 const pending=profiles.save('One',settings),second=profiles.save('Two',settings);void second.catch(()=>{});
 await Promise.resolve();assert.equal(loads.length,1,'second save must be refused before loading a shared revision');
 loads[0]({schema:'kaminos.preferences.v1'});await pending;await assert.rejects(second,/progress/);
});
test('saving the first output preset does not opt into startup navigation or scene defaults',async()=>{
 let saved;
 const profiles=createOutputProfiles({makeId:()=> 'output-only',controller:{state:()=>({receipt:{revision:null}}),load:async()=>({schema:'kaminos.preferences.v1',navigationInput:null,sceneDefaults:null}),save:async doc=>(saved=doc)}});
 await profiles.save('Picture',settings);assert.equal(saved.startupConfigured,false);assert.equal(saved.sceneDefaults,null);assert.equal(saved.navigationInput,null);
});
