// kaminos-test: node
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createAuthoredWaterFeature} from '../authored-water-feature.mjs';
import {sceneItemVisible} from '../scene-visibility.mjs';
const records=['visible','hidden','grouped'].map(id=>({id,type:'local-liquid-emitter',localLiquidEmitter:{mode:'finite_drop'}}));
const scene={objects:records,groups:[{id:'off',objectIds:['grouped']}]};
const display={hiddenIds:['water-field','hidden','@group:off']};let options,inputs;
const no=()=>{};
const ctx={createAuthoredWaterFeature:o=>(options=o,{}),localLiquidEmitterRecords:()=>records,
 isSceneItemVisible:id=>sceneItemVisible(id,display.hiddenIds,scene),itemVisible:sceneItemVisible,
 viewportDisplay:display,sceneVisibilityContext:()=>scene,localLiquidEmitterState:()=>({emitters:[]}),sceneViewerPaused:null,
 setInfo:no,refreshAuthoredWaterSamplingPreviews:no,setAuthoredWaterPreviewVisible:no};
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('const waterFeature = createAuthoredWaterFeature('),end=html.indexOf('\n});',start)+4;
assert.ok(start>=0&&end>start,'actual page water feature installation is present');
vm.runInNewContext(html.slice(start,end),ctx);
const feature=createAuthoredWaterFeature({...options,services:()=>({}),refresh:no,
 loadHost:async()=>({createAuthoredWaterHost:async opts=>{inputs=opts.emitters;return {setEmitters:no,setPaused(v){this.paused=v;},state:()=>({mode:'finite_drop'}),dispose:no};}})});
feature.setup={};await feature.recover(false);
assert.deepEqual(inputs.map(r=>r.id),['visible'],'field visibility must not discard restart seeds; individual/group hiding still applies');
assert.equal(feature.paused,false);assert.equal(feature.host.paused,true);
display.hiddenIds=display.hiddenIds.filter(id=>id!=='water-field');
feature.restart(feature.setup);await feature.recover(true);
assert.deepEqual(inputs.map(r=>r.id),['visible']);assert.equal(feature.host.paused,true);
console.log('Actual page water wiring retains hidden-field seeds and independent source visibility');
