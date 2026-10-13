// Bring your own rig: a rigged .glb to a skeleton UniMate can animate, in the browser.
//
//   readRig(bytes)                     the skeleton UniMate's preprocessing would export
//                                      (unimate-rig-glb.js importRig)
//   labeler.label(rig)                 joint labels and facing pair from UniMate's own rule
//                                      labeller (unimate-rig-labels.js, Pyodide)
//   buildSkeletonBundle(rig, labels)   canonical rest pose, topology, spectral features and
//                                      normalized tpos (unimate-rig-features.js), plus T5
//                                      embeddings of the labels, as an in-memory bundle in the
//                                      shape demo.useSkeletonData() takes (export-demo-bundle.py's
//                                      arrays and skeleton index).
import { importRig, parseGlb } from './unimate-rig-glb.js';
import { bfsOrder, canonicalizeRest, canonicalTransform, skeletonConditioning, MAX_JOINTS } from './unimate-rig-features.js';
import { extractSkinnedMesh } from './unimate-rig-mesh.js';

// skinIndex: which skin to read when the file has several (default: the one with most joints).
export function readRig(bytes, { skinIndex = null } = {}) {
  const gltf = parseGlb(bytes);
  const rig = importRig(gltf, { skinIndex });
  Object.defineProperty(rig, 'gltf', { value: gltf, enumerable: false });
  rig.skins = gltf.json.skins.map((s, i) => ({ index: i, name: s.name ?? `skin ${i}`, joints: s.joints.length }));
  rig.skinIndex = skinIndex ?? gltf.json.skins.reduce((best, s, i) => (s.joints.length > gltf.json.skins[best].joints.length ? i : best), 0);
  if (rig.names.length < 2) throw new Error('the rig needs at least 2 joints');
  if (rig.names.length > MAX_JOINTS) throw new Error(`UniMate animates up to ${MAX_JOINTS} joints; this rig has ${rig.names.length} after pruning`);
  return rig;
}

// A rest pose authored lying down or upside down, stood up the way rig_preprocess's
// --rest_rotation does: spec is comma-separated axis turns applied in order ('x180', 'x90',
// 'x-90', 'x90,y180'), in degrees about the export's Y-up axes; the whole rest pose turns
// rigidly with the root's rest transform. Returns a new rig (labels must be redone on it).
export function quatFromTurns(spec) {
  let q = [1, 0, 0, 0];
  for (const part of spec.split(',').map(x => x.trim().toLowerCase()).filter(Boolean)) {
    const m = part.match(/^([xyz])\s*([+-]?\d+(?:\.\d+)?)$/);
    if (!m) throw new Error(`rest rotation ${spec}: expected turns like 'x180' or 'x90,y180'`);
    const half = (Number(m[2]) * Math.PI) / 360, axis = [0, 0, 0];
    axis['xyz'.indexOf(m[1])] = 1;
    const t = [Math.cos(half), ...axis.map(v => Math.sin(half) * v)];
    q = qmul(t, q);
  }
  const n = Math.hypot(...q);
  return q.map(v => v / n);
}
function qmul([w1, x1, y1, z1], [w2, x2, y2, z2]) {
  return [w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2, w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
    w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2, w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2];
}
function qrot(q, v) { return qmul(qmul(q, [0, ...v]), [q[0], -q[1], -q[2], -q[3]]).slice(1); }
export function turnRest(rig, spec) {
  if (!spec) return rig;
  const q = quatFromTurns(spec);
  const restLocalPos = rig.restLocalPos.map((p, j) => (j === 0 ? qrot(q, p) : p));
  const restLocalRot = rig.restLocalRot.map((r, j) => (j === 0 ? qmul(q, r) : r));
  // The mesh's bind turns with the skeleton.
  const rotOf = r => [qrot(q, r[0]), qrot(q, r[1]), qrot(q, r[2])];
  const skinBind = rig.skinBind?.map(b => (b.restWorld ? { ...b, restWorld: { r: rotOf(b.restWorld.r), t: qrot(q, b.restWorld.t) } } : b));
  const turned = { ...rig, positions: rig.positions.map(p => qrot(q, p)), restLocalPos, restLocalRot, restRotation: spec, skinBind };
  Object.defineProperty(turned, 'gltf', { value: rig.gltf, enumerable: false });
  return turned;
}

// labels: { clean: label per joint in rig order, face: { right, left, bodyAxis } (rig indices) or null }.
// embed(text) -> Float32Array(768), the pooled T5 encoding (called once per distinct label).
// motion: { frames, outputTimes } of the model (from any published skeleton bundle).
export async function buildSkeletonBundle(rig, labels, { embed, motion, name = 'Your rig' }) {
  const { order, parents } = bfsOrder(rig.parents, rig.positions);
  const at = new Map(order.map((old, i) => [old, i]));
  const rest = order.map(i => rig.positions[i]);
  const face = labels.face ? { right: at.get(labels.face.right), left: at.get(labels.face.left), bodyAxis: labels.face.bodyAxis } : null;
  const canonical = canonicalizeRest(rest, parents, face);
  // The rig's skinned mesh, bound to this canonical skeleton (null when the file has none).
  const mesh = rig.gltf ? extractSkinnedMesh(rig.gltf, rig, { order }, canonicalTransform(rest, parents, face)) : null;
  const c = skeletonConditioning({ rest: canonical, parents });
  const clean = order.map(i => labels.clean[i]);
  const cache = new Map();
  const jointNamesEmb = new Float32Array(clean.length * 768);
  for (let j = 0; j < clean.length; j++) {
    if (!cache.has(clean[j])) cache.set(clean[j], await embed(clean[j]));
    jointNamesEmb.set(cache.get(clean[j]), j * 768);
  }
  const b = {
    schema: 'kaminos.unimate.demo-bundle.v0',
    skeleton: { name, joints: clean.length, parents, jointNames: order.map(i => rig.names[i]), cleanJointNames: clean, fps: 30, frames: motion.frames },
    motionLength: motion.frames,
    outputTimes: motion.outputTimes,
    prompts: [],
    imported: { pruned: rig.pruned, facing: face, source: 'browser rig importer' },
  };
  const a = { tpos: c.tpos, tposParents: c.tposParents, depths: c.depths, jointNamesEmb, spectral: c.spectral, graphDist: c.graphDist,
    jointRelations: c.jointRelations, mean: c.mean, std: c.std, restPositions: c.restPositions };
  return { b, a, mesh };
}
