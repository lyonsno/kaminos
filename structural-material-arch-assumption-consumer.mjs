import { buildArchStructuralProxy } from './structural-material-arch-core.js';
import {
  stageArchSurfaceBatch,
  summarizeArchSurfaceUpdate,
} from './structural-material-arch-geometry-sidecar.js';

export const ARCH_ASSUMPTION_CONSUMER_SCHEMA = 'kaminos.structural-material.arch-assumption-mesh-consumer.v0';
export const ARCH_ASSUMPTION_PROFILE_SHA256 = 'c0f00a56608e11d9b38c1c4b020b272bf34f5f3b9bb5ad51599a3aad5e41699f';
export const ARCH_ASSUMPTION_CASES = Object.freeze([
  Object.freeze({ interiorMode: 'continuous', contactDepthMode: 'through-thickness' }),
  Object.freeze({ interiorMode: 'continuous', contactDepthMode: 'camera-facing-surface' }),
  Object.freeze({ interiorMode: 'radial-voussoir-joints', contactDepthMode: 'through-thickness' }),
  Object.freeze({ interiorMode: 'radial-voussoir-joints', contactDepthMode: 'camera-facing-surface' }),
]);

const CONTACT = Object.freeze({ x: 0.35, y: 0.2, patchRadius: 0.032 });
const FRACTURE_THRESHOLD = 0.04;

async function sha256(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

export async function verifyArchAssumptionProfileAndGlb(profileBytes, glbBytes, expectedProfileSha256 = ARCH_ASSUMPTION_PROFILE_SHA256) {
  const profileSha256 = await sha256(profileBytes);
  if (profileSha256 !== expectedProfileSha256) throw new Error(`profile payload SHA-256 mismatch: ${profileSha256} != ${expectedProfileSha256}`);
  const glbSha256 = await sha256(glbBytes);
  const profile = JSON.parse(new TextDecoder().decode(profileBytes));
  if (profile.source?.sha256 !== glbSha256) throw new Error(`embedded GLB source SHA-256 mismatch: ${profile.source?.sha256} != ${glbSha256}`);
  return { profile, profileSha256, glbSha256 };
}
export const ARCH_ASSUMPTION_CLAIM_CEILING = Object.freeze([
  'all four cases use one exact source mesh, profile, contact coordinate, force, and projection route',
  'camera-facing-surface is one inferred maximum-Z proxy layer, not triangle collision or measured pressure',
  'the radial-joint case is a counterfactual, not source-truth construction',
  'normalized CPU spring response and mesh displacement are expressive proxy outputs, not calibrated stone prediction',
  'no persistent fracture surface, gravity, floor collision, detached-body motion, GPU execution, or sound is represented',
]);

function meanSquaredDelta(left, right) {
  if (left.length !== right.length) throw new Error('matched surface projections must have equal vertex counts');
  let sum = 0;
  for (let index = 0; index < left.length; index += 1) sum += (left[index] - right[index]) ** 2;
  return sum / left.length;
}

export function buildArchAssumptionComparison(profile, sourcePositions, { force = 0.15, displayGain = 48 } = {}) {
  if (!Number.isFinite(force) || force <= 0) throw new Error('comparison force must be finite and positive');
  if (!profile?.source?.sha256) throw new Error('comparison requires an identified TRELLIS profile');
  if (!ArrayBuffer.isView(sourcePositions) || sourcePositions.length === 0 || sourcePositions.length % 3 !== 0) {
    throw new Error('comparison requires packed source mesh positions');
  }

  const cases = ARCH_ASSUMPTION_CASES.map(assumptions => {
    const state = buildArchStructuralProxy(profile, {
      layers: 3,
      depthMode: 'surface-envelope',
      interiorMode: assumptions.interiorMode,
      radialJointCount: 9,
      jointStiffnessRatio: 0.35,
      jointStrength: 0.025,
    });
    return {
      ...assumptions,
      profile,
      state,
      sourcePositions,
      load: {
        ...CONTACT,
        force,
        contactDepthMode: assumptions.contactDepthMode,
        iterations: 1200,
      },
    };
  });
  const updates = stageArchSurfaceBatch(cases, displayGain, { threshold: FRACTURE_THRESHOLD });
  const summarized = updates.map((update, index) => ({
    ...summarizeArchSurfaceUpdate(update),
    displayPositions: update.displayPositions,
    rawDisplacements: update.projection.rawDisplacements,
    loadedNodeCount: update.loadedNodeCount,
    unmappedVertexCount: update.projection.unmappedVertexCount,
  }));
  const reference = summarized[0];
  const find = (interiorMode, contactDepthMode) => summarized.find(item =>
    item.interiorMode === interiorMode && item.contact.contactDepthMode === contactDepthMode);
  const continuousFace = find('continuous', 'camera-facing-surface');
  const jointedThrough = find('radial-voussoir-joints', 'through-thickness');

  return {
    schema: ARCH_ASSUMPTION_CONSUMER_SCHEMA,
    sourceGlbSha256: profile.source.sha256,
    force,
    contact: CONTACT,
    contactCell: { column: reference.contact.column, row: reference.contact.row },
    displayGain,
    fractureThreshold: FRACTURE_THRESHOLD,
    cases: summarized,
    adjudication: {
      contactChangesProjection: meanSquaredDelta(reference.rawDisplacements, continuousFace.rawDisplacements) > 1e-12,
      interiorChangesProjection: meanSquaredDelta(reference.rawDisplacements, jointedThrough.rawDisplacements) > 1e-12,
      interpretation: 'the same TRELLIS surface receives distinct projected motion under the tested contact and interior assumptions; this establishes sensitivity, not which hidden contact or construction assumption is source-true',
    },
    claimCeiling: ARCH_ASSUMPTION_CLAIM_CEILING,
  };
}
