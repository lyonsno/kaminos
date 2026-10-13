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
import { bfsOrder, canonicalizeRest, skeletonConditioning, MAX_JOINTS } from './unimate-rig-features.js';

export function readRig(bytes) {
  const rig = importRig(parseGlb(bytes));
  if (rig.names.length < 2) throw new Error('the rig needs at least 2 joints');
  if (rig.names.length > MAX_JOINTS) throw new Error(`UniMate animates up to ${MAX_JOINTS} joints; this rig has ${rig.names.length} after pruning`);
  return rig;
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
  return { b, a };
}
