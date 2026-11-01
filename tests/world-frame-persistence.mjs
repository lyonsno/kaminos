// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {buildSceneDocument,planSceneRestore} from '../scene-persistence-core.js';
const composition={schema:'kaminos.stationary-flame-composition.v1',flame:{presetId:`vsp-${'a'.repeat(64)}`,stationary:true},lightGainStops:0,route:{volume_light_field:'1'}};
const descriptor=value=>({value,rawValue:String(value)});
const settings={domControls:{'volume-world-smoke':descriptor('on'),'volume-resolution':descriptor(32)},rendererControls:{},presentationControls:{}};
const source={id:'flame-emitter',type:'flame-emitter',source:'kaminos:analytic-flame',transform:{position:[2,-.76,0],rotation:[0,0,0],scale:[1,1,1]}};
const worldFrame={translate:[0,0,0],scale:1,referenceDims:[32,64,32]};
const save=()=>buildSceneDocument({objects:[source],composition,fireSettings:settings,flameDomainTranslation:[4,0,0],flameDomainFollowSource:false,flameWorldFrame:worldFrame});
test('scene keeps world envelope separate from relocated Fine coverage',()=>{
 const doc=save(),domain=doc.objects.find(o=>o.type==='simulation-domain'),plan=planSceneRestore(doc);
 assert.deepEqual(domain.simulation.worldFrame,worldFrame);
 assert.deepEqual(plan.flameWorldFrame,worldFrame);
 assert.deepEqual(plan.flameDomainTranslation,[4,0,0]);
});
test('world-backed source outside Fine may reload without reviving box following',()=>{
 const doc=save();doc.objects.find(o=>o.type==='simulation-domain').simulation.followSource=true;
 assert.doesNotThrow(()=>planSceneRestore(doc));
});
test('malformed world frame fails before scene restore',()=>{
 const doc=save(),domain=doc.objects.find(o=>o.type==='simulation-domain');
 domain.simulation.worldFrame={...worldFrame,scale:0};assert.throws(()=>planSceneRestore(doc),/world.*frame/i);
 domain.simulation.worldFrame={...worldFrame,referenceDims:[32,64,17]};assert.throws(()=>planSceneRestore(doc),/world.*frame/i);
});

import fs from 'node:fs';import vm from 'node:vm';
const html=fs.readFileSync(process.env.KAMINOS_WORLD_SOURCE_HTML??new URL('../index.html',import.meta.url),'utf8');
const extract=name=>{const begin=html.indexOf(`function ${name}(`);return html.slice(begin,html.indexOf('\n}\n',begin)+3);};
test('world source pose passes legacy cockpit range readback without Fine-box clamping',()=>{
 const range=id=>({id,type:'range',tagName:'INPUT',min:'-1',max:'1',step:'any',held:'0',
  set value(v){this.held=String(Math.max(Number(this.min),Math.min(Number(this.max),Number(v))));},get value(){return this.held;}});
 const control=range('volume-immersed-centre-x');
 const ctx=vm.createContext({document:{getElementById:()=>control},GRID_TUNING_FIELDS:[],window:{}});
 vm.runInContext(extract('setVolumeControlValue')+extract('applyVolumeRangeSavedValue'),ctx);
 ctx.setVolumeControlValue(control.id,4);assert.equal(control.value,'4');
 ctx.applyVolumeRangeSavedValue(control,-3);assert.equal(control.value,'-3');
 const ordinary=range('volume-fuel');ctx.applyVolumeRangeSavedValue(ordinary,4);assert.equal(ordinary.value,'1','ordinary coefficient bounds remain in effect');
});
