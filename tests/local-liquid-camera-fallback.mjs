// kaminos-test: node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {applySceneEmissiveCamera} from '../scene-emissive-camera.mjs';
const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const frame=source.indexOf('  function renderSceneFrame()');
const start=source.indexOf('    fireLightFieldPass?.renderShadows();',frame);
const end=source.indexOf('    // Copy the surface records',start);
assert.ok(start>frame&&end>start);
const production=source.slice(start,end);
for(const matching of [true,false])for(const mountTransform of [true,false]) {
  const raw={},matched={},draws=[];
  const pipeline={outputNode:matched,outputColorTransform:mountTransform,
    render(){draws.push({node:this.outputNode,transform:this.outputColorTransform});}};
  const host={setSceneCamera(){},render(){throw Error('GPU frame failed');},
    dispose(){pipeline.outputColorTransform=mountTransform;}};
  const fields={'rendering-match-flame-camera':{checked:matching},'rendering-camera-status':{textContent:''}};
  runInNewContext(production,{
    fireLightFieldPass:null,sceneGISettings:{mode:'gtao',view:'scene'},
    document:{getElementById:id=>fields[id]},window:{__kaminosVolumePrototype:{emissiveCameraState:()=>({})}},
    sceneEmissiveCamera:{update:()=>({effective:matching,toneMapping:'agx',whiteBalanceKelvin:6500,exposureEV:0})},
    applySceneEmissiveCamera,renderPipeline:pipeline,outlinedSceneOutput:raw,outlinedCameraOutput:matched,
    localLiquidHost:host,ordinarySceneTransportFrame:null,localLiquidFailure:null,sceneCameraStatusText:'',console:{error(){}},
    syncWaterProxy(){},syncFireProxy(){},renderWithViewportShading:draw=>draw(),refreshLocalLiquidPerformance(){},setInfo(){},
  });
  assert.equal(draws.length,1);
  assert.equal(draws[0].node,matching?matched:raw,'the first failure fallback must restore the selected camera graph');
  assert.equal(draws[0].transform,!matching,'the first fallback applies exactly the selected display transform');
}
console.log('authored water first-fallback camera restoration passed');
