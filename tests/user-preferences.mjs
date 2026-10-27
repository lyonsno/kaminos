// kaminos-test: node
import {test} from 'node:test';import {readFileSync} from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
import {planSceneRestore} from '../scene-persistence-core.js';
import {createSceneAOState} from '../scene-ao-state.mjs';
import {PREFERENCES_SCHEMA,SCENE_DEFAULT_RANGES,checkedPreferences,sceneDefaultsFromDocument,newSceneDocument,sceneDefaultsApplyToLocation,createUserPreferences} from '../user-preferences.mjs';
const blank=()=>({schema:'kaminos.scene.v1',version:10,objects:[{id:'a'}],sceneId:'old',camera:{position:[0,1,4],target:[0,0,0],up:[0,1,0],fov:50,near:.01,far:100},sceneCamera:{schema:'kaminos.scene-camera.v1',activeId:'camera-a',aspect:[16,9]},environment:{name:'studio',exposure:1},editorDisplay:{hiddenIds:['a']},postprocessing:{},composition:{flame:{presetId:'old'}},localLiquid:{particleCount:4096}});
test('preference capture preserves values the accepted AO owner can restore exactly',()=>{
 const state=createSceneAOState();state.patch({intensity:.654321,radius:27.123456});
 const captured=sceneDefaultsFromDocument({postprocessing:{ao:state.document()}});
 assert.equal(captured.postprocessing.ao.intensity,.654321);assert.equal(captured.postprocessing.ao.radius,27.123456);
 const restored=createSceneAOState();restored.restoreDocument(newSceneDocument(blank(),captured).postprocessing.ao);assert.deepEqual(restored.document(),state.document());
});
test('capturing defaults copies settings without scene membership or camera references',()=>{const doc=blank(),value=sceneDefaultsFromDocument(doc);assert.equal(value.environment.exposure,1);assert.equal(value.sceneCamera.activeId,null);assert.deepEqual(value.editorDisplay.hiddenIds,[]);assert.equal('sceneId' in value,false);assert.equal('objects' in value,false);value.environment.exposure=3;assert.equal(doc.environment.exposure,1);});
test('new scenes use defaults and never inherit source-scene identities or simulations',()=>{const factory=blank(),defaults=sceneDefaultsFromDocument(factory);defaults.environment.exposure=.7;const value=newSceneDocument(factory,defaults);assert.equal(value.environment.exposure,.7);assert.deepEqual(value.objects,[]);assert.equal(value.composition,null);assert.equal(value.localLiquid,null);assert.equal(value.sceneId,undefined);assert.equal(value.sceneCamera.activeId,null);assert.equal(factory.sceneId,'old');});
test('saved scenes and explicit asset, experiment or fire routes bypass scene defaults',()=>{for(const url of ['/#scene=look.kaminos.json','/?mesh=a.glb','/?experiment=material-study','/#volume_light_field=1','/?load=splat/a.ply','/?image=a.png','/#note=note-a'])assert.equal(sceneDefaultsApplyToLocation(url),false,url);for(const url of ['/','/#workspace=authoring','/?workspace=workbench','#authoring=1'])assert.equal(sceneDefaultsApplyToLocation(url),true,url);});
test('invalid numeric, camera identity and display references are refused; additive fields survive',()=>{const raw={schema:PREFERENCES_SCHEMA,navigationInput:'mouse',future:{enabled:true},sceneDefaults:sceneDefaultsFromDocument(blank())};assert.deepEqual(checkedPreferences(raw).future,{enabled:true});assert.throws(()=>checkedPreferences({...raw,sceneDefaults:{objects:[]}}),/identity/);const nonfinite=structuredClone(raw);nonfinite.sceneDefaults.environment.exposure=NaN;assert.throws(()=>checkedPreferences(nonfinite),/finite/);const hidden=structuredClone(raw);hidden.sceneDefaults.editorDisplay.hiddenIds=['old'];assert.throws(()=>checkedPreferences(hidden),/hidden/);});
test('preference file revision is retained and failed saves leave the acknowledged record unchanged',async()=>{const pref={schema:PREFERENCES_SCHEMA,navigationInput:null,sceneDefaults:null};const requests=[];let fail=false;const controller=createUserPreferences({request:async(url,options)=>{requests.push({url,options});return {ok:!fail,status:fail?409:200,json:async()=>fail?{error:'changed elsewhere'}:{revision:requests.length===1?'one':'two',preferences:options.body?JSON.parse(options.body).preferences:pref}};}});await controller.load();await controller.save({...pref,navigationInput:'mouse'});assert.equal(JSON.parse(requests[1].options.body).revision,'one');assert.equal(controller.state().receipt.revision,'two');fail=true;await assert.rejects(controller.save(pref),/changed elsewhere/);assert.equal(controller.state().receipt.preferences.navigationInput,'mouse');});
test('unavailable or malformed servers do not pretend preferences were saved',async()=>{const controller=createUserPreferences({request:async()=>({ok:true,json:async()=>({preferences:{schema:PREFERENCES_SCHEMA}})})});await assert.rejects(controller.load(),/revision/);assert.equal(controller.state().available,false);await assert.rejects(controller.save({schema:PREFERENCES_SCHEMA}),/Load/);});

