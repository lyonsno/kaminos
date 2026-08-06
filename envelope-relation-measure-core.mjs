/**
 * Measure low-frequency morphological relations from a triangle mesh.
 *
 * The envelope preservation contract asserts against geometry, not against any
 * particular compiler. Any envelope -- morphological closing, hand-authored,
 * Trellis-derived, learned -- is measured the same way, so the measurement is
 * decoupled from the compiler, from CMK, and from the authoring tools.
 *
 * Tier 2 relations are instrumented, not gated. This module computes and
 * reports; it does not judge. No preservation tolerance is defined here,
 * deliberately: no decision currently depends on one, and fixing a threshold
 * before observing an envelope that actually preserves anything would assert
 * what counts as "preserved" ahead of the evidence.
 *
 * Relation list and rationale are recorded in the envelope preservation
 * contract held in project coordination state.
 */

/**
 * Anatomical frame, measured from the repaired cat source (Kaminos a6056702).
 * These are measured asset axes, never convention guesses -- guessing the
 * camera convention is the exact defect the 2026-08-05 source repair corrected.
 */
export const CAT_ANATOMICAL_FRAME = Object.freeze({
  right: Object.freeze([1, 0, 0]),
  anterior: Object.freeze([0, -1, 0]),
  dorsal: Object.freeze([0, 0, -1]),
});

const AXIS_INDEX = Object.freeze({ x: 0, y: 1, z: 2 });

function axisOf(vector) {
  let index = -1;
  for (let i = 0; i < 3; i += 1) {
    if (vector[i] !== 0) {
      if (index !== -1) {
        throw new Error('frame axes must be cardinal; got a non-cardinal vector');
      }
      index = i;
    }
  }
  if (index === -1) {
    throw new Error('frame axis vector is degenerate');
  }
  return { index, sign: Math.sign(vector[index]) };
}

/**
 * Resolve a measurement frame into axis indices and orientation signs.
 * Returns which array index carries the anterior-posterior, dorsoventral, and
 * mediolateral extents, plus the sign that points anterior/dorsal/right.
 */
export function resolveFrame(frame = CAT_ANATOMICAL_FRAME) {
  const anterior = axisOf(frame.anterior);
  const dorsal = axisOf(frame.dorsal);
  const right = axisOf(frame.right);
  const indices = new Set([anterior.index, dorsal.index, right.index]);
  if (indices.size !== 3) {
    throw new Error('frame axes must be mutually distinct');
  }
  return {
    anteriorPosterior: anterior,
    dorsoVentral: dorsal,
    medioLateral: right,
  };
}

/**
 * Triangle area in 3D. Used to weight cross-section contributions so that a
 * dense mesh region does not outvote a sparse one purely by vertex count.
 */
function triangleArea(a, b, c) {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const cx = uy * vz - uz * vy;
  const cy = uz * vx - ux * vz;
  const cz = ux * vy - uy * vx;
  return 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
}

function centroidOf(a, b, c) {
  return [
    (a[0] + b[0] + c[0]) / 3,
    (a[1] + b[1] + c[1]) / 3,
    (a[2] + b[2] + c[2]) / 3,
  ];
}

/**
 * Build an area-weighted profile along the anterior-posterior axis.
 *
 * Each slice records the surface area falling inside it, the dorsoventral and
 * mediolateral extent of that area, and its centroid. Depth, mass distribution,
 * and fore/aft ratio all derive from this profile, so a single traversal
 * supports every Tier 2 relation.
 *
 * Fails loud on a degenerate or empty mesh rather than returning a plausible
 * empty profile -- a blank measurement must not be able to look like evidence.
 */
