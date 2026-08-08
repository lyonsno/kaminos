/**
 * Detect a mesh's anatomical frame from its own geometry.
 *
 * The problem this solves: comparing an authored envelope against a
 * reconstructed cast requires knowing which world axis is mediolateral in each
 * mesh. They routinely differ — a GLB export applies a Y-up conversion, a
 * reconstructor uses its own convention — so a harness that assigns axes by
 * extent alone can label different anatomical directions "mediolateral" in the
 * two meshes and compare quantities that are not comparable.
 *
 * The fix uses a frame-independent anatomical fact: **a quadruped is
 * bilaterally symmetric about its mediolateral axis, and about no other.**
 * Symmetry is a property of the geometry, not of the coordinate system, so it
 * identifies the axis in whatever frame the mesh happens to arrive in.
 *
 * Anterior-posterior is then the longer of the two remaining axes and
 * dorsoventral is the last, because a quadruped is longer nose-to-tail than it
 * is tall.
 *
 * Deliberately NOT used: extent ordering alone (the defect above), or any
 * assumed export convention (silently wrong when a tool changes).
 */

/** Histogram symmetry of the point distribution about an axis's own midpoint. */
function symmetryScore(points, axis, bins = 64) {
  const values = points.map((p) => p[axis]);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const histogram = new Array(bins).fill(0);
  for (const value of values) {
    const t = (value - lo) / span;
    histogram[Math.min(bins - 1, Math.floor(t * bins))] += 1;
  }
  let difference = 0;
  let total = 0;
  for (let i = 0; i < bins; i += 1) {
    const mirror = bins - 1 - i;
    difference += Math.abs(histogram[i] - histogram[mirror]);
    total += histogram[i] + histogram[mirror];
  }
  return 1 - difference / (total || 1);
}

/**
 * @returns {{
 *   medioLateral: number, anteriorPosterior: number, dorsoVentral: number,
 *   symmetry: number[], extents: number[], confidence: number, sane: boolean,
 *   sanityNotes: string[]
 * }}
 */
export function detectAnatomicalFrame(points) {
  if (!Array.isArray(points) || points.length === 0) {
    throw new Error('detectAnatomicalFrame requires a non-empty point array');
  }
  const extents = [0, 1, 2].map(
    (i) => Math.max(...points.map((p) => p[i])) - Math.min(...points.map((p) => p[i])),
  );
  const symmetry = [0, 1, 2].map((i) => symmetryScore(points, i));

  const medioLateral = symmetry.indexOf(Math.max(...symmetry));
  const remaining = [0, 1, 2].filter((i) => i !== medioLateral);
  const anteriorPosterior =
    extents[remaining[0]] >= extents[remaining[1]] ? remaining[0] : remaining[1];
  const dorsoVentral = remaining.find((i) => i !== anteriorPosterior);

  // Margin between the chosen mediolateral axis and the next most symmetric.
  // A small margin means the detection is not well determined and the caller
  // should not treat downstream depth numbers as scored.
  const sorted = [...symmetry].sort((a, b) => b - a);
  const confidence = sorted[0] - sorted[1];

  // Falsifiers. A correct quadruped frame is longer than it is tall, and
  // narrower across than it is long. If either fails, the detection is
  // reported unsane rather than silently used.
  const apOverDv = extents[anteriorPosterior] / (extents[dorsoVentral] || 1);
  const mlOverAp = extents[medioLateral] / (extents[anteriorPosterior] || 1);
  const sanityNotes = [];
  if (!(apOverDv > 1)) {
    sanityNotes.push(`anterior-posterior/dorsoventral ${apOverDv.toFixed(2)} is not > 1`);
  }
  if (!(mlOverAp < 1)) {
    sanityNotes.push(`mediolateral/anterior-posterior ${mlOverAp.toFixed(2)} is not < 1`);
  }

  return {
    medioLateral,
    anteriorPosterior,
    dorsoVentral,
    symmetry,
    extents,
    confidence,
    sane: sanityNotes.length === 0,
    sanityNotes,
    apOverDv,
    mlOverAp,
  };
}

export { symmetryScore };