test('the defaults loader can restore an explicitly empty template without broadening normal scene admission',()=>{const value=newSceneDocument(blank(),sceneDefaultsFromDocument(blank()));assert.throws(()=>planSceneRestore(value),/Invalid scene format/);const plan=planSceneRestore(value,{allowEmpty:true});assert.deepEqual(plan.objects,[]);assert.equal(plan.composition,null);assert.throws(()=>planSceneRestore({...value,version:0},{allowEmpty:true}),/Invalid scene format/);assert.throws(()=>planSceneRestore({...value,version:999},{allowEmpty:true}),/newer authoring client/);});

test('Preferences number admission uses setting validity rather than copied slider affordances',()=>{
 const text=readFileSync(new URL('../user-preferences-ui.mjs',import.meta.url),'utf8');
 const a=text.indexOf(' function field('),b=text.indexOf(' const env=group(',a);
 const create=tag=>({tagName:tag.toUpperCase(),dataset:{},append(){},addEventListener(){}});
 const fields=[],source={tagName:'INPUT',min:'0.2',max:'4',step:'.1'};
 const c={document:{createElement:create,getElementById:()=>source},fields,SCENE_DEFAULT_RANGES,copy:structuredClone};vm.createContext(c);vm.runInContext(text.slice(a,b),c);
 c.field(create('div'),'environment.exposure','Exposure',{source:'exposure-slider'});
 for(const exposure of [0,5,12]){
  assert.equal(checkedPreferences({schema:PREFERENCES_SCHEMA,sceneDefaults:{environment:{name:'studio',exposure}}}).sceneDefaults.environment.exposure,exposure);
  const input=fields[0].input;assert.ok(!input.min||Number(input.min)<=exposure,'canonical exposure must not be below the preference input minimum');assert.ok(!input.max||Number(input.max)>=exposure,'canonical exposure must not exceed the preference input maximum');
 }
 assert.throws(()=>checkedPreferences({schema:PREFERENCES_SCHEMA,sceneDefaults:{environment:{name:'studio',backgroundBlur:2}}}),/blur/i,'the environment loader rejects blur outside 0..1');
});


test('saved defaults use accepted AO semantics and retain fixed ranges for the unchanged consumers',()=>{
 const defaults=postprocessing=>({schema:PREFERENCES_SCHEMA,sceneDefaults:{postprocessing}});
 for(const ao of [{radius:-1},{intensity:'1'},{scale:-.1},{thickness:NaN},{enabled:'false'}])assert.throws(()=>checkedPreferences(defaults({ao})),/AO|ao|finite/);
 for(const ao of [{radius:25},{falloff:2},{radius:.1},{intensity:4},{scale:6},{thickness:6},{radius:1.234}])assert.deepEqual(checkedPreferences(defaults({ao})).sceneDefaults.postprocessing.ao,ao);
 for(const dof of [{focus:11},{aperture:.02},{maxblur:.06}])assert.throws(()=>checkedPreferences(defaults({dof})),/Depth|dof/);
 assert.throws(()=>checkedPreferences({schema:PREFERENCES_SCHEMA,sceneDefaults:{backdropBrightness:3}}),/Backdrop|backdrop/);
 const valid={ao:{radius:7.5,intensity:1.25,scale:.75,thickness:1.45,falloff:.37},dof:{focus:2.5,aperture:.002,maxblur:.01}};
 assert.deepEqual(checkedPreferences(defaults(valid)).sceneDefaults.postprocessing,valid);
});
