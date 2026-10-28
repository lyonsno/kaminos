// kaminos-test: node
import test from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{checkedFireRendering}from'../scene-fire-render-settings.mjs';
test('the Generate settings adapter preserves authored simulation and ray settings',()=>{
 const source=readFileSync(new URL('../index.html',import.meta.url),'utf8'),start=source.indexOf("const settings={...readVolumeControls({quality:'full',document:copy"),end=source.indexOf('\n    const rendering=',start);assert.ok(start>=0&&end>start);
 const expression=source.slice(start+'const settings='.length,end).trim().replace(/;$/,'');
 const read=Function('readVolumeControls','copy','recipe','authored','checkedFireRendering','return ('+expression+')');
 const result=read(()=>({resolution:64,raySteps:24,adaptiveRays:1,gridHeightRatio:1.5,renderScale:.7}),{},{plan:{composition:{route:{}}},document:{}},{presentationControls:{'raymarch-smoke-presentation':{value:'on'}}},checkedFireRendering);
 assert.equal(result.resolution,64);assert.equal(result.raySteps,24);assert.equal(result.gridHeightRatio,1.5);assert.equal(result.renderScale,.7);assert.equal(result.lookFreeze,0,'the generation lifecycle owns playback, not the saved paused view');
});
