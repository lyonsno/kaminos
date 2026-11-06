// kaminos-test: node
import assert from 'node:assert/strict';
import {readFireShadowSceneSettings,fireShadowSceneRoute} from '../fire-shadow-scene-settings.mjs';
import {createFireLightingHistory} from '../fire-lighting-history.mjs';
import {createSceneEdits} from '../scene-edit-session.mjs';
import {createFireShadowSettings} from '../fire-shadow-settings.mjs';
const key='volume_light_field_hybrid_shadow_capture_budget';
assert.equal(readFireShadowSceneSettings(new URLSearchParams({[key]:'2'})).shadowCaptureBudget,2,'saved capture cadence must reach the lighting constructor');
for(const value of ['-1','1.5','NaN'])assert.throws(()=>readFireShadowSceneSettings(new URLSearchParams({[key]:value})),/nonnegative integer/);
let state={shadowSampling:'complementary',pointCount:6,pointSampling:'all',shadowResolution:64,blockerSamples:1,filterSamples:1,shadowImplementation:'shared',shadowGrain:'screen',shadowWorldCellSize:.02,shadowSoftness:0,shadowCaptureBudget:0};
const source={debugState:()=>state,setShadowSampling(){},setShadowCaptureBudget(n){if(!Number.isSafeInteger(n)||n<0)throw Error('capture budget must be a nonnegative integer');state={...state,shadowCaptureBudget:n};}};
const route=fireShadowSceneRoute({...state,shadowCaptureBudget:2});assert.equal(route[key],'2');
assert.equal(readFireShadowSceneSettings(new URLSearchParams(route)).shadowCaptureBudget,2);
const edits=createSceneEdits({read:()=>null,write(){}}),history=createFireLightingHistory({edits,getSource:()=>source});
await history.run('setShadowCaptureBudget',2);assert.equal(state.shadowCaptureBudget,2);
await edits.undo();assert.equal(state.shadowCaptureBudget,0);await edits.redo();assert.equal(state.shadowCaptureBudget,2);
const count=edits.state().undoCount;await assert.rejects(history.run('setShadowCaptureBudget',-1),/nonnegative integer/);assert.equal(edits.state().undoCount,count);assert.equal(state.shadowCaptureBudget,2);
class Element{
 constructor(tag){this.tagName=tag;this.children=[];this.listeners={};this.attrs={};}
 append(...items){this.children.push(...items);}setAttribute(k,v){this.attrs[k]=v;}
 addEventListener(key,fn,capture=false){const previous=this.listeners[key];this.listeners[key]=async()=>{let stopped=false;const event={stopImmediatePropagation(){stopped=true;}};if(capture){await fn(event);if(!stopped)await previous?.();}else{await previous?.();await fn(event);}};}
}
const document={createElement:tag=>new Element(tag),getElementById:()=>null,defaultView:{__kaminosSceneRadiance:source}};
const root=new Element('div'),settings=createFireShadowSettings({document,applyInitial:false,session:{redraw(){},dispose(){}},installNumberDrag:()=>({dispose(){}})});
settings.mount({root,document,invoke:(name,value)=>settings.operations[name](value)});
const walk=n=>[n,...n.children.flatMap(c=>typeof c==='object'?walk(c):[])];
const input=walk(root).find(n=>n.attrs['aria-label']==='Solid cube captures per frame (0 = all)');
assert.ok(input,'capture cadence is available in the ordinary inspector');assert.equal(input.value,'2');
input.value='1';await input.listeners.change();assert.equal(state.shadowCaptureBudget,1);
input.value='1.5';await input.listeners.change();assert.equal(state.shadowCaptureBudget,1);assert.equal(input.value,'1');
assert.ok(walk(root).find(n=>n.attrs.role==='alert'&&!n.hidden),'rejected typed budgets explain the reason');
await settings.dispose();
console.log('PASS solid capture route, history, inspector and explicit rejection');
