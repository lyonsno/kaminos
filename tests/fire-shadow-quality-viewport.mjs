// kaminos-test: node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../scratch/beaming-shadow-quality-1015.mjs',import.meta.url),'utf8');
const expression=source.match(/const row=await page.evaluate\(([\s\S]*?)\);\n  assert\(row/)[1];
const volume={width:514,height:623,displayWidth:874,displayHeight:1058,renderScale:0.589};
const host={width:874,height:1058,getBoundingClientRect:()=>({width:874,height:1058})};
const context={document:{querySelector:()=>({width:1,height:1}),getElementById:id=>id==='kaminos-host-renderer-canvas'?host:null},window:{__kaminosSceneRadiance:{debugState:()=>({})},kaminosWorkbenchExperiments:{read:async()=>({})},__kaminosVolumePrototype:{debugState:()=>volume}},location:{href:'http://test/'}};
const observe=async()=>structuredClone(await vm.runInNewContext(`(${expression})()`,context));
const baseline=await observe();
assert.equal(baseline.canvas[0],874,'must observe the actual host renderer, not the leading diagnostic canvas');
// Execute the same preservation assertion used for every captured state.
const checkSource=source.match(/\/\/ viewport-preservation:start\n([\s\S]*?)\/\/ viewport-preservation:end/)[1];
const check=row=>vm.runInNewContext(checkSource,{assert,row,report:{rows:[baseline]}});
check(await observe());
host.width=437;const changedScene=await observe();assert.throws(()=>check(changedScene),/scene dimensions changed/);host.width=874;
volume.width=257;assert.throws(()=>check({...baseline,volume:{...volume}}),/volume dimensions changed/);volume.width=514;
volume.renderScale=0.3;assert.throws(()=>check({...baseline,volume:{...volume}}),/volume dimensions changed/);
context.document.getElementById=()=>null;await assert.rejects(observe,/missing scene renderer/);
console.log('budget smoke rejects unrelated canvas, missing scene surface and intermediate resolution changes');