export function axialProfile(mesh, { sliceCount = 48, frame = CAT_ANATOMICAL_FRAME } = {}) {
  if (!mesh || !Array.isArray(mesh.positions) || !Array.isArray(mesh.triangles)) {
    throw new Error('mesh must supply positions and triangles');
  }
  if (mesh.triangles.length === 0) {
    throw new Error('mesh contains no triangles; refusing to emit an empty profile');
  }
  if (!Number.isInteger(sliceCount) || sliceCount < 2) {
    throw new Error('sliceCount must be an integer >= 2');
  }

  const resolved = resolveFrame(frame);
  const apIndex = resolved.anteriorPosterior.index;
  const apSign = resolved.anteriorPosterior.sign;
  const dvIndex = resolved.dorsoVentral.index;
  const mlIndex = resolved.medioLateral.index;

  let apLow = Infinity;
  let apHigh = -Infinity;
  for (const position of mesh.positions) {
    const value = position[apIndex] * apSign;
    if (value < apLow) apLow = value;
    if (value > apHigh) apHigh = value;
  }
  const span = apHigh - apLow;
  if (!(span > 0)) {
    throw new Error('mesh is degenerate along the anterior-posterior axis');
  }

  const slices = Array.from({ length: sliceCount }, () => ({
    area: 0,
    dorsoVentralMin: Infinity,
    dorsoVentralMax: -Infinity,
    medioLateralMin: Infinity,
    medioLateralMax: -Infinity,
  }));

  let totalArea = 0;
  for (const triangle of mesh.triangles) {
    const a = mesh.positions[triangle[0]];
    const b = mesh.positions[triangle[1]];
    const c = mesh.positions[triangle[2]];
    if (!a || !b || !c) {
      throw new Error('triangle references a missing vertex');
    }
    const area = triangleArea(a, b, c);
    if (!(area > 0)) continue;
    const centroid = centroidOf(a, b, c);
    // Normalized anterior-posterior station: 0 at the posterior end,
    // 1 at the anterior end, in the measured frame's orientation.
    const station = (centroid[apIndex] * apSign - apLow) / span;
    const bucket = Math.min(sliceCount - 1, Math.max(0, Math.floor(station * sliceCount)));
    const slice = slices[bucket];
    slice.area += area;
    for (const vertex of [a, b, c]) {
      if (vertex[dvIndex] < slice.dorsoVentralMin) slice.dorsoVentralMin = vertex[dvIndex];
      if (vertex[dvIndex] > slice.dorsoVentralMax) slice.dorsoVentralMax = vertex[dvIndex];
      if (vertex[mlIndex] < slice.medioLateralMin) slice.medioLateralMin = vertex[mlIndex];
      if (vertex[mlIndex] > slice.medioLateralMax) slice.medioLateralMax = vertex[mlIndex];
    }
    totalArea += area;
  }

  if (!(totalArea > 0)) {
    throw new Error('mesh has no positive-area triangles');
  }

  return {
    sliceCount,
    axialSpan: span,
    totalArea,
    slices: slices.map((slice, index) => ({
      index,
      station: (index + 0.5) / sliceCount,
      area: slice.area,
      areaFraction: slice.area / totalArea,
      dorsoVentralExtent: slice.area > 0 ? slice.dorsoVentralMax - slice.dorsoVentralMin : 0,
      medioLateralExtent: slice.area > 0 ? slice.medioLateralMax - slice.medioLateralMin : 0,
    })),
  };
}

/**
 * Derive the Tier 2 proportional relations from an axial profile.
 *
 * Every value is dimensionless -- a ratio or a normalized station -- so source
 * and envelope stay comparable without depending on shared scene scale, which
 * the source's own manifest warns does not establish real-world size.
 */
export function proportionalRelations(profile) {
  if (!profile || !Array.isArray(profile.slices) || profile.slices.length === 0) {
    throw new Error('profile must supply slices');
  }

  const slices = profile.slices;
  const midpoint = 0.5;

  let anteriorArea = 0;
  let posteriorArea = 0;
  let weightedStation = 0;
  for (const slice of slices) {
    if (slice.station >= midpoint) anteriorArea += slice.area;
    else posteriorArea += slice.area;
    weightedStation += slice.station * slice.area;
  }
  if (!(anteriorArea > 0) || !(posteriorArea > 0)) {
    throw new Error('profile has no area on one side of the axial midpoint');
  }

  const maxDorsoVentral = Math.max(...slices.map((slice) => slice.dorsoVentralExtent));
  const maxMedioLateral = Math.max(...slices.map((slice) => slice.medioLateralExtent));

  return {
    // Relation 6: relative fore/aft mass.
    shoulderToHaunchRatio: anteriorArea / posteriorArea,
    // Relation 8: where the mass sits along the axis. < 0.5 is posterior-heavy.
    massCentroidStation: weightedStation / profile.totalArea,
    // Relation 7: body depth at its deepest, normalized against axial span.
    thoracicDepthRatio: maxDorsoVentral / profile.axialSpan,
    // Relation 10: lateral spread, normalized against axial span.
    shoulderSeparationRatio: maxMedioLateral / profile.axialSpan,
    // Supporting shape descriptor: how concentrated the mass is along the axis.
    axialConcentration: Math.max(...slices.map((slice) => slice.areaFraction)),
  };
}

