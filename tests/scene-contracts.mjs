import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const index = readFileSync(join(root, 'index.html'), 'utf8');
const persistence = readFileSync(join(root, 'scene-persistence-core.js'), 'utf8');

assert.match(persistence, /export const SCENE_SCHEMA\s*=\s*'kaminos\.scene\.v1'/, 'scene files declare the multi-object schema in the shared persistence core');
assert.match(index, /from '\.\/scene-persistence-core\.js'/, 'workbench imports the shared scene persistence core');
assert.match(index, /let sceneObjects\s*=\s*\[\]/, 'workbench keeps an explicit authored scene object registry');
assert.match(index, /let activeSceneObjectId\s*=\s*null/, 'workbench tracks the active object by stable id');
assert.match(index, /function registerSceneObject\(/, 'load paths register authored objects instead of only replacing currentMesh');
assert.match(index, /function serializeSceneObject\(/, 'scene save serializes each object independently');
assert.match(index, /function loadSceneObjects\(/, 'scene load restores multiple objects from one scene file');
assert.match(index, /function setActiveSceneObject\(/, 'selection/gizmo can target one object in a multi-object scene');
assert.match(index, /buildSceneDocument\(\{[\s\S]*objects,/ , 'scene save writes all authored objects through the shared document builder');
assert.match(index, /activeObjectId:\s*activeSceneObjectId/, 'scene save preserves the active object id');
assert.match(index, /volumePrimitives:\s*getVolumePrimitiveState\(\)/, 'scene save keeps Beaming volume primitives alongside objects');
assert.match(persistence, /Array\.isArray\(data\?\.objects\)/, 'scene load accepts the v1 objects array');
assert.match(index, /await loadSceneObjects\(objectRecords,\s*restorePlan\.activeObjectId\)/, 'scene load restores the object collection before applying active selection');
assert.match(index, /catch \(e\) \{[\s\S]*clearScene\(\);[\s\S]*throw e;[\s\S]*\}/, 'scene object loading clears partial restore residue before failing loudly');
assert.match(persistence, /sceneObjectToLegacyModel/, 'scene load keeps backward compatibility with single-model Kaminos scenes');
assert.match(index, /addSceneObjectFromSource/, 'multi-object loading reuses the same source restoration route for each object');
assert.match(index, /registerSceneObject\(model,[\s\S]*source:/, 'GLB load registers source identity for persistence');
assert.match(index, /registerSceneObject\(obj,[\s\S]*source:/, 'OBJ load registers source identity for persistence');
assert.match(index, /if \(!currentMesh && volumePrimitives\.length === 0\) return;/, 'keyboard save allows volume-only scenes while rejecting truly empty scenes');
assert.match(index, /setInfo\('Volume scene loaded'\);/, 'volume-only scene loads report success after shared camera/postprocessing/backdrop restoration');
assert.doesNotMatch(index, /if \(!data\.version \|\| \(!data\.model\?\.source && !hasVolumePrimitiveScene\)\)/, 'scene validation must not reject object-only multi-object scenes');
