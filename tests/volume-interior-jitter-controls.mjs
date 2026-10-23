// kaminos-test: node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {FLAME_PROPERTY_GROUPS} from '../flame-authoring.mjs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const core=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
const schema=JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json',import.meta.url)));
assert.equal(FLAME_PROPERTY_GROUPS.find(g=>g.name==='Ray marching').fields.filter(([id])=>id==='volume-quadrature-jitter').length,1,
  'interior jitter must be independently selectable in Quality');
assert.deepEqual(schema.rendererControls.find(c=>c.key==='volume-quadrature-jitter'),{
  key:'volume-quadrature-jitter',param:'volume_quadrature_jitter',tagName:'INPUT',type:'checkbox',additiveDefault:true,
});
const writes=core.match(/uniforms\[41\][\s\S]*?uniforms\[43\][^;]*;/)?.[0];
assert.ok(writes,'interior jitter needs its own GPU flag, not the animation phase');
for(const rayNoiseAnimated of [false,true])for(const quadratureJitter of [false,true])for(const rayNoiseFrame of [undefined,0,39]){
  const uniforms=[];
  vm.runInNewContext(writes,{uniforms,state:{frameCount:107},renderPhaseFrame:13,controlsSnapshot:{rayStartNoise:true,rayNoiseAnimated,quadratureJitter,rayNoiseFrame},clampFinite:()=>0});
  assert.equal(uniforms[41],rayNoiseAnimated?(rayNoiseFrame??13)%32:0,
    'animated noise uses the held render phase or explicit override, not the advancing frame count');
  assert.equal(uniforms[43],quadratureJitter?1:0);
}
assert.match(core,/u\.occupancy_controls\.w > 0\.5/,'interior GPU branch must consume the independent flag');
assert.match(html,/quadratureJitter: document\.getElementById\('volume-quadrature-jitter'\)\.checked/);
assert.match(html,/\['volume-quadrature-jitter', 'volume_quadrature_jitter'\]/);
assert.match(html,/'volume-quadrature-jitter',\n/,'control must be on the normal update path');
console.log('Independent interior/animated sampling flags and authored persistence contracts pass');
