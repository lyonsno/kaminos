import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const editTools = readFileSync(new URL('../scene-placement-tools.mjs', import.meta.url), 'utf8');

test('viewport modal edits read and write the same scene-object pose that save serializes', () => {
  assert.match(html, /import \{ installScenePlacementTools \} from '\.\/scene-placement-tools\.mjs'/);
  assert.match(html, /read: id => \{[\s\S]*splatSceneTransformState\(entry\) : sceneObjectTransformState\(entry\.object\)/);
  assert.match(html, /write: applyAuthoredScenePose/);
  assert.match(html, /transform: entry\.type === 'splat' \? splatSceneTransformState\(entry\) : sceneObjectTransformState\(object\)/);
  assert.match(editTools, /Enter \/ LMB confirm · Esc \/ RMB cancel/);
  assert.match(editTools, /if \(gizmoEditing && event\.key === 'Escape'\).*finish\(false\)/);
  assert.match(editTools, /event\.metaKey\) && key === 'z'[\s\S]*edits\.redo\(\) : edits\.undo\(\)/);
});

test('F frames the selected authored object through generic geometry bounds', () => {
  assert.match(html, /import \{[^}]*frameSceneObjectRecord[^}]*\} from '\.\/scene-frame-selected\.mjs'/);
  assert.match(html, /frameSelected: \(\) => \{ if \(frameSceneObjectRecord\(sceneObjects\.find\(entry => entry\.id === activeSceneObjectId\), camera, controls\)\)/);
  assert.match(html, /const entry = sceneObjects\.find\(item => item\.id === activeSceneObjectId\);\s*const changed = frameSceneObjectRecord\(entry, camera, controls\)/);
  const framing = readFileSync(new URL('../scene-frame-selected.mjs', import.meta.url), 'utf8');
  assert.match(framing, /return frameObjects\(record\?\.object\?\[record\.object\]:\[\],camera,controls\)/);
  assert.doesNotMatch(framing, /record\?\.type\s*===?\s*['"]splat['"]/);
});

test('clearing resets scene history while reloadable object removal becomes a chronological history action', () => {
  assert.match(html, /window\.removeSceneObject = function\(id\) \{\s*return removeSceneObjectInternal\(id\);/);
  assert.match(html, /function sceneObjectMembershipSnapshot\(id\)[\s\S]*record\.type !== 'glb' \|\| !isReloadableSceneObjectRecord\(record\)/);
  assert.match(html, /function removeSceneObjectInternal\(id, \{ recordHistory = true \} = \{\}\)[\s\S]*if \(recordHistory && !editId\) scenePlacementTools\?\.edits\.discard\(entry => entry\.id === id\)/);
  assert.match(html, /recordApplied\(editId, before, null, `Remove/);
  const removeStart = html.indexOf('function removeSceneObjectInternal(');
  const removeEnd = html.indexOf('window.removeSceneObject = function', removeStart);
  const removeSource = html.slice(removeStart, removeEnd);
  const admissionIndex = removeSource.indexOf('scenePlacementTools.edits.assertCanRecordApplied(editId)');
  const removalIndex = removeSource.indexOf('sceneObjects.splice(index, 1)');
  assert.ok(admissionIndex >= 0 && admissionIndex < removalIndex, 'membership history admission must succeed before the scene object is removed');
  assert.match(removeSource, /catch \(error\) \{ setInfo\(error\.message\); return false; \}/, 'a rejected admission must leave a visible reason and preserve scene membership');
  assert.match(html, /function clearScene\(\) \{\s*scenePlacementTools\?\.clear\(\);\s*for \(const editId of sceneMembershipEditTargets\) scenePlacementTools\.edits\.unregister\(editId\);\s*sceneMembershipEditTargets\.clear\(\);\s*sceneMutationToken\+\+;/);
  assert.match(html, /if \(id !== activeSceneObjectId\) scenePlacementTools\?\.selectionChanged\(\);/);
  assert.match(html, /historyScope: document\.getElementById\('scene-object-list'\)/);
  assert.match(editTools, /historyScope\?\.addEventListener\('pointerdown'.*historyScopeArmed = true/);
  assert.match(editTools, /const viewportScoped = hover \|\| viewport\.contains\(document\.activeElement\);/);
  assert.match(editTools, /const historyScopedUndo = historyScopeArmed && \(event\.ctrlKey \|\| event\.metaKey\) && key === 'z';/);
  assert.doesNotMatch(editTools, /viewportScoped \|\| historyScopeArmed/);
  assert.match(html, /selection: \{ objectId: activeSceneObjectId, groupId: activeSceneGroupId \}/);
  assert.match(html, /selection\.groupId[\s\S]*setActiveSceneGroup\(selection\.groupId\)[\s\S]*selection\.objectId[\s\S]*setActiveSceneObject\(selection\.objectId\)/);
  assert.match(html, /group\.groupIndex\) \|\| group\.groupIndex < 0[\s\S]*group\.objectIds\.includes\(id\)/);
});

test('the same authored history records SF3D insertion and restores its retained GLB source', () => {
  assert.match(html, /async presentGlb\(glb, \{runId, sha256\}\)[\s\S]*showGLB\(saved\.source[\s\S]*recordSceneObjectInsertion\(entry\.id\)/);
  assert.match(html, /function restoreSceneObjectMembership\(snapshot\)[\s\S]*addSceneObjectFromSource\(record\)[\s\S]*applySceneObjectTransformState\(object, record\.transform\)/);
  assert.match(html, /window\.kaminosRecordSceneObjectInsertion = recordSceneObjectInsertion/);
  assert.match(html, /window\.kaminosSceneEdits = scenePlacementTools\.edits/);
});

test('scene load and save wait for an asynchronous history replay to finish', () => {
  assert.match(html, /async function loadSceneFile\([\s\S]*?scenePlacementTools\?\.edits\.state\(\)\.replaying[\s\S]*?Wait for the current scene history action to finish/);
  assert.match(html, /function sceneSaveIsBlocked\(\) \{[\s\S]*?scenePlacementTools\?\.edits\.state\(\)\.replaying[\s\S]*?Wait for the current scene history action to finish/);
});

test('selection feedback hides untrustworthy offscreen pivots and names the recovery cue', () => {
  assert.match(html, /\.scene-object-row\.active \{ background: #29251f; border-color: #a97837; color: #fff; \}/);
  assert.match(editTools, /export function getPivotViewState/);
  assert.match(editTools, /pivotState\?\.state === 'visible'/);
  assert.match(editTools, /finish.*Enter.*Esc.*then F to frame pivot and object/i);
  assert.match(editTools, /F to frame pivot and object/);
  assert.match(editTools, /viewportRect\.bottom - statusRect\.top/);
  assert.match(editTools, /new ResizeObserver\(\(\) => draw\(\)\)/);
  assert.match(html, /#info-bar \{[^}]*max-width:min\(560px,calc\(100% - 32px\)\)[^}]*overflow-wrap:anywhere/);
  assert.match(html, /#scene-edit-hud\[data-alert="true"\] \{[^}]*overflow-wrap:anywhere/);
  // Selection feedback stays out of the lit output: AO is applied as indirect-only
  // scene context and the output is that scene (or the fire light-field receiver over it).
  assert.match(html, /scenePass\.contextNode = builtinAOContext\(aoOutput\)/);
  assert.match(html, /const baseSceneOutput = scenePass;[\s\S]*?renderPipeline\.outputNode = baseSceneOutput;/);
  assert.doesNotMatch(html, /createSelectionFeedback|selectionFeedback\.output/);
});