/**
 * Compare source relations against envelope relations.
 *
 * Reports source value, envelope value, signed delta, and relative delta for
 * every relation. Emits no verdict: Tier 2 is instrumented, not gated.
 */
export function compareRelations(sourceRelations, envelopeRelations) {
  const keys = Object.keys(sourceRelations);
  const missing = keys.filter((key) => !(key in envelopeRelations));
  if (missing.length > 0) {
    throw new Error(`envelope relations are missing measured keys: ${missing.join(', ')}`);
  }
  const comparisons = {};
  for (const key of keys) {
    const source = sourceRelations[key];
    const envelope = envelopeRelations[key];
    comparisons[key] = {
      source,
      envelope,
      delta: envelope - source,
      relativeDelta: source === 0 ? null : (envelope - source) / Math.abs(source),
    };
  }
  return comparisons;
}

/**
 * Adjudicate a perturbation pair against the *source's own* coupling.
 *
 * This is the contract's one hard assertion, and it is ordinal rather than
 * absolute, so it needs no tolerance.
 *
 * An earlier version of this rule required every relation other than the
 * perturbed one to move less than the target. That was wrong, and the fixtures
 * caught it: deepening a thorax moves fore/aft mass ratio *more* than it moves
 * the depth ratio, because a deeper thorax genuinely puts more mass forward.
 * These relations are not orthogonal and cannot be -- they are load-bearing
 * relations in one connected body, which is the premise of the whole program.
 * A locality rule that assumes independence encodes an anatomy the domain
 * forbids.
 *
 * The correct comparison is against the source, not against zero. Editing the
 * source produces a coupled response; a faithful envelope should reproduce
 * *that* response. So:
 *
 *   - the envelope's target relation must move in the requested direction;
 *   - every relation's envelope shift must track the shift the same edit
 *     produced in the source -- same sign, and no relation may move
 *     disproportionately further than the source moved it.
 *
 * An envelope that invents motion the source did not have, or that flattens
 * motion the source did have, fails. An envelope that reproduces the source's
 * own coupling passes, however coupled that happens to be.
 */
export function adjudicatePerturbation({
  baselineComparison,
  perturbedComparison,
  perturbedRelation,
  expectedDirection,
  couplingSlack = 2.0,
}) {
  if (!baselineComparison || !perturbedComparison) {
    throw new Error('both baseline and perturbed comparisons are required');
  }
  if (!(perturbedRelation in baselineComparison)) {
    throw new Error(`perturbed relation is not measured: ${perturbedRelation}`);
  }
  if (expectedDirection !== 1 && expectedDirection !== -1) {
    throw new Error('expectedDirection must be 1 or -1');
  }
  if (!(couplingSlack >= 1)) {
    throw new Error('couplingSlack must be >= 1');
  }

  const envelopeShift = (key) =>
    perturbedComparison[key].envelope - baselineComparison[key].envelope;
  const sourceShift = (key) =>
    perturbedComparison[key].source - baselineComparison[key].source;

  const targetShift = envelopeShift(perturbedRelation);
  const directionHeld = Math.sign(targetShift) === expectedDirection;

  // Scale below which a shift is treated as numerically inert rather than
  // meaningful, derived from the source's own largest response to this edit.
  const sourceScale = Math.max(
    ...Object.keys(baselineComparison).map((key) => Math.abs(sourceShift(key))),
  );
  const inert = sourceScale * 1e-6;

  const tracking = Object.keys(baselineComparison).map((key) => {
    const envelope = envelopeShift(key);
    const source = sourceShift(key);
    const bothInert = Math.abs(envelope) <= inert && Math.abs(source) <= inert;
    const signAgrees = bothInert || Math.sign(envelope) === Math.sign(source);
    const overshoot =
      Math.abs(source) <= inert
        ? Math.abs(envelope) <= inert
        : Math.abs(envelope) <= Math.abs(source) * couplingSlack;
    return {
      relation: key,
      envelopeShift: envelope,
      sourceShift: source,
      signAgrees,
      withinCoupling: overshoot,
      held: signAgrees && overshoot,
    };
  });

  const couplingViolations = tracking.filter((entry) => !entry.held);

  return {
    perturbedRelation,
    expectedDirection,
    targetShift,
    directionHeld,
    couplingHeld: couplingViolations.length === 0,
    couplingViolations,
    tracking,
    passed: directionHeld && couplingViolations.length === 0,
  };
}
