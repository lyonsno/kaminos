// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('function writeFlameSettingsState(state) {');
const end=html.indexOf('\nfunction installFlameAuthoring()',start);
assert.ok(start>=0&&end>start);
function host({substitute=false}={}){
 let captures=0,values;
 const no=()=>{};
 const context={document:{getElementById:()=>null},window:{},DEFAULT_VOLUME_SCENE:'flame',flameEmitterPose:{},activeCanonicalVolumeMacroPreset:'',activeVolumeRayBudgetPreset:'',routedVolumeRayBudgetPreset:'',activeVolumeSettingsPresetReceipt:null,flameInspector:null,flameInspectorRefresh:{request:no},
 supersedeVolumeRebuildHolds:no,setVolumeControlValue:no,updateVolumeControlLabels:no,
 applyFlameEmitterPose:no,volumePrototype:{setRaymarchSmokePresentationMode:mode=>({effectiveMode:mode})},syncRaymarchSmokePresentationControls:no,
 readVolumeSettingsValues:()=>substitute?{...values,domControls:{flow:{value:999}}}:values,
 buildVolumeSettingsPreset:()=>{captures++;return context.readVolumeSettingsValues();},
 volumeSettingsPresetControlValuesEqual:(a,b)=>JSON.stringify(a.domControls)===JSON.stringify(b.domControls),
 syncBurnerControls:no,refreshVolumeReadout:no,recordFlameSettingsProblems:no};
 vm.createContext(context);vm.runInContext(html.slice(start,end),context);
 return{write(state){values=structuredClone(state);context.writeFlameSettingsState(state);},captures:()=>captures};
}
const state={domControls:{flow:{value:1}},rendererControls:{},presentationControls:{'raymarch-smoke-presentation':{value:'on'}},source:{presetId:'test'}};
test('continuous flame application verifies values without serializing a capture URL',()=>{
 const h=host();h.write(state);h.write({...state,domControls:{flow:{value:2}}});assert.equal(h.captures(),0);
});
test('values-only application verification still rejects substituted controls',()=>{
 const h=host({substitute:true});assert.throws(()=>h.write(state),/substituted/);
});
