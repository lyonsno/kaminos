// kaminos-test: node
import assert from 'node:assert/strict';
import {readFireShadowSceneSettings,fireShadowSceneRoute} from '../fire-shadow-scene-settings.mjs';
import {nearSmokeBoxCoverage,admitNearSmokeBox} from '../scene-near-smoke-box.mjs';
import {createFireLightingHistory} from '../fire-lighting-history.mjs';
const config={enabled:true,grid:8,directions:24,extent:[1.5,1.75,1.25]};
const params=new URLSearchParams({volume_light_field_hybrid_near_box:JSON.stringify(config)});
assert.deepEqual(readFireShadowSceneSettings(params).nearBox,config,'saved near-box policy must reach the lighting constructor');
assert.deepEqual(readFireShadowSceneSettings(new URLSearchParams(fireShadowSceneRoute({shadowSampling:'complementary',pointCount:4,pointSampling:'all',shadowResolution:64,blockerSamples:1,filterSamples:1,shadowSoftness:0,shadowImplementation:'shared',shadowGrain:'screen',shadowWorldCellSize:.02,nearBox:config}))).nearBox,config,'near-box settings round trip with the scene lighting route');
const targets=new Map();let state={nearBox:config};
const source={debugState:()=>state,setNearBox(v){state={nearBox:structuredClone(v)};}};
const edits={register(id,adapter){targets.set(id,adapter);},async applySettled(id,value){const target=targets.get(id);const old=target.read();await target.write(value);this.undo=()=>target.write(old);this.redo=()=>target.write(value);}};
const history=createFireLightingHistory({edits,getSource:()=>source});
assert.ok(history.supports('setNearBox'),'ordinary lighting history owns near-box edits');
await history.run('setNearBox',{...config,enabled:false});assert.equal(state.nearBox.enabled,false);
await edits.undo();assert.deepEqual(state.nearBox,config);await edits.redo();assert.equal(state.nearBox.enabled,false);
for(const invalid of [{...config,grid:0},{...config,directions:3},{...config,extent:[1,.5,1]},{...config,enabled:'yes'}])assert.throws(()=>readFireShadowSceneSettings(new URLSearchParams({volume_light_field_hybrid_near_box:JSON.stringify(invalid)})));
console.log('near smoke box route, validation and undo/redo pass');

const cover=nearSmokeBoxCoverage({grid:8,directions:12,extent:[1.5,1.5,1.5]},{lo:[-1,-1,-1],hi:[1,3,1]});
assert.deepEqual(cover,{lo:[-1.5,-1,-1.5],hi:[1.5,5,1.5],pitch:.25,directions:12});
assert.equal(nearSmokeBoxCoverage({enabled:false},{lo:[-1,-1,-1],hi:[1,3,1]}),null);

const limits={maxStorageBufferBindingSize:134217728,maxTextureDimension2D:8192,maxTextureDimension3D:256,maxComputeWorkgroupsPerDimension:65535};
const domain={lo:[-1,-1,-1],hi:[1,3,1],dimensions:[4,8,4]};
assert.throws(()=>admitNearSmokeBox({...config,grid:10000},domain,limits),/capacity|dimensions|texture/,'unsupported allocation is refused before accepting a live edit');
assert.deepEqual(admitNearSmokeBox(config,domain,limits),config);
