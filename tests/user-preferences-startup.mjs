// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
test('explicit scene defaults prevent stale per-port tweaks being restored first',()=>{
 const text=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const start=text.indexOf('function restoreSettings() {'),end=text.indexOf('// Auto-save on any sidebar control change',start);
 const controls={'exposure-slider':{value:'1',dispatchEvent(){}}};
 const context={startupPreferences:{sceneDefaults:{environment:{name:'studio',exposure:.7}}},localStorage:{getItem:()=>JSON.stringify({'exposure-slider':'4',environmentName:'studio'})},KAMINOS_SETTINGS_KEY:'kaminos-settings',PERSISTED_SLIDERS:['exposure-slider'],PERSISTED_CHECKBOXES:[],restoringSettings:false,document:{getElementById:id=>controls[id]},normalizeEnvironmentRecipes:()=>({}),setRimLight(){},HDR_ENVS:{studio:{}},Event:class {}};
 vm.createContext(context);vm.runInContext(text.slice(start,end)+';restoreSettings();',context);
 assert.equal(controls['exposure-slider'].value,'1','explicit defaults must bypass implicit last-tweak restoration before the ordinary default-scene loader runs');
});
