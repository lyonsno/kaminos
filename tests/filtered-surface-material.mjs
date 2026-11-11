// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {validateFilteredSurfaceModel,createFilteredSurfaceMaterial} from '../filtered-surface-material.mjs';
test('runtime fields preserve signed coefficients, shape and disposal without silently clipping',()=>{
 const model={schema:'kaminos.filtered-surface-moments.v1',width:2,height:2,terms:16,footprint:1/8,coefficients:new Float32Array(192)};model.coefficients[0]=-.25;
 const surface=createFilteredSurfaceMaterial(model);assert.equal(surface.field.image.depth,16);assert.equal(surface.field.image.data[0],0xb400);assert.equal(surface.read().footprint,1/8);surface.material.dispose();
 model.coefficients[0]=70000;assert.throws(()=>createFilteredSurfaceMaterial(model),/capacity/);
});
test('unknown formats, truncated fields and nonfinite values fail before material creation',()=>{
 assert.throws(()=>validateFilteredSurfaceModel({}));
 assert.throws(()=>validateFilteredSurfaceModel({schema:'kaminos.filtered-surface-moments.v1',width:2,height:2,terms:16,footprint:1/8,coefficients:[]}));
});
