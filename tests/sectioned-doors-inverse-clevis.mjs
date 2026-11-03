// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../lib/three.core.js';
import * as model from '../experiments/link-workshop/model.mjs';
import {constructBodies,createBodyView,travelEnvelope} from '../experiments/link-workshop/bodies.mjs';
import {furnaceAssembly} from '../experiments/link-workshop/furnace.mjs';
import workshop from '../experiments/link-workshop.experiment.mjs';
import {createSceneEdits} from '../scene-edit-session.mjs';

test('sectionLink splits a door link into N collinear hinged panels and preserves downstream attachments', () => {
  assert.equal(typeof model.sectionLink, 'function', 'model.mjs must export sectionLink');
  const base = {
    schema: 'kaminos.links.v1',
    nodes: [
      { parent: null, point: [0, 3.6] },
      { parent: 0, length: 2.76, angles: [-Math.PI / 2, -Math.PI / 2] },
    ],
    pistons: [],
    period: 5,
  };
  const split = model.sectionLink(base, 1, 3);
  assert.equal(split.nodes.length, 4, '1 anchor + 3 door section links');
  for (const id of [1, 2, 3]) {
    assert.equal(split.nodes[id].parent, id - 1);
    assert.ok(Math.abs(split.nodes[id].length - 0.92) < 1e-6);
  }
  const ptsA = model.evaluate(split, 0);
  assert.ok(Math.abs(ptsA[3][0] - 0) < 1e-6 && Math.abs(ptsA[3][1] - 0.84) < 1e-6, 'closed tip remains at bottom of mouth');
});

test('foldChainToPoint wraps a 3-section door outward and over the stationary housing keep-out box', () => {
  assert.equal(typeof model.foldChainToPoint, 'function', 'model.mjs must export foldChainToPoint');
  const base = model.sectionLink({
    schema: 'kaminos.links.v1',
    nodes: [
      { parent: null, point: [0, 3.6] },
      { parent: 0, length: 2.76, angles: [-Math.PI / 2, -Math.PI / 2] },
    ],
    pistons: [],
    period: 5,
  }, 1, 3);
  const kilnObstacle = [{ min: [-2.6, 0.0], max: [0.0, 3.55] }];
  const folded = model.foldChainToPoint(base, 3, [-1.65, 3.85], 'B', { obstacles: kilnObstacle });
  const tipB = model.evaluate(folded, 1)[3];
  assert.ok(tipB[0] < -0.9 && tipB[1] > 3.58, `Pose B tip should park over the kiln roof, got ${JSON.stringify(tipB)}`);

  // Verify every section segment clears the interior firebox [-2.52, -0.06] x [0.05, 3.48] across the entire swing
  for (const t of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
    const pts = model.evaluate(folded, t);
    for (const id of [1, 2, 3]) {
      const a = pts[id - 1], b = pts[id];
      for (let s = 0; s <= 8; s++) {
        const u = s / 8, x = a[0] + (b[0] - a[0]) * u, y = a[1] + (b[1] - a[1]) * u;
        const insideFirebox = x > -2.52 && x < -0.06 && y > 0.05 && y < 3.48;
        assert.equal(insideFirebox, false, `Section ${id} at t=${t} sample ${s} entered firebox at [${x.toFixed(3)}, ${y.toFixed(3)}]`);
      }
    }
  }
});

test('solvePistonClevis and connectPiston seat stand-off clevis lugs across flat-to-folded sections with zero retraction warnings', () => {
  assert.equal(typeof model.solvePistonClevis, 'function', 'model.mjs must export solvePistonClevis');
  const kilnObstacle = [{ min: [-2.6, 0.0], max: [0.0, 3.55] }];
  let recipe = model.sectionLink({
    schema: 'kaminos.links.v1',
    nodes: [
      { parent: null, point: [0, 3.6] },
      { parent: 0, length: 2.76, angles: [-Math.PI / 2, -Math.PI / 2] },
    ],
    pistons: [],
    period: 5,
  }, 1, 3);
  recipe = model.foldChainToPoint(recipe, 3, [-1.65, 3.85], 'B', { obstacles: kilnObstacle });
  recipe = model.connectPiston(recipe, 0, 1, { obstacles: kilnObstacle });
  recipe = model.connectPiston(recipe, 1, 2, { obstacles: kilnObstacle });
  recipe = model.connectPiston(recipe, 2, 3, { obstacles: kilnObstacle });

  assert.equal(recipe.pistons.length, 3);
  for (const [idx, p] of recipe.pistons.entries()) {
    assert.ok(Array.isArray(p.aOffset) && Array.isArray(p.bOffset), `Piston ${idx} has solved clevis offsets`);
    const env = travelEnvelope(recipe, p.a, p.b, 1e-3, p);
    assert.ok(env.max - env.min >= 0.06, `Piston ${idx} has positive stroke (${env.min.toFixed(3)} -> ${env.max.toFixed(3)})`);
  }
  const root = new T.Group(), view = createBodyView(root);
  view.update(recipe, 0);
  const m0 = view.manifest();
  assert.deepEqual(m0.warnings, [], 'All 3 section pistons fit single-stage barrels without rod poke-through');
  view.update(recipe, 1);
  view.dispose();
});

