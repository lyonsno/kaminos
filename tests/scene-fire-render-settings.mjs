// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';import {checkedFireRendering,readFireRendering,FIRE_RENDER_DEFAULTS} from '../scene-fire-render-settings.mjs';
test('scene flame lighting preserves camera match, source softness and surface trim',()=>{
 const values={...FIRE_RENDER_DEFAULTS,'rendering-match-flame-camera':true,'rendering-source-softness':4,'rendering-surface-gain':-2.5,'rendering-angular-pattern':'guided','rendering-angular-samples':48};
 const document={getElementById:id=>({checked:values[id],value:String(values[id])})};assert.deepEqual(readFireRendering(document),values);assert.deepEqual(checkedFireRendering(values),values);assert.throws(()=>checkedFireRendering({'rendering-source-softness':NaN}),/Invalid/);assert.throws(()=>checkedFireRendering({'rendering-source-softness':.4}),/integer/);
});
