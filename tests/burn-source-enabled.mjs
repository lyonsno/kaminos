// kaminos-test: node
import {FIRE_DOMAIN_ID,fireControlOwner} from '../scene-fire-domain.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('shared fire edit retains source enablement and rejects non-boolean state',()=>{
 const start=source.indexOf('function installAuthoringParameterEditing() {');
 const setup=source.slice(start,source.indexOf('  authoringControlSessions.push(sceneControlHistory);',start))+'}';
 const registrations=new Map(),entry={id:'fire',object:{userData:{kaminosSceneObject:{}}}};let updates=0;
 const context={scenePlacementTools:{edits:{register:(id,api)=>registrations.set(id,api)}},sceneObjects:[entry],FLAME_EMITTER_ID:'fire',FLAME_EMITTER_TYPE:'flame-emitter',flameEmitterPose:{},writeAuthoredFlameEmitterPose:()=>updates++,window:{_kaminosDirty(){}}};
 vm.createContext(context);vm.runInContext(source.match(/function primaryAuthoredFlameSource\(\)[^\n]+/)[0]+'\n'+setup+';installAuthoringParameterEditing();',context);
 const edit=registrations.get('@flame-source-enabled');assert.ok(edit,'shared fire enable edit must be registered');
 assert.equal(edit.read().enabled,true);assert.throws(()=>edit.check({enabled:'false'}),/boolean/);
 edit.write(edit.check({enabled:false}));assert.equal(edit.read().enabled,false);assert.equal(entry.object.userData.kaminosSceneObject.emissionEnabled,false);
 edit.write(edit.check({enabled:true}));assert.equal(edit.read().enabled,true);assert.equal(updates,2);
});
test('emitter compiler preserves a disabled source across ordinary pose/settings writes',()=>{
 const start=source.indexOf('  function applyVolumeEmitterFamilyRuntimeToCockpit('),end=source.indexOf('\n  applyFlameEmitterPose =',start);
 let requested;
 const context={FIRE_DOMAIN_ID,fireControlOwner,readVolumeSettingsValues:()=>({domControls:{}}),syncAuthoredFlameSources(){},sceneObjects:[{id:'fire',object:{userData:{kaminosSceneObject:{}}},emissionEnabled:false}],FLAME_EMITTER_ID:'fire',FLAME_EMITTER_TYPE:'flame-emitter',authoredFlamePresent:true,flameEmitterPose:{},flameEmitterInjectionSuspended:false,flameDomainTranslation:[0,0,0],flameDomainScale:1,routeExternalEmitters:null,volumeEmitterRuntimeFrame:0,volumePrototype:{debugState:()=>({frameCount:0})},flamePoseInDomain:()=>true,effectiveFlameDomainControls:()=>({}),document:{getElementById:()=>({value:'analytic'})},performance:{now:()=>0},emitterCompilerControls:x=>x,flamePoseToDomain:x=>x,applyVolumeEmitterFamilyRuntime:input=>{requested=input;return {requested:{},effective:{}};},window:{},renderVolumeEmitterReceipt(){},ensureAuthoredFlameEmitter(){},structuredClone};
 vm.createContext(context);vm.runInContext(source.match(/function primaryAuthoredFlameSource\(\)[^\n]+/)[0]+'\n'+source.slice(start,end)+';applyVolumeEmitterFamilyRuntimeToCockpit({emitterSourceLaw:"canonical"},{},{sourceEnabled:true});',context);
 assert.equal(requested.sourceEnabled,false,'disabled authored source must not be re-enabled by a pose write');
 context.sceneObjects[0].emissionEnabled=true;
 vm.runInNewContext('applyVolumeEmitterFamilyRuntimeToCockpit({emitterSourceLaw:"canonical"},{},{sourceEnabled:true});',context);assert.equal(requested.sourceEnabled,true);
});
