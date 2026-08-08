// Per-limb proportion correction: the generated casts draw distal limbs
// displaced from the authored plan (measured: coherent per-foot exit
// directions, 0.80-0.99 coherence on all eight feet). This module MEASURES
// a bounded per-foot rest-proportion translation from the exit field and
// applies it as a DECLARED correction - a proportion adjustment between
// authored skeleton and one specific cast, carried in receipts, never a
// pose DOF and never silent.
//
// The correction is only lawful because the failure was first decomposed:
// coherent displacement earns a translation; radial size mismatch would
// not (that would be laundering a volume deficit).

import { buildSurfaceIndex, sampleSurface } from './cast-registration-core.mjs';
import { pointInsideMesh } from './frame-link-core.mjs';
import { buildWindingIndex } from './winding-index-core.mjs';
import { applyChain } from './bone-containment-probe-core.mjs';

export const LIMB_PROPORTION_SCHEMA = 'kaminos.limb-proportion-correction.v0';

const COHERENCE_FLOOR = 0.6; // below this, exits are too radial to earn a translation

export function measureFootCorrections({
  bones,
  manifest,
  cast,
  chainTransforms,
  samplesPerBone = 30,
  maxCorrectionFraction = 0.05, // of cast RMS body scale
}) {
  const index = buildSurfaceIndex(cast);
  const inside = (cast.triangles.length / 3) > 50000
    ? buildWindingIndex(cast).inside
    : (px, py, pz) => pointInsideMesh(px, py, pz, cast);
  // Cast body scale for the bound.
  let mean = [0, 0, 0];
  const vc = cast.positions.length / 3;
  for (let i = 0; i < cast.positions.length; i += 3) {
    for (let k = 0; k < 3; k += 1) mean[k] += cast.positions[i + k];
  }
  mean = mean.map(v => v / vc);
  let rms = 0;
  for (let i = 0; i < cast.positions.length; i += 3) {
    rms += (cast.positions[i] - mean[0]) ** 2 + (cast.positions[i + 1] - mean[1]) ** 2 + (cast.positions[i + 2] - mean[2]) ** 2;
  }
  const bodyScale = Math.sqrt(rms / vc);
  const maxCorrection = bodyScale * maxCorrectionFraction;

  // Foot clusters: pedal bones split fore/hind x left/right in skeleton frame.
  const pedal = bones.filter(b => manifest.bone_to_region[b.name] === 'pedal');
  const centroidOf = g => {
    const c = [0, 0, 0]; const n = g.positions.length / 3;
    for (let i = 0; i < g.positions.length; i += 3) for (let k = 0; k < 3; k += 1) c[k] += g.positions[i + k];
    return c.map(v => v / n);
  };
  const cents = pedal.map(b => ({ b, c: centroidOf(b.geometry) }));
  const zmid = cents.reduce((a, e) => a + e.c[2], 0) / cents.length;
  const xmid = cents.reduce((a, e) => a + e.c[0], 0) / cents.length;
  const feet = {};
  for (const e of cents) {
    const name = `${e.c[2] > zmid ? 'fore' : 'hind'}-${e.c[0] > xmid ? 'left' : 'right'}`;
    (feet[name] ??= []).push(e.b);
  }

  const corrections = {};
  for (const [foot, list] of Object.entries(feet)) {
    let insideCount = 0; let total = 0;
    const exits = [];
    for (const bone of list) {
      let s;
      try { s = sampleSurface(bone.geometry, samplesPerBone); } catch { continue; }
      for (let i = 0; i < samplesPerBone; i += 1) {
        const p = applyChain([s[i * 3], s[i * 3 + 1], s[i * 3 + 2]], chainTransforms);
        total += 1;
        if (inside(p[0], p[1], p[2])) { insideCount += 1; continue; }
        const hit = index.nearest(p[0], p[1], p[2]);
        exits.push([p[0] - hit.point[0], p[1] - hit.point[1], p[2] - hit.point[2]]);
      }
    }
    const entry = {
      boneNames: list.map(b => b.name),
      insideFractionBefore: total ? Number((insideCount / total).toPrecision(6)) : null,
      translation: [0, 0, 0],
      magnitude: 0,
      coherence: null,
      earned: false,
      bounded: false,
    };
    if (exits.length >= 8) {
      const meanExit = [0, 0, 0];
      const dirs = exits.map(d => {
        const len = Math.hypot(...d) || 1e-12;
        return d.map(v => v / len);
      });
      for (const d of dirs) for (let k = 0; k < 3; k += 1) meanExit[k] += d[k];
      for (let k = 0; k < 3; k += 1) meanExit[k] /= dirs.length;
      const coherence = Math.hypot(...meanExit);
      entry.coherence = Number(coherence.toPrecision(4));
      if (coherence >= COHERENCE_FLOOR) {
        // Correction: pull opposite the mean exit by the mean exit depth.
        const depth = exits.reduce((a, d) => a + Math.hypot(...d), 0) / exits.length;
        const dirLen = Math.hypot(...meanExit);
        let t = meanExit.map(v => (-v / dirLen) * depth);
        const mag = Math.hypot(...t);
        if (mag > maxCorrection) {
          entry.bounded = true;
          t = t.map(v => (v * maxCorrection) / mag);
        }
        entry.translation = t.map(v => Number(v.toPrecision(6)));
        entry.magnitude = Number(Math.hypot(...t).toPrecision(6));
        entry.earned = true;
      }
    }
    // After: re-probe with correction applied.
    if (entry.earned) {
      let insideAfter = 0; let totalAfter = 0;
      for (const bone of list) {
        let s;
        try { s = sampleSurface(bone.geometry, samplesPerBone); } catch { continue; }
        for (let i = 0; i < samplesPerBone; i += 1) {
          const p = applyChain([s[i * 3], s[i * 3 + 1], s[i * 3 + 2]], chainTransforms);
          totalAfter += 1;
          if (inside(p[0] + entry.translation[0], p[1] + entry.translation[1], p[2] + entry.translation[2])) insideAfter += 1;
        }
      }
      entry.insideFractionAfter = totalAfter ? Number((insideAfter / totalAfter).toPrecision(6)) : null;
    }
    corrections[foot] = entry;
  }
  return {
    schema: LIMB_PROPORTION_SCHEMA,
    bodyScale: Number(bodyScale.toPrecision(6)),
    maxCorrectionFraction,
    coherenceFloor: COHERENCE_FLOOR,
    corrections,
    authority: 'measured rest-proportion adjustment between authored skeleton and this exact cast; declared, bounded, never a pose DOF; earned only by coherent displacement',
  };
}
