import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const index = readFileSync(join(root, 'index.html'), 'utf8');

assert.match(index, /const SCENE_SCHEMA\s*=\s*'kaminos\.scene\.v1'/, 'scene files declare the multi-object schema');
assert.match(index, /let sceneObjects\s*=\s*\[\]/, 'workbench keeps an explicit authored scene object registry');
assert.match(index, /let activeSceneObjectId\s*=\s*null/, 'workbench tracks the active object by stable id');
assert.match(index, /function registerSceneObject\(/, 'load paths register authored objects instead of only replacing currentMesh');
assert.match(index, /function serializeSceneObject\(/, 'scene save serializes each object independently');
assert.match(index, /function loadSceneObjects\(/, 'scene load restores multiple objects from one scene file');
assert.match(index, /function setActiveSceneObject\(/, 'selection/gizmo can target one object in a multi-object scene');
assert.match(index, /objects:\s*sceneObjects\.map\(serializeSceneObject\)/, 'scene save writes all authored objects');
assert.match(index, /activeObjectId:\s*activeSceneObjectId/, 'scene save preserves the active object id');
assert.match(index, /volumePrimitives:\s*getVolumePrimitiveState\(\)/, 'scene save keeps Beaming volume primitives alongside objects');
assert.match(index, /Array\.isArray\(data\.objects\)/, 'scene load accepts the v1 objects array');
assert.match(index, /await loadSceneObjects\(data\.objects/, 'scene load restores the object collection before applying active selection');
assert.match(index, /sceneObjectToLegacyModel/, 'scene load keeps backward compatibility with single-model Kaminos scenes');
assert.match(index, /addSceneObjectFromSource/, 'multi-object loading reuses the same source restoration route for each object');
assert.match(index, /registerSceneObject\(model,[\s\S]*source:/, 'GLB load registers source identity for persistence');
assert.match(index, /registerSceneObject\(obj,[\s\S]*source:/, 'OBJ load registers source identity for persistence');
assert.doesNotMatch(index, /if \(!data\.version \|\| \(!data\.model\?\.source && !hasVolumePrimitiveScene\)\)/, 'scene validation must not reject object-only multi-object scenes');
