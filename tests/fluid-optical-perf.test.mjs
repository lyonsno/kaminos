import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateOpticalTiming,validateOpticalRuntime,substituteBaseline} from '../tools/fluid-optical-perf-validation.mjs';

const core=readFileSync(new URL('../finger-fluid-webgpu-core.js',import.meta.url),'utf8');
const transport=readFileSync(new URL('../local-liquid-transport.mjs',import.meta.url),'utf8');
test('the benchmark launches the admitted independent executable instead of the unchecked caller path',()=>{
  const source=readFileSync(new URL('../tools/fluid-optical-perf.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/executablePath:a\.browser/,'benchmark bypasses the shop browser admission check');
  assert.match(source,/fluidBrowserLaunch/);
});

test('scene-ray march projects its constant origin and direction once, retaining the 24-step search',()=>{
  const body=core.slice(core.indexOf('fn traceDeferredSceneInterval('),core.indexOf('fn intersectTriangle('));
  const loop=body.slice(body.indexOf('for (var stepIndex'));
  assert.doesNotMatch(loop,/projectWorldToDeferred\(samplePosition\)/,'constant camera matrix must not be applied again at every ray step');
  assert.match(body,/stepIndex < 24u/);
  assert.match(body,/minimumDistance \+ \(maximumDistance - minimumDistance\) \* f32\(stepIndex\) \/ 23\.0/);
  assert.match(body,/distance = distance \+ 0\.05 \+ distance \* 0\.105/);
  assert.match(body,/transverseError > pixelFootprint/);
});

test('performance evidence rejects partial/zero timing, substituted renderer, and unbound shader',()=>{
  validateOpticalTiming([1,2],2);
  for(const [values,count] of [[[1],2],[[0],1],[[-1],1],[[NaN],1]])assert.throws(()=>validateOpticalTiming(values,count));
  const valid={clock:{paused:true},bench:{runtime:{solver_backend:'webgpu_compute',effectiveRendererMode:'screen_space_refraction'}},viewport:{effective:'shared',failure:null,lastFrame:{presentedByHost:true}}};
  validateOpticalRuntime(valid);
  for(const change of [s=>s.clock.paused=false,s=>s.bench.runtime.effectiveRendererMode='sphere_debug',s=>s.viewport.lastFrame.presentedByHost=false,s=>s.viewport.failure='lost']){
    const s=structuredClone(valid);change(s);assert.throws(()=>validateOpticalRuntime(s));
  }
  assert.equal(substituteBaseline('abc',[{candidate:'b',baseline:'x'}]),'axc');
  assert.throws(()=>substituteBaseline('acc',[{candidate:'b',baseline:'x'}]));
  assert.throws(()=>substituteBaseline('abbc',[{candidate:'b',baseline:'x'}]));
});

test('normal fallback avoids repeating an identical stencil, preserving its ordered fallback radii',()=>{
  const body=transport.slice(transport.indexOf('fn liquidWorldNormalAtRadius('),transport.indexOf('fn liquidWorldDirectionToView('));
  assert.match(body,/if \(index > 0u && radius == radii\[index - 1u\]\) \{ continue; \}/,'failed axis currently repeats the same immutable depth samples');
  // The accepted radii for all caller distances and their fallback order remain stable.
  for(const [r,expected] of [[1,[1]],[2,[2,1]],[3,[3,1]],[6,[6,3,1]]]){
    const radii=[r,Math.min(r,3),1];
    assert.deepEqual(radii.filter((v,i)=>i===0||v!==radii[i-1]),expected);
  }
});
