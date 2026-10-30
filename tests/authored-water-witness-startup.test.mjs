// kaminos-test: node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../scene-object-witness.mjs',import.meta.url),'utf8');
const scenario=source.slice(source.indexOf('async function runAuthoredWaterProductScenario('));
const start=scenario.indexOf('  const wait=ms=>'),end=scenario.indexOf('  window.kaminosSetCameraDebugPose',start);
assert(start>=0&&end>start);
const enter=new (Object.getPrototypeOf(async function(){}).constructor)('window','document','setTimeout',scenario.slice(start,end)+'return true;');
const window={kaminosWaterSources:{},kaminosWorkbenchState:()=>({}),kaminosSceneAuthoring:{}};
const document={querySelector:()=>({})},pending=[];
let entered=false;
const result=enter(window,document,fn=>pending.push(fn)).then(()=>{entered=true;});
await Promise.resolve();
assert.equal(entered,false,'API globals may exist while the effective scene is still restoring');
window.kaminosWorkbenchExperiments={};
for(const resolve of pending.splice(0))resolve();
assert.equal(await result,undefined);
assert.equal(entered,true,'Effective scene admission releases the authoring witness');
delete window.kaminosWorkbenchExperiments;
window.kaminosWorkbenchExperimentError='Saved scene failed to restore';
await assert.rejects(enter(window,document,()=>{throw Error('Failure must not become an indefinite wait');}),/Saved scene failed to restore/);
console.log('Authored-water witness waits for effective scene admission and surfaces startup failure');
