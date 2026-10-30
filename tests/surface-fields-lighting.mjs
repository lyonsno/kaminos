// kaminos-test: node
import assert from 'node:assert/strict';
import {createDeferredSurfaceSplats} from '../deferred-surface-splats.mjs';
import {cloneSceneRadianceMaterial} from '../scene-radiance.mjs';
const surface=createDeferredSurfaceSplats(new Float32Array([0,0,0,0,1,0,.5,.5,.5,0,.8,1]),{count:1,stride:12,radius:.01},new Float32Array([1,0,0,.01,0,0,1,.01]));
const original=surface.root.children[0].material;
const clone=cloneSceneRadianceMaterial({fromMaterial:v=>v},original);
assert.equal(clone.surfacePosition,original.surfacePosition,'fire lighting clone must retain reconstructed view position');
assert.equal(clone.surfaceWorld,original.surfaceWorld,'fire lighting clone must retain reconstructed world position');
clone.dispose();surface.dispose();
console.log('Surface lighting clone preserves reconstructed coordinates');