test('link-workshop section operation splits furnace door geometry and folds around stationary housing withUndo', async () => {
  const scene = new T.Group(), edits = createSceneEdits({ read() { throw Error('Missing'); }, write() { throw Error('Missing'); } });
  const session = { async attach(root) { scene.add(root); return { id: 'workshop', root }; }, redraw() {}, readView() { return {}; }, setView() {}, onFrame() { return () => {}; }, async dispose() { scene.clear(); } };
  const win = { kaminosSceneEdits: edits, kaminosSelection: { set() {}, read: () => ({ activeId: 'workshop' }) } };
  const host = { scene: { async open() { return session; }, refreshPresentation() {} }, controls: { document: { defaultView: win }, components: { register() { return { changed(fn) { edits.cancel(); fn?.(); }, dispose() {} }; } } } };
  const source = furnaceAssembly({ mirrored: true });
  const rt = await workshop.create({ host, inputs: { recipe: source.recipe, bodies: source.geometry, mode: 'B' } });
  assert.equal(typeof rt.operations.section, 'function', 'workshop must expose section operation');
  await rt.operations.section({ joint: 1, count: 3 });
  const after = rt.read();
  assert.equal(after.recipe.nodes.filter(n => n.parent !== null).length, 3, 'door split into 3 hinged panels');
  assert.equal(after.recipe.pistons.length, 3, '3 clevis-solved section pistons');
  assert.equal(after.bodies.warnings.length, 0, 'all section pistons satisfy single-stage travel');
  assert.ok(after.bodies.replacements >= 11, `expected replacement bodies for housing, 3 door panels, pins, and pistons, got ${after.bodies.replacements}`);
  const exported = rt.operations.exportBodies();
  for (const id of ['link:1', 'link:2', 'link:3']) {
    const body = exported.bodies.find(b => b.id === id);
    assert.ok(body, `${id} present in exported bodies`);
    const json = JSON.stringify(body.object);
    assert.ok(json.includes('Door shell (section'), `${id} includes sectioned door shell`);
    assert.ok(json.includes('Clevis pin eye'), `${id} includes solved clevis lug`);
    assert.ok(json.includes('Mirrored shapes'), `${id} preserves bilateral mirror across kiln`);
  }
  const ray = new T.Raycaster(new T.Vector3(5, 2, -1.3), new T.Vector3(-1, 0, 0));
  assert.equal(ray.intersectObjects(scene.children, true)[0].object.name, 'Refractory back', 'Pose B folded 3-section door exposes hollow chamber');
  rt.operations.mode({ value: 'A' });
  assert.ok(ray.intersectObjects(scene.children, true)[0].object.name.startsWith('Door'), 'Pose A 3-section door seals kiln mouth');
  rt.operations.mode({ value: 'B' });
  rt.operations.fold({ joint: 3, point: [-1.45, 3.88], mode: 'B' });
  assert.equal(rt.read().bodies.warnings.length, 0, 'folding tip to a new roof point keeps piston clevises valid');
  edits.undo();
  edits.undo();
  assert.equal(rt.read().recipe.nodes.filter(n => n.parent !== null).length, 1, 'Undo restores single-panel door');
  edits.redo();
  assert.equal(rt.read().recipe.nodes.filter(n => n.parent !== null).length, 3, 'Redo restores 3-panel sectioned door');
  await rt.dispose();
});
