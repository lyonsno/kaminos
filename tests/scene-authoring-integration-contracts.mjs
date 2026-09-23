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

test('clearing or removing authored scene objects cancels previews and invalidates only their history', () => {
  assert.match(html, /window\.removeSceneObject = function\(id\) \{\s*scenePlacementTools\?\.finish\(false\);\s*scenePlacementTools\?\.edits\.discard\(entry => entry\.id === id\);/);
  assert.match(html, /function clearScene\(\) \{\s*scenePlacementTools\?\.clear\(\);\s*sceneMutationToken\+\+;/);
  assert.match(html, /if \(id !== activeSceneObjectId\) scenePlacementTools\?\.selectionChanged\(\);/);
});

test('active selection stays legible through the scene row and pivot marker without a custom pipeline pass', () => {
  assert.match(html, /\.scene-object-row\.active \{ background: #29251f; border-color: #a97837; color: #fff; \}/);
  assert.match(editTools, /line\(origin\.clone\(\)\.add\(new Vector2\(\.\.\.a\)\), origin\.clone\(\)\.add\(new Vector2\(\.\.\.b\)\), '#efa544'\)/);
  assert.match(html, /renderPipeline\.outputNode = scenePass\.mul\(vec4\(vec3\(aoOutput\), 1\)\)/);
  assert.doesNotMatch(html, /createSelectionFeedback|selectionFeedback\.output/);
});
