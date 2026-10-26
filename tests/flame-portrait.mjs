// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
const module=await import('../flame-portrait.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
const {flamePortraitView,createFlamePortrait}=module;
test('portrait framing keeps a fixed direction and fits every corner of the domain',()=>{
 assert.equal(typeof flamePortraitView,'function','Flame portrait camera is unavailable');
 const view=flamePortraitView({min:[-1,-1,-1],max:[1,3,1]});
 assert.deepEqual(view.target,[0,1,0]);assert.deepEqual(view.up,[0,1,0]);assert.equal(view.framing,'domain-front-v1');
 const other=flamePortraitView({min:[9,-1,4],max:[11,3,6]});
 assert.deepEqual(other.position.map((v,i)=>v-view.position[i]),[10,0,5]);
 assert.ok(view.position[2]>3);
});
test('portrait capture holds the current field and always releases the borrowed view',async()=>{
 assert.equal(typeof createFlamePortrait,'function','Flame portrait capture is unavailable');
 let released=0,steps=20,fail=false;
 const capture=createFlamePortrait({begin:async()=>({draw:async()=>{if(fail)throw Error('draw failed');return {image:{width:2,height:1,rgba:[255,30,0,255,0,0,0,0]},receipt:{simStepCount:steps,backend:'webgpu',effectiveRoute:'ordinary'}};},camera:flamePortraitView({min:[-1,-1,-1],max:[1,1,1]}),release(){released++;}}),encode:()=> 'data:image/png;base64,AAAA'});
 const portrait=await capture();assert.equal(portrait.simulation.simStepCount,20);assert.equal(steps,20);assert.equal(released,1);assert.equal(portrait.origin,'current-field');
 fail=true;await assert.rejects(capture(),/draw failed/);assert.equal(released,2);
});
test('blank and incomplete field captures cannot become portraits',async()=>{
 assert.equal(typeof createFlamePortrait,'function','Flame portrait capture is unavailable');
 for(const image of [{width:2,height:1,rgba:[0,0,0,0,0,0,0,0]},{width:2,height:1,rgba:[255,0,0,255]}]){
 let released=0;const capture=createFlamePortrait({begin:async()=>({draw:async()=>({image,receipt:{simStepCount:2}}),release(){released++;}}),encode:()=> 'data:image/png;base64,AAAA'});
 await assert.rejects(capture(),/blank|incomplete/i);assert.equal(released,1);
 }
});
test('saved object references survive endpoint replacement and export as portable images',async()=>{
 const raw={schema:'kaminos.flame-portrait.v1',image:'data:image/png;base64,AAAA',width:1,height:1};
 const endpoint=module.retainFlamePortrait(raw),saved=structuredClone(endpoint);
 assert.equal(Object.hasOwn(endpoint,'image'),false);
 module.releaseFlamePortrait(endpoint);
 assert.equal((await fetch(saved.imageUrl)).status,200);
 assert.equal(module.exportFlamePortrait(saved).image,raw.image);
 const restored=module.retainFlamePortrait(module.exportFlamePortrait(saved));
 assert.equal((await fetch(restored.imageUrl)).status,200);
});
test('premultiplied readback is converted once before PNG alpha composition',()=>{
 assert.equal(typeof module.straightFlamePortraitImage,'function','PNG conversion does not yet preserve readback alpha');
 const image={width:2,height:1,rgba:[64,32,16,128,0,0,0,0]};
 assert.deepEqual([...module.straightFlamePortraitImage(image,'premultiplied').rgba],[128,64,32,128,0,0,0,0]);
 assert.deepEqual(module.straightFlamePortraitImage(image,'opaque'),image);
 assert.deepEqual(image.rgba,[64,32,16,128,0,0,0,0]);
});
test('optional cover outages preserve basin loading with an explicit pending warning',async()=>{
 assert.equal(typeof module.readOptionalFlamePortrait,'function','Optional cover loading is unavailable');
 for(const fetch of [async()=>{throw Error('offline');},async()=>({ok:true,json:async()=>{throw Error('invalid JSON');}}),async()=>({ok:false,status:500})]){
 const result=await module.readOptionalFlamePortrait('vsp-example',{fetch});assert.ok(result.portraitError);assert.equal(result.portrait,undefined);
 }
 assert.deepEqual(await module.readOptionalFlamePortrait('vsp-example',{fetch:async()=>({ok:false,status:404})}),{});
});
test('backfill warmup restores authored freeze before capturing and after failure',async()=>{
 assert.equal(typeof module.warmFlamePortraitField,'function','Frozen basin warmup is unavailable');
 for(const fail of [false,true]){let frozen=1,steps=2;const changes=[];
 const flame={settings:()=>({domControls:{'volume-look-freeze':{value:frozen}}}),setPaused(value){frozen=value?1:0;changes.push(frozen);}};
 const runtime={debugState:()=>({active:true,simStepCount:steps}),async pauseSelectiveHeadLiveAtSimStep(target){assert.equal(frozen,0);if(fail)throw Error('GPU failure');steps=target;return {ok:true,effectiveSimStepCount:steps};}};
 if(fail)await assert.rejects(module.warmFlamePortraitField(flame,runtime,90),/GPU failure/);else{const result=await module.warmFlamePortraitField(flame,runtime,90);assert.equal(result.receipt.effectiveSimStepCount,92);assert.equal(result.settings.domControls['volume-look-freeze'].value,1);assert.equal(result.warmupOverride.lookFreeze,0);}
 assert.deepEqual(changes,[0,1]);assert.equal(frozen,1);
 }
});
