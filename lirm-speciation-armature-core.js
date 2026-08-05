import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { createSignedDistanceField } from './lirm-silhouette-archetype-corpus-core.js';

export const LIRM_SPECIATION_ARMATURE_WITNESS_SCHEMA = 'kaminos.lirm-speciation-armature-witness.v0';
export const LIRM_SPECIATION_ARMATURE_CANDIDATE_SCHEMA = 'kaminos.lirm-speciation-armature-candidate.v0';
export const LIRM_SPECIATION_ARMATURE_RECEIPT_SCHEMA = 'kaminos.lirm-speciation-armature-receipt.v0';
export const LIRM_SPECIATION_ARMATURE_CONTROL_PACKET_SCHEMA = 'kaminos.lirm-speciation-armature-control-packet.v0';
export const LIRM_SPECIATION_ARMATURE_PROXY_RENDER_BUNDLE_SCHEMA = 'kaminos.lirm-speciation-armature-proxy-render-bundle.v0';
export const LIRM_SPECIATION_ARMATURE_PROXY_RENDER_WITNESS_SCHEMA = 'kaminos.lirm-speciation-armature-proxy-render-witness.v0';
export const LIRM_SPECIATION_ARMATURE_IMPLICIT_BODY_BUNDLE_SCHEMA = 'kaminos.lirm-speciation-armature-implicit-body-bundle.v0';
export const LIRM_SPECIATION_ARMATURE_IMPLICIT_BODY_WITNESS_SCHEMA = 'kaminos.lirm-speciation-armature-implicit-body-witness.v0';
export const LIRM_SPECIATION_ARMATURE_CONDITIONING_PACKAGE_SCHEMA = 'kaminos.lirm-speciation-armature-conditioning-package.v0';
export const LIRM_SPECIATION_ARMATURE_CONDITIONING_PACKAGE_WITNESS_SCHEMA = 'kaminos.lirm-speciation-armature-conditioning-package-witness.v0';
export const LIRM_SPECIATION_ARMATURE_ROUTE = 'kaminos/lirm-speciation-armature/contact-sheet-v0';
export const LIRM_SPECIATION_ARMATURE_CONTROL_PACKET_ROUTE = 'kaminos/lirm-speciation-armature/control-packet-v0';
export const LIRM_SPECIATION_ARMATURE_PROXY_RENDER_ROUTE = 'kaminos/lirm-speciation-armature/proxy-render-v0';
export const LIRM_SPECIATION_ARMATURE_IMPLICIT_BODY_ROUTE = 'kaminos/lirm-speciation-armature/implicit-body-v0';
export const LIRM_SPECIATION_ARMATURE_CONDITIONING_PACKAGE_ROUTE = 'kaminos/lirm-speciation-armature/conditioning-package-v0';
export const LIRM_SPECIATION_ARMATURE_WRITE_RESULT_SCHEMA = 'kaminos.lirm-speciation-armature-write-result.v0';
export const LIRM_SPECIATION_ARMATURE_PROXY_RENDER_WRITE_RESULT_SCHEMA = 'kaminos.lirm-speciation-armature-proxy-render-write-result.v0';
export const LIRM_SPECIATION_ARMATURE_IMPLICIT_BODY_WRITE_RESULT_SCHEMA = 'kaminos.lirm-speciation-armature-implicit-body-write-result.v0';
export const LIRM_SPECIATION_ARMATURE_GESTALT_COMPOSITE_BUNDLE_SCHEMA = 'kaminos.lirm-speciation-armature-gestalt-composite-bundle.v0';
export const LIRM_SPECIATION_ARMATURE_GESTALT_COMPOSITE_WITNESS_SCHEMA = 'kaminos.lirm-speciation-armature-gestalt-composite-witness.v0';
export const LIRM_SPECIATION_ARMATURE_GESTALT_COMPOSITE_WRITE_RESULT_SCHEMA = 'kaminos.lirm-speciation-armature-gestalt-composite-write-result.v0';
export const LIRM_SPECIATION_ARMATURE_GESTALT_COMPOSITE_ROUTE = 'kaminos/lirm-speciation-armature/gestalt-composite-v0';
export const LIRM_SPECIATION_ARMATURE_CONDITIONING_PACKAGE_WRITE_RESULT_SCHEMA = 'kaminos.lirm-speciation-armature-conditioning-package-write-result.v0';
export const LIRM_ARMATURE_PROGRAM_IMPLICIT_BODY_BUNDLE_SCHEMA = 'kaminos.lirm-armature-program-implicit-body-bundle.v0';
export const LIRM_ARMATURE_PROGRAM_IMPLICIT_BODY_WITNESS_SCHEMA = 'kaminos.lirm-armature-program-implicit-body-witness.v0';
export const LIRM_ARMATURE_PROGRAM_IMPLICIT_BODY_WRITE_RESULT_SCHEMA = 'kaminos.lirm-armature-program-implicit-body-write-result.v0';
export const LIRM_ARMATURE_PROGRAM_IMPLICIT_BODY_ROUTE = 'kaminos/lirm-armature-program/implicit-body-v0';

const ROOT_PARENT_ID = 'root-soft-crawling-hoard-thief';
const DEFAULT_SEED = 'molten-lirm-speciation-armature-v0';
const DEFAULT_CANDIDATE_COUNT = 25;
const DEFAULT_COLUMNS = 5;
const CONTROL_PRESSURE_KIND = 'semantic-adherence-silhouette-fall-forward-v0';

const GESTALT_ARCHETYPES = [
  {
    kind: 'lirm-slug-loaf',
    label: 'slug loaf',
    silhouetteClass: 'broad-belly-loaf',
    priorHooks: ['slug', 'soft loaf body', 'low crawling belly', 'wet clay'],
    mods: { segments: -1, limbs: -2, armor: -0.26, curve: -0.03, head: -0.08, contact: 0.18, belly: 0.18, bulk: 0.28, length: 0.08 },
    silhouette: { headScale: 0.82, bellyScale: 1.45, tailScale: 0.72, widthScale: 1.32, heightScale: 0.72, dorsalLift: -0.04, mouthOffset: 0.06 },
  },
  {
    kind: 'lirm-tadpole-pouch',
    label: 'tadpole pouch',
    silhouetteClass: 'big-head-taper-tail',
    priorHooks: ['tadpole', 'pouch body', 'front-heavy larva', 'thin tail'],
    mods: { segments: -2, limbs: -1, armor: -0.18, curve: 0.02, head: 0.26, contact: -0.02, belly: 0.1, bulk: 0.16, length: -0.02 },
    silhouette: { headScale: 1.72, bellyScale: 1.12, tailScale: 0.42, widthScale: 1.05, heightScale: 1.02, dorsalLift: 0.04, mouthOffset: 0.085 },
  },
  {
    kind: 'lirm-pillbug-dome',
    label: 'pillbug dome',
    silhouetteClass: 'armored-oval-dome',
    priorHooks: ['pillbug', 'armored larva', 'domed shell', 'compact oval'],
    mods: { segments: 1, limbs: -2, armor: 0.24, curve: -0.015, head: -0.02, contact: 0.08, belly: -0.02, bulk: 0.2, length: -0.1 },
    silhouette: { headScale: 0.74, bellyScale: 1.25, tailScale: 0.86, widthScale: 1.24, heightScale: 1.14, dorsalLift: -0.08, mouthOffset: 0.052 },
  },
  {
    kind: 'lirm-thread-centipede',
    label: 'thread centipede',
    silhouetteClass: 'long-many-legged-thread',
    priorHooks: ['centipede', 'thin segmented body', 'many tiny legs', 'threadlike crawler'],
    mods: { segments: 3, limbs: 3, armor: -0.08, curve: 0.015, head: -0.05, contact: -0.12, belly: -0.04, bulk: -0.2, length: 0.16 },
    silhouette: { headScale: 0.82, bellyScale: 0.7, tailScale: 0.62, widthScale: 0.66, heightScale: 0.78, dorsalLift: 0.0, mouthOffset: 0.06 },
  },
  {
    kind: 'lirm-comma-grub',
    label: 'comma grub',
    silhouetteClass: 'curled-comma-grub',
    priorHooks: ['curled grub', 'comma body', 'asymmetric larva', 'fat bend'],
    mods: { segments: 1, limbs: 0, armor: -0.05, curve: 0.07, head: 0.08, contact: 0.04, belly: 0.14, bulk: 0.12, length: 0.04, asymmetry: 0.08 },
    silhouette: { headScale: 1.08, bellyScale: 1.34, tailScale: 0.58, widthScale: 1.06, heightScale: 0.92, dorsalLift: 0.05, mouthOffset: 0.075 },
  },
  {
    kind: 'lirm-trilobite-flat',
    label: 'trilobite flatback',
    silhouetteClass: 'flat-wide-side-plates',
    priorHooks: ['trilobite', 'flat armored back', 'side plates', 'ancient arthropod'],
    mods: { segments: 2, limbs: 2, armor: 0.18, curve: -0.02, head: -0.03, contact: 0.1, belly: -0.12, bulk: 0.04, length: 0.02 },
    silhouette: { headScale: 0.88, bellyScale: 1.18, tailScale: 0.78, widthScale: 1.46, heightScale: 0.56, dorsalLift: -0.02, mouthOffset: 0.056 },
  },
  {
    kind: 'lirm-larval-quad',
    label: 'larval quadruped',
    silhouetteClass: 'stub-legged-ground-beast',
    priorHooks: ['stub-legged larva', 'small quadruped', 'ground beast', 'brace feet'],
    mods: { segments: -1, limbs: 1, armor: 0.04, curve: 0.005, head: 0.12, contact: 0.02, belly: 0.0, bulk: 0.08, length: -0.04 },
    silhouette: { headScale: 1.16, bellyScale: 1.05, tailScale: 0.64, widthScale: 0.95, heightScale: 1.08, dorsalLift: 0.09, mouthOffset: 0.07 },
  },
  {
    kind: 'lirm-shell-kite',
    label: 'shell kite',
    silhouetteClass: 'wide-diamond-shell',
    priorHooks: ['wide shell', 'diamond silhouette', 'raylike crawler', 'thin underbody'],
    mods: { segments: -2, limbs: 0, armor: 0.16, curve: -0.035, head: -0.04, contact: 0.12, belly: -0.08, bulk: -0.02, length: -0.12 },
    silhouette: { headScale: 0.72, bellyScale: 1.55, tailScale: 0.72, widthScale: 1.72, heightScale: 0.5, dorsalLift: -0.03, mouthOffset: 0.05 },
  },
];

const FALL_FORWARD_MODES = [
  {
    kind: 'match-scaffold',
    silhouetteLatitude: 0.38,
    priorInvitation: 0.42,
    hooks: ['preserve the scaffold silhouette', 'tight anatomical match', 'low mutation'],
  },
  {
    kind: 'basin-elaboration',
    silhouetteLatitude: 0.56,
    priorInvitation: 0.62,
    hooks: ['invent plausible anatomy around the scaffold', 'keep the body plan readable', 'organic creature detail'],
  },
  {
    kind: 'gestalt-leap',
    silhouetteLatitude: 0.76,
    priorInvitation: 0.82,
    hooks: ['push the creature family farther', 'let model priors complete missing anatomy', 'strong silhouette reinterpretation'],
  },
  {
    kind: 'material-creature-fusion',
    silhouetteLatitude: 0.64,
    priorInvitation: 0.72,
    hooks: ['merge shell and flesh into one body', 'add natural growth seams', 'surprising but coherent creature design'],
  },
];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const round = (value, digits = 3) => Number(value.toFixed(digits));

function hashSeed(seed) {
  let hash = 2166136261;
  const text = String(seed || DEFAULT_SEED);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function candidateRng(seed, index) {
  const mixed = hashSeed(`${seed}:${index}:lirm-speciation`);
  return mulberry32(mixed);
}

function selectGestalt(seed, index) {
  const offset = hashSeed(`${seed}:gestalt-offset`) % GESTALT_ARCHETYPES.length;
  return GESTALT_ARCHETYPES[(index + offset) % GESTALT_ARCHETYPES.length];
}

function gestaltSilhouette(archetype, rng) {
  const pressure = 0.7 + rng() * 0.24;
  return {
    class: archetype.silhouetteClass,
    gestaltPressure: round(pressure),
    headScale: round(archetype.silhouette.headScale * (0.94 + rng() * 0.12)),
    bellyScale: round(archetype.silhouette.bellyScale * (0.94 + rng() * 0.12)),
    tailScale: round(archetype.silhouette.tailScale * (0.94 + rng() * 0.12)),
    widthScale: round(archetype.silhouette.widthScale * (0.94 + rng() * 0.12)),
    heightScale: round(archetype.silhouette.heightScale * (0.94 + rng() * 0.12)),
    dorsalLift: round(archetype.silhouette.dorsalLift),
    mouthOffset: round(archetype.silhouette.mouthOffset),
    outlineWords: archetype.priorHooks,
  };
}

function applyMod(value, mod, min, max, digits = 3) {
  return round(clamp(value + (mod || 0), min, max), digits);
}

function segmentRadiusScale(t, silhouette) {
  const head = silhouette.headScale * Math.exp(-Math.pow((t - 1) / 0.24, 2));
  const belly = silhouette.bellyScale * Math.exp(-Math.pow((t - 0.48) / 0.34, 2));
  const tail = silhouette.tailScale * Math.exp(-Math.pow(t / 0.22, 2));
  const baseline = 0.55;
  return clamp((baseline + head * 0.38 + belly * 0.42 + tail * 0.28) * silhouette.widthScale, 0.34, 2.25);
}

function xml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function hsl(h, s, l, a = 1) {
  return `hsla(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%, ${round(a, 2)})`;
}

function makeAxisSamples({ curveAmplitude, curvePhase, headBias, segmentCount, asymmetry, bodyLength, bodyCenter, postureLift }) {
  const samples = [];
  const count = Math.max(7, Math.min(13, segmentCount + 2));
  const startX = clamp(bodyCenter - bodyLength / 2, 0.05, 0.42);
  const endX = clamp(bodyCenter + bodyLength / 2, 0.58, 0.95);
  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1);
    const x = round(startX + t * (endX - startX));
    const wave = Math.sin((t * Math.PI * 2) + curvePhase) * curveAmplitude;
    const headLift = (t - 0.5) * headBias * 0.04;
    const posture = Math.sin(t * Math.PI) * postureLift;
    const skew = Math.sin(t * Math.PI) * asymmetry * 0.12;
    const y = round(0.5 + wave + headLift + posture + skew);
    samples.push({ t: round(t), x, y });
  }
  return samples;
}

function buildMutationPath(params) {
  const path = [
    `gestalt:${params.gestalt.kind}`,
    `silhouette:${params.silhouette.class}`,
    `fall-forward:${params.controlPressures.mode}`,
    `segments:${params.segmentCount}`,
    `axis:${params.curveAmplitude > 0.09 ? 'arched' : 'low-crawl'}`,
    `limbs:${params.limbPairCount}`,
    `contact:${params.contactWidth > 0.58 ? 'broad-belly' : 'narrow-belly'}`,
  ];
  if (params.shellPlateCount > 0) path.push(`armor:${params.shellPlateCount}-plates`);
  if (params.asymmetry > 0.12) path.push('asymmetry:visible');
  if (params.mouthIntensity > 0.62) path.push('mouth:hungry');
  if (params.cuteGrossBlend > 0.58) path.push('temper:gross-cute');
  return path;
}

function createControlPressures({ archetype, rng, index, params }) {
  const mode = FALL_FORWARD_MODES[(index + Math.floor(rng() * FALL_FORWARD_MODES.length)) % FALL_FORWARD_MODES.length];
  const semanticAdherence = round(clamp(
    0.64
      + params.silhouette.gestaltPressure * 0.14
      + (params.mouthIntensity > 0.58 ? 0.06 : 0)
      + (params.contactWidth > 0.58 ? 0.04 : 0)
      - mode.silhouetteLatitude * 0.12,
    0.55,
    0.94,
  ));
  const silhouetteFallForward = round(clamp(
    mode.silhouetteLatitude
      + Math.abs(params.silhouette.widthScale - params.silhouette.heightScale) * 0.08
      + params.asymmetry * 0.22
      + (params.curveAmplitude > 0.095 ? 0.05 : 0),
    0.35,
    0.96,
  ));
  const priorInvitation = round(clamp(
    mode.priorInvitation
      + params.gestalt.priorHooks.length * 0.025
      + (params.shellPlateCount > 3 ? 0.05 : 0)
      + (params.limbPairCount > 3 ? 0.04 : 0),
    0.35,
    0.98,
  ));
  return {
    kind: CONTROL_PRESSURE_KIND,
    mode: mode.kind,
    archetype: archetype.kind,
    semanticAdherence,
    silhouetteFallForward,
    priorInvitation,
    rigidAnchors: [
      'whole_body_axis',
      'terminal_front_mouth',
      'head_orientation',
      'belly_contact_patch',
      'primary_contact_points',
    ],
    elasticZones: [
      'micro_anatomy',
      'surface_material',
      'shell_plate_detail',
      'limb_nub_detail',
      'skin_fold_texture',
    ],
    fallForwardPrompts: [...mode.hooks, ...params.gestalt.priorHooks.slice(0, 3)],
    routeStance: {
      matchScaffold: [
        'preserve the procedural body axis and silhouette class',
        'keep the terminal mouth on the front cap',
        'keep belly contact and motion affordance readable',
      ],
      hallucinateBeyond: [
        'invent plausible anatomy in under-specified regions',
        'let the generator complete missing creature detail without losing the body plan',
        'wake adjacent creature priors while preserving the selected silhouette family',
      ],
    },
  };
}

function createSemanticHandles(candidateId, params, axisSamples) {
  const head = axisSamples[axisSamples.length - 1];
  const belly = axisSamples[Math.floor(axisSamples.length * 0.45)];
  const tail = axisSamples[0];
  const handles = [
    {
      id: `${candidateId}:gestalt`,
      kind: 'gestalt_silhouette',
      label: `${params.gestalt.label} / ${params.silhouette.class}`,
      strength: params.silhouette.gestaltPressure,
      region: {
        class: params.silhouette.class,
        headScale: params.silhouette.headScale,
        bellyScale: params.silhouette.bellyScale,
        tailScale: params.silhouette.tailScale,
        widthScale: params.silhouette.widthScale,
        heightScale: params.silhouette.heightScale,
      },
      futureUse: ['imagegen_prior_hook', 'trellis_prior_assay', 'whole_body_selection'],
    },
    {
      id: `${candidateId}:axis`,
      kind: 'axis',
      label: 'axial body curve',
      strength: round(params.curveAmplitude + 0.52),
      region: { samples: axisSamples.map(sample => ({ x: sample.x, y: sample.y })) },
      futureUse: ['silhouette_conditioning', 'motion_spine_guess'],
    },
    {
      id: `${candidateId}:head`,
      kind: 'head',
      label: 'head / desire orientation',
      strength: round(0.55 + params.headBias),
      region: { x: head.x, y: head.y, radius: round(0.09 + params.headBias * 0.04) },
      futureUse: ['orientation', 'attention', 'appetite'],
    },
    {
      id: `${candidateId}:mouth`,
      kind: 'mouth',
      label: 'terminal mouth concentration',
      strength: params.mouthIntensity,
      region: {
        x: round(clamp(head.x + params.silhouette.mouthOffset + params.headBias * 0.012, 0.05, 0.985)),
        y: round(head.y + 0.008),
        radius: round(0.026 + params.mouthIntensity * 0.025),
        placement: 'terminal_front_cap',
      },
      futureUse: ['hoard_theft', 'bite_pose', 'face_prompt'],
    },
    {
      id: `${candidateId}:belly-contact`,
      kind: 'belly_contact',
      label: 'belly contact patch',
      strength: params.contactWidth,
      region: { x: belly.x, y: round(belly.y + 0.12), width: params.contactWidth, height: round(0.055 + params.bellyDrop * 0.06) },
      futureUse: ['crawl_contact', 'terrain_desire', 'shadow_anchor'],
    },
    {
      id: `${candidateId}:locomotion`,
      kind: 'locomotion',
      label: 'motion affordance field',
      strength: round((params.limbPairCount / 5) * 0.45 + params.contactWidth * 0.55),
      region: { contactCount: Math.max(3, params.limbPairCount + 2), primary: guessMotionAffordance(params).primary },
      futureUse: ['motion_transposition', 'swarm_readability'],
    },
    {
      id: `${candidateId}:control-pressures`,
      kind: 'control_pressure',
      label: 'semantic adherence / silhouette fall-forward controls',
      strength: round((params.controlPressures.semanticAdherence + params.controlPressures.silhouetteFallForward) / 2),
      region: {
        mode: params.controlPressures.mode,
        semanticAdherence: params.controlPressures.semanticAdherence,
        silhouetteFallForward: params.controlPressures.silhouetteFallForward,
        priorInvitation: params.controlPressures.priorInvitation,
      },
      futureUse: ['imagegen_prompt_stance', 'trellis_prior_assay', 'basin_failure_attribution'],
    },
  ];

  for (let i = 0; i < params.limbPairCount; i += 1) {
    const t = (i + 1) / (params.limbPairCount + 1);
    const axis = axisSamples[Math.min(axisSamples.length - 2, Math.max(1, Math.round(t * (axisSamples.length - 1))))];
    handles.push({
      id: `${candidateId}:limb-bud-${i}`,
      kind: 'limb_bud',
      label: `paired limb bud ${i + 1}`,
      strength: round(params.limbScale * (0.85 + i * 0.04)),
      region: { x: axis.x, y: axis.y, t: round(t), side: 'paired', length: round(0.07 + params.limbScale * 0.08) },
      futureUse: ['step', 'brace', 'drag', 'gesture'],
    });
  }

  for (let i = 0; i < params.shellPlateCount; i += 1) {
    const t = (i + 1) / (params.shellPlateCount + 1);
    const axis = axisSamples[Math.min(axisSamples.length - 1, Math.round(t * (axisSamples.length - 1)))];
    handles.push({
      id: `${candidateId}:shell-plate-${i}`,
      kind: 'shell_plate',
      label: `dorsal shell plate ${i + 1}`,
      strength: round(params.armorPressure),
      region: { x: axis.x, y: round(axis.y - 0.085), t: round(t), width: round(0.09 + params.armorPressure * 0.08) },
      futureUse: ['material_region', 'occlusion_read', 'trellis_detail_hook'],
    });
  }

  if (params.sensoryNubCount > 0) {
    for (let i = 0; i < params.sensoryNubCount; i += 1) {
      handles.push({
        id: `${candidateId}:sensory-nub-${i}`,
        kind: 'sensory_nub',
        label: `sensory nub ${i + 1}`,
        strength: round(0.35 + params.cuteGrossBlend * 0.4),
        region: { x: round(head.x - 0.03 + i * 0.045), y: round(head.y - 0.08 - (i % 2) * 0.018), radius: 0.018 },
        futureUse: ['readability', 'cute_gross_threshold'],
      });
    }
  }

  handles.push({
    id: `${candidateId}:tail-drag`,
    kind: 'tail_drag',
    label: 'tail drag memory',
    strength: round(0.4 + params.bellyDrop * 0.45),
    region: { x: tail.x, y: round(tail.y + 0.08), length: round(0.12 + params.contactWidth * 0.07) },
    futureUse: ['trail', 'panic_turn', 'swarm_spacing'],
  });

  return handles;
}

function createContactPoints(params, axisSamples) {
  const points = [];
  const contactCount = Math.max(3, params.limbPairCount + 2);
  for (let i = 0; i < contactCount; i += 1) {
    const t = (i + 0.5) / contactCount;
    const axis = axisSamples[Math.min(axisSamples.length - 1, Math.round(t * (axisSamples.length - 1)))];
    const side = i % 2 === 0 ? -1 : 1;
    points.push({
      id: `contact-${i}`,
      t: round(t),
      x: round(axis.x),
      y: round(axis.y + 0.14 + side * params.asymmetry * 0.035),
      radius: round(0.018 + params.contactWidth * 0.018),
      role: i < 2 ? 'fore-brace' : i === contactCount - 1 ? 'tail-drag' : 'belly-crawl',
    });
  }
  return points;
}

function guessMotionAffordance(params) {
  if (params.armorPressure > 0.72 && params.limbPairCount <= 2) {
    return { primary: 'brace-drag', confidence: round(0.68 + params.armorPressure * 0.2), secondary: ['crawl', 'flop'] };
  }
  if (params.limbPairCount >= 4 && params.contactWidth < 0.62) {
    return { primary: 'scuttle', confidence: round(0.64 + params.limbPairCount * 0.05), secondary: ['crawl', 'panic-turn'] };
  }
  if (params.segmentCount >= 9 && params.curveAmplitude > 0.09) {
    return { primary: 'inch', confidence: round(0.66 + params.curveAmplitude), secondary: ['crawl', 'coil'] };
  }
  if (params.bellyDrop > 0.72) {
    return { primary: 'flop', confidence: round(0.62 + params.bellyDrop * 0.18), secondary: ['crawl', 'brace'] };
  }
  return { primary: 'crawl', confidence: round(0.68 + params.contactWidth * 0.12), secondary: ['inch', 'drag'] };
}

function createCandidate(seed, index, candidateCount) {
  const rng = candidateRng(seed, index);
  const candidateId = `lirm-armature-${String(index).padStart(2, '0')}`;
  const phase = candidateCount <= 1 ? 0 : index / (candidateCount - 1);
  const archetype = selectGestalt(seed, index);
  const gestalt = {
    kind: archetype.kind,
    label: archetype.label,
    priorHooks: archetype.priorHooks,
    source: 'seeded_gestalt_archetype_v0',
  };
  const silhouette = gestaltSilhouette(archetype, rng);
  const mods = archetype.mods;
  const baseSegmentCount = 5 + ((index * 3 + Math.floor(rng() * 5)) % 7);
  const segmentCount = Math.max(5, Math.min(13, baseSegmentCount + Math.round(mods.segments || 0)));
  const baseLimbPairCount = 1 + ((index + Math.floor(rng() * 6)) % 5);
  const limbPairCount = Math.max(0, Math.min(8, baseLimbPairCount + Math.round(mods.limbs || 0)));
  const armorPressure = applyMod((index % 3 === 0 ? 0.62 : 0.24) + rng() * 0.42 + Math.sin(index * 1.7) * 0.08, mods.armor, 0.05, 0.95);
  const shellPlateBias = ['lirm-pillbug-dome', 'lirm-trilobite-flat', 'lirm-shell-kite'].includes(archetype.kind) ? 2 : 0;
  const shellPlateCount = armorPressure > 0.55 ? Math.min(8, 2 + shellPlateBias + ((index + Math.floor(rng() * 4)) % 5)) : shellPlateBias;
  const curveAmplitude = applyMod(0.035 + rng() * 0.105 + (index % 5 === 2 ? 0.035 : 0), mods.curve, 0.01, 0.18);
  const curvePhase = round((rng() * Math.PI * 2) + index * 0.23);
  const headBias = applyMod(0.15 + rng() * 0.74, mods.head, 0.08, 0.96);
  const contactWidth = applyMod(0.42 + rng() * 0.43, mods.contact, 0.28, 0.92);
  const bellyDrop = applyMod(0.35 + rng() * 0.58, mods.belly, 0.18, 0.96);
  const mouthIntensity = round(0.38 + rng() * 0.55);
  const limbScale = round(0.36 + rng() * 0.48);
  const cuteGrossBlend = round(0.18 + rng() * 0.78);
  const asymmetry = applyMod(index % 2 === 0 ? 0.05 + rng() * 0.07 : 0.11 + rng() * 0.13, mods.asymmetry, 0.03, 0.28);
  const sensoryNubCount = cuteGrossBlend > 0.48 ? 1 + ((index + Math.floor(rng() * 3)) % 3) : 0;
  const bodyLength = applyMod(clamp(0.52 + rng() * 0.38 + (segmentCount - 7) * 0.035, 0.46, 0.92), mods.length, 0.38, 0.97);
  const bodyCenter = round(0.5 + (rng() - 0.5) * 0.11);
  const postureLift = round((index % 5 === 3 ? -0.055 : 0) + (index % 5 === 1 ? 0.045 : 0) + (rng() - 0.5) * 0.055 + silhouette.dorsalLift);
  const bulkScale = applyMod(clamp(0.72 + rng() * 0.74 + (bellyDrop - 0.5) * 0.28, 0.62, 1.55), mods.bulk, 0.42, 1.85);

  const params = {
    gestalt,
    silhouette,
    segmentCount,
    limbPairCount,
    armorPressure,
    shellPlateCount,
    curveAmplitude,
    curvePhase,
    headBias,
    contactWidth,
    bellyDrop,
    mouthIntensity,
    limbScale,
    cuteGrossBlend,
    asymmetry,
    sensoryNubCount,
    bodyLength,
    bodyCenter,
    postureLift,
    bulkScale,
  };
  params.controlPressures = createControlPressures({ archetype, rng, index, params });
  const axisSamples = makeAxisSamples(params);
  const semanticHandles = createSemanticHandles(candidateId, params, axisSamples);
  const contactPoints = createContactPoints(params, axisSamples);
  const motionAffordance = guessMotionAffordance(params);
  const mutationPath = buildMutationPath(params);

  return {
    schema: LIRM_SPECIATION_ARMATURE_CANDIDATE_SCHEMA,
    id: candidateId,
    label: `lineage ${String(index + 1).padStart(2, '0')}`,
    seed: `${seed}:${index}`,
    lineage: {
      rootSeed: seed,
      parentId: ROOT_PARENT_ID,
      generation: Math.floor(index / 5),
      siblingIndex: index % 5,
      phase: round(phase),
      mutationPath,
    },
    bodyPlan: {
      family: 'small-ground-hoard-thief',
      gestalt,
      silhouette,
      axialCurve: curveAmplitude > 0.105 ? 'arched-inchworm' : 'low-belly-crawler',
      segmentCount,
      axisSamples,
      massDistribution: {
        headBias,
        bellyDrop,
        tailDrag: round(0.35 + (1 - headBias) * 0.42),
      },
      limbPairCount,
      limbScale,
      shellPlateCount,
      armorPressure,
      mouthIntensity,
      cuteGrossBlend,
      asymmetry,
      contactWidth,
      sensoryNubCount,
      bodyLength,
      bodyCenter,
      postureLift,
      bulkScale,
      controlPressures: params.controlPressures,
    },
    semanticHandles,
    contactPoints,
    motionAffordance,
    firingAffordances: {
      acceptsImagegenConditioning: true,
      acceptsSamIsolation: true,
      acceptsTrellisProbe: true,
      acceptsSharpProbe: true,
      controlMaps: ['silhouette', 'gestalt-silhouette', 'semantic-map', 'axis-depth-cue', 'contact-points', 'proxy-primitives'],
      promptPacket: {
        subject: `small crawling hoard thief creature, ${gestalt.label}`,
        preserve: ['whole silhouette gestalt', 'body axis', 'belly contact patch', 'head orientation', 'terminal front mouth', 'limb bud count'],
        mutate: ['surface material', 'gross-cute balance', 'shell/soft tissue texture', 'silhouette elaboration'],
        hallucinateBeyond: params.controlPressures.routeStance.hallucinateBeyond,
      },
    },
  };
}

function candidateColors(candidate) {
  const hue = 46 + candidate.bodyPlan.cuteGrossBlend * 55;
  const armor = candidate.bodyPlan.armorPressure;
  return {
    body: hsl(hue, 36 + armor * 18, 30 + candidate.bodyPlan.cuteGrossBlend * 13, 0.93),
    shadow: hsl(80, 18, 13, 0.72),
    head: hsl(17, 50, 38 + candidate.bodyPlan.mouthIntensity * 9, 0.95),
    mouth: hsl(352, 62, 22, 0.95),
    belly: hsl(96, 45, 56, 0.72),
    limb: hsl(31, 42, 44, 0.86),
    shell: hsl(217, 18, 27 + armor * 19, 0.92),
    contact: hsl(285, 70, 58, 0.8),
    axis: hsl(203, 70, 62, 0.75),
  };
}

function renderCandidateSvg(candidate, index, columns, cellWidth, cellHeight, leftMargin, topMargin) {
  const col = index % columns;
  const row = Math.floor(index / columns);
  const x0 = leftMargin + col * cellWidth;
  const y0 = topMargin + row * cellHeight;
  const pad = 18;
  const w = cellWidth - pad * 2;
  const h = cellHeight - pad * 2 - 18;
  const colors = candidateColors(candidate);
  const toX = x => round(x0 + pad + x * w, 2);
  const toY = y => round(y0 + pad + y * h, 2);
  const axis = candidate.bodyPlan.axisSamples;
  const axisPoints = axis.map(point => `${toX(point.x)},${toY(point.y)}`).join(' ');
  const candidateLabel = xml(`${candidate.bodyPlan.gestalt.label} ${candidate.motionAffordance.primary}`);
  const candidateTitle = [
    `${candidate.id}: ${candidate.bodyPlan.gestalt.label} / ${candidate.motionAffordance.primary}`,
    `silhouette ${candidate.bodyPlan.silhouette.class}`,
    `segments ${candidate.bodyPlan.segmentCount}`,
    `limb pairs ${candidate.bodyPlan.limbPairCount}`,
    `shell plates ${candidate.bodyPlan.shellPlateCount}`,
    `terminal mouth`,
  ].join(' / ');
  const bodyWidth = (0.07 + candidate.bodyPlan.contactWidth * 0.055) * candidate.bodyPlan.bulkScale;
  const segmentEllipses = axis.map((point, sampleIndex) => {
    const t = sampleIndex / Math.max(1, axis.length - 1);
    const profile = segmentRadiusScale(t, candidate.bodyPlan.silhouette);
    const rx = round((0.038 + bodyWidth * profile) * w, 2);
    const ry = round((0.035 + bodyWidth * profile * 0.42 * candidate.bodyPlan.silhouette.heightScale + Math.sin(t * Math.PI) * 0.018) * h, 2);
    const opacity = round(0.74 + Math.sin(t * Math.PI) * 0.18, 2);
    return `<ellipse cx="${toX(point.x)}" cy="${toY(point.y)}" rx="${rx}" ry="${ry}" fill="${colors.body}" opacity="${opacity}"/>`;
  }).join('');

  const limbHandles = candidate.semanticHandles.filter(handle => handle.kind === 'limb_bud');
  const limbs = limbHandles.map((handle, limbIndex) => {
    const sideA = limbIndex % 2 === 0 ? -1 : 1;
    const sideB = -sideA;
    const x = toX(handle.region.x);
    const y = toY(handle.region.y);
    const length = handle.region.length * w;
    const ySpread = (0.07 + candidate.bodyPlan.asymmetry * 0.13) * h;
    return [
      `<line x1="${x}" y1="${y}" x2="${round(x - length * 0.75, 2)}" y2="${round(y + sideA * ySpread, 2)}" stroke="${colors.limb}" stroke-width="5" stroke-linecap="round" opacity="0.78"/>`,
      `<line x1="${x}" y1="${y}" x2="${round(x + length * 0.52, 2)}" y2="${round(y + sideB * ySpread * 0.82, 2)}" stroke="${colors.limb}" stroke-width="4" stroke-linecap="round" opacity="0.66"/>`,
    ].join('');
  }).join('');

  const shellPlates = candidate.semanticHandles.filter(handle => handle.kind === 'shell_plate').map((handle, plateIndex) => {
    const x = toX(handle.region.x);
    const y = toY(handle.region.y);
    const width = handle.region.width * w;
    const tilt = (plateIndex % 2 === 0 ? -1 : 1) * candidate.bodyPlan.asymmetry * 18;
    return `<rect x="${round(x - width / 2, 2)}" y="${round(y - 7, 2)}" width="${round(width, 2)}" height="13" rx="4" fill="${colors.shell}" stroke="rgba(232,221,181,0.5)" stroke-width="1" transform="rotate(${round(tilt, 2)} ${x} ${y})"/>`;
  }).join('');

  const contacts = candidate.contactPoints.map(point => (
    `<circle cx="${toX(point.x)}" cy="${toY(point.y)}" r="${round(point.radius * w, 2)}" fill="${colors.contact}" opacity="0.75"><title>${xml(point.role)}</title></circle>`
  )).join('');

  const head = candidate.semanticHandles.find(handle => handle.kind === 'head');
  const mouth = candidate.semanticHandles.find(handle => handle.kind === 'mouth');
  const sensory = candidate.semanticHandles.filter(handle => handle.kind === 'sensory_nub').map(handle => (
    `<circle cx="${toX(handle.region.x)}" cy="${toY(handle.region.y)}" r="${round(handle.region.radius * w, 2)}" fill="rgba(255,230,165,0.88)" stroke="rgba(40,24,18,0.5)" stroke-width="1"/>`
  )).join('');
  const belly = candidate.semanticHandles.find(handle => handle.kind === 'belly_contact');
  const bellyRect = `<ellipse cx="${toX(belly.region.x)}" cy="${toY(belly.region.y)}" rx="${round(belly.region.width * w * 0.22, 2)}" ry="${round(belly.region.height * h, 2)}" fill="${colors.belly}" opacity="0.52"/>`;

  return `
    <g class="candidate" data-candidate-id="${candidate.id}" transform="translate(0 0)">
      <title class="candidate-title">${xml(candidateTitle)}</title>
      <rect x="${x0 + 6}" y="${y0 + 6}" width="${cellWidth - 12}" height="${cellHeight - 12}" rx="9" fill="rgba(16,22,18,0.92)" stroke="rgba(167,210,144,0.22)" stroke-width="1"/>
      <text x="${x0 + 13}" y="${y0 + 21}" fill="rgba(235,244,216,0.9)" font-size="10" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">${candidate.id}</text>
      <text x="${x0 + 13}" y="${y0 + cellHeight - 14}" fill="rgba(235,244,216,0.75)" font-size="10" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">${candidateLabel}</text>
      <g data-layer="silhouette" opacity="1">
        <path d="M ${toX(0.1)} ${toY(0.76)} C ${toX(0.28)} ${toY(0.92)}, ${toX(0.66)} ${toY(0.92)}, ${toX(0.9)} ${toY(0.76)}" fill="none" stroke="${colors.shadow}" stroke-width="13" stroke-linecap="round" opacity="0.5"/>
        ${segmentEllipses}
        <ellipse cx="${toX(head.region.x)}" cy="${toY(head.region.y)}" rx="${round(head.region.radius * w * candidate.bodyPlan.silhouette.headScale * 1.05, 2)}" ry="${round(head.region.radius * h * candidate.bodyPlan.silhouette.heightScale, 2)}" fill="${colors.head}" opacity="0.96"/>
      </g>
      <g data-layer="semantic-map">
        <polyline points="${axisPoints}" fill="none" stroke="${colors.axis}" stroke-width="2" stroke-linecap="round" stroke-dasharray="4 4" opacity="0.82"/>
        ${limbs}
        ${shellPlates}
        ${bellyRect}
        ${sensory}
        <circle cx="${toX(mouth.region.x)}" cy="${toY(mouth.region.y)}" r="${round(mouth.region.radius * w, 2)}" fill="${colors.mouth}" stroke="rgba(255,172,97,0.75)" stroke-width="1"><title>terminal mouth</title></circle>
        ${contacts}
      </g>
    </g>
  `;
}

function renderLegendSvg(x, y) {
  const items = [
    { label: 'body mass', mark: '<ellipse cx="0" cy="0" rx="8" ry="5" fill="rgba(143,151,71,0.95)"/>' },
    { label: 'axis handle', mark: '<line x1="-9" y1="0" x2="9" y2="0" stroke="rgba(81,188,223,0.9)" stroke-width="2" stroke-dasharray="3 3"/>' },
    { label: 'shell plate', mark: '<rect x="-7" y="-5" width="14" height="10" rx="3" fill="rgba(82,93,121,0.94)"/>' },
    { label: 'limb bud', mark: '<line x1="-7" y1="4" x2="8" y2="-4" stroke="rgba(158,104,57,0.9)" stroke-width="4" stroke-linecap="round"/>' },
    { label: 'contact point', mark: '<circle cx="0" cy="0" r="5" fill="rgba(190,81,220,0.85)"/>' },
    { label: 'head orientation', mark: '<ellipse cx="0" cy="0" rx="7" ry="6" fill="rgba(153,77,42,0.95)"/>' },
    { label: 'terminal mouth', mark: '<circle cx="0" cy="0" r="5" fill="rgba(92,19,34,0.95)" stroke="rgba(255,172,97,0.8)" stroke-width="1"/>' },
    { label: 'sensory nub', mark: '<circle cx="0" cy="0" r="4" fill="rgba(255,230,165,0.9)"/>' },
    { label: 'belly contact', mark: '<ellipse cx="0" cy="0" rx="8" ry="4" fill="rgba(111,191,96,0.72)"/>' },
  ];
  const itemWidth = 112;
  return `<g data-layer="legend" transform="translate(${x} ${y})" font-family="Menlo, Monaco, monospace">
    <rect x="-8" y="-16" width="${itemWidth * items.length + 12}" height="33" rx="8" fill="rgba(16,22,18,0.74)" stroke="rgba(167,210,144,0.18)"/>
    ${items.map((item, index) => (
      `<g transform="translate(${index * itemWidth + 8} 0)">
        ${item.mark}
        <text x="14" y="4" fill="rgba(235,244,216,0.78)" font-size="9">${xml(item.label)}</text>
      </g>`
    )).join('')}
  </g>`;
}

function renderContactSheetSvg(witness) {
  const columns = witness.contactSheet.columns;
  const rows = witness.contactSheet.rows;
  const cellWidth = 204;
  const cellHeight = 166;
  const margin = 22;
  const topMargin = 126;
  const width = columns * cellWidth + margin * 2;
  const height = topMargin + rows * cellHeight + margin;
  const title = 'Do not prompt for the creature. Grow the lineage until the creature becomes selectable.';
  const body = witness.candidates.map((candidate, index) => (
    renderCandidateSvg(candidate, index, columns, cellWidth, cellHeight, margin, topMargin)
  )).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${xml(title)}">
  <rect width="100%" height="100%" fill="#07130f"/>
  <text x="${margin}" y="32" fill="#eef6d6" font-size="18" font-family="Menlo, Monaco, monospace">${xml(title)}</text>
  <text x="${margin}" y="55" fill="rgba(238,246,214,0.68)" font-size="12" font-family="Menlo, Monaco, monospace">seed=${xml(witness.seed)} route=${xml(witness.route)} candidates=${witness.candidates.length} columns=${columns}</text>
  ${renderLegendSvg(margin + 6, 88)}
  ${body}
</svg>`;
}

function renderCandidateControlSvg(candidate, mode = 'semantic-svg') {
  const title = `${candidate.id} ${mode} control`;
  const body = renderCandidateSvg(candidate, 0, 1, 320, 232, 18, 34);
  const hideLayer = mode === 'silhouette-svg'
    ? '[data-layer="semantic-map"]{display:none}'
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="356" height="286" viewBox="0 0 356 286" role="img" aria-label="${xml(title)}" data-control-map="${xml(mode)}">
  <style>${hideLayer}</style>
  <rect width="100%" height="100%" fill="#07130f"/>
  <text x="18" y="22" fill="#eef6d6" font-size="13" font-family="Menlo, Monaco, monospace">${xml(title)}</text>
  ${body}
</svg>`;
}

function proxyPoint(region, z = 0) {
  return {
    x: round((region.x - 0.5) * 2),
    y: round((0.5 - region.y) * 2),
    z: round(z),
  };
}

const SUPPORT_CONTROL_DEFAULTS = Object.freeze({
  limbEmission: 'centerline',
  contactGeometry: 'body-sdf',
  projection: 'legacy-yaw-0.42',
});

const SUPPORT_CONTROL_LEVELS = Object.freeze({
  limbEmission: new Set(['centerline', 'bilateral-sidecar']),
  contactGeometry: new Set(['body-sdf', 'semantic-only']),
  projection: new Set(['legacy-yaw-0.42', 'pairing-legible-yaw-pi-over-4']),
});

function normalizeSupportControlFactors(requested = {}) {
  const normalized = {
    ...SUPPORT_CONTROL_DEFAULTS,
    ...requested,
  };
  for (const [factor, levels] of Object.entries(SUPPORT_CONTROL_LEVELS)) {
    if (!levels.has(normalized[factor])) {
      throw new Error(`unsupported support control ${factor}: ${normalized[factor]}`);
    }
  }
  return {
    requested: normalized,
    effective: {
      ...normalized,
      cameraYawRadians: normalized.projection === 'pairing-legible-yaw-pi-over-4'
        ? Math.PI / 4
        : 0.42,
    },
    sourceEquality: {
      bodyMass: 'unchanged',
      headAndMouth: 'unchanged',
      prompt: 'unchanged',
      route: 'unchanged',
      cropAndScale: 'unchanged',
    },
  };
}

function createSupportSemanticInventory(candidate) {
  return candidate.semanticHandles
    .filter(handle => handle.kind === 'limb_bud')
    .flatMap(handle => {
      const members = handle.region.side === 'paired'
        ? ['left', 'right']
        : [handle.region.side || 'centerline'];
      return members.map(pairMember => ({
        id: `${handle.id}:${pairMember}`,
        pairId: handle.id,
        pairMember,
        sourceHandleId: handle.id,
        bodyStation: handle.region.t,
        intendedAttachmentRole: 'body_mass',
        intendedAttachmentRegion: {
          x: handle.region.x,
          y: handle.region.y,
          t: handle.region.t,
        },
        strength: handle.strength,
        futureUse: handle.futureUse,
        entersBodySdf: false,
      }));
    });
}

function createProxyPrimitives(candidate, controlFactors) {
  const primitives = [];
  const width = 0.09 + candidate.bodyPlan.contactWidth * 0.08;
  for (const sample of candidate.bodyPlan.axisSamples) {
    const profile = segmentRadiusScale(sample.t, candidate.bodyPlan.silhouette);
    primitives.push({
      kind: 'metaball',
      role: 'body_mass',
      center: proxyPoint(sample),
      radius: round(width * candidate.bodyPlan.bulkScale * profile),
      falloff: 'smooth_union',
    });
  }

  const head = candidate.semanticHandles.find(handle => handle.kind === 'head');
  const mouth = candidate.semanticHandles.find(handle => handle.kind === 'mouth');
  primitives.push({
    kind: 'sphere',
    role: 'head_orientation',
    center: proxyPoint(head.region, 0.02),
    radius: round(head.region.radius * 1.15 * candidate.bodyPlan.silhouette.headScale),
    materialHint: 'soft_head_mass',
  });
  primitives.push({
    kind: 'sphere',
    role: 'terminal_mouth',
    center: proxyPoint(mouth.region, 0.055),
    radius: mouth.region.radius,
    materialHint: 'mouth_dark_wet_terminal',
  });

  if (controlFactors.effective.limbEmission === 'centerline') {
    for (const handle of candidate.semanticHandles.filter(item => item.kind === 'limb_bud')) {
      primitives.push({
        kind: 'capsule',
        role: 'limb_bud',
        id: `${handle.id}:centerline`,
        center: proxyPoint(handle.region, -0.015),
        radius: round(0.018 + handle.strength * 0.018),
        length: round(handle.region.length * 1.7),
        t: handle.region.t,
        sourceHandleId: handle.id,
        pairId: handle.id,
        side: handle.region.side,
        pairMember: 'centerline',
        materialHint: 'brace_drag_nub',
      });
    }
  }

  for (const handle of candidate.semanticHandles.filter(item => item.kind === 'shell_plate')) {
    primitives.push({
      kind: 'box',
      role: 'shell_plate',
      center: proxyPoint(handle.region, 0.075),
      size: {
        x: round(handle.region.width * 1.4),
        y: round(0.052 * candidate.bodyPlan.silhouette.widthScale),
        z: round(0.018 + candidate.bodyPlan.armorPressure * 0.04),
      },
      t: handle.region.t,
      materialHint: 'dorsal_plate',
    });
  }

  if (controlFactors.effective.contactGeometry === 'body-sdf') {
    for (const point of candidate.contactPoints) {
      primitives.push({
        id: point.id,
        kind: 'sphere',
        role: 'contact_point',
        contactRole: point.role,
        center: proxyPoint(point, -0.08),
        radius: round(point.radius * 1.4),
        materialHint: 'ground_contact_marker',
      });
    }
  }

  return primitives;
}

export function createLirmSpeciationArmatureControlPacket({
  witness,
  candidate,
  candidateId,
  controlFactors: requestedControlFactors,
} = {}) {
  const selectedCandidate = candidate || witness?.candidates?.find(item => item.id === candidateId);
  if (!witness || !selectedCandidate) {
    throw new Error('createLirmSpeciationArmatureControlPacket requires a witness and candidate or candidateId');
  }
  const candidateDir = `control-packets/${selectedCandidate.id}`;
  const controlFactors = normalizeSupportControlFactors(requestedControlFactors);
  const proxyPrimitives = createProxyPrimitives(selectedCandidate, controlFactors);
  const supportSemanticInventory = createSupportSemanticInventory(selectedCandidate);
  return {
    schema: LIRM_SPECIATION_ARMATURE_CONTROL_PACKET_SCHEMA,
    route: LIRM_SPECIATION_ARMATURE_CONTROL_PACKET_ROUTE,
    sourceWitnessId: witness.witnessId,
    sourceWitnessRoute: witness.route,
    candidateId: selectedCandidate.id,
    seed: selectedCandidate.seed,
    gestalt: selectedCandidate.bodyPlan.gestalt,
    silhouette: selectedCandidate.bodyPlan.silhouette,
    controlPressures: selectedCandidate.bodyPlan.controlPressures,
    lineage: selectedCandidate.lineage,
    motionAffordance: selectedCandidate.motionAffordance,
    semanticHandles: selectedCandidate.semanticHandles,
    contactPoints: selectedCandidate.contactPoints,
    supportSemanticInventory,
    controlFactors,
    proxyPrimitives,
    conditioningMaps: [
      { kind: 'semantic-svg', path: `${candidateDir}/semantic-control.svg`, effectiveSource: 'local-procedural-svg' },
      { kind: 'silhouette-svg', path: `${candidateDir}/silhouette-control.svg`, effectiveSource: 'local-procedural-svg' },
      { kind: 'proxy-primitives-json', path: `${candidateDir}/proxy-primitives.json`, effectiveSource: 'local-procedural-proxy-primitives' },
    ],
    promptContract: {
      subject: 'small crawling hoard thief creature',
      preserve: ['whole silhouette gestalt', 'axis curve', 'belly contact', 'terminal front mouth', 'head orientation', 'contact points'],
      allowMutation: ['surface material', 'micro anatomy', 'gross-cute balance', 'skin/shell texture', 'silhouette elaboration'],
      hallucinateBeyond: selectedCandidate.bodyPlan.controlPressures.routeStance.hallucinateBeyond,
      fallForwardPrompts: selectedCandidate.bodyPlan.controlPressures.fallForwardPrompts,
    },
    falseClosureGuards: {
      finishedCreatureClaim: 'forbidden',
      generatorFiringClaim: 'not_yet_fired',
      proxyGeometryClaim: 'control_primitives_only',
    },
  };
}

function rotateForProxyCamera(point) {
  const angle = -0.42;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const x = point.x * cos - point.z * sin;
  const z = point.x * sin + point.z * cos;
  return { x, y: point.y, z };
}

function projectProxyPoint(point, width = 320, height = 240) {
  const rotated = rotateForProxyCamera(point);
  return {
    x: round(width * (0.5 + rotated.x * 0.32), 2),
    y: round(height * (0.5 - rotated.y * 0.38), 2),
    z: round(rotated.z),
    depth01: round(clamp(0.52 + rotated.z * 0.42, 0, 1)),
  };
}

function depthFill(depth01) {
  const level = Math.round(28 + depth01 * 210);
  return `rgb(${level}, ${level}, ${level})`;
}

function normalFill(point) {
  const normal = rotateForProxyCamera(point);
  const length = Math.hypot(normal.x, normal.y, normal.z + 0.72) || 1;
  const r = Math.round(clamp((normal.x / length) * 0.5 + 0.5, 0, 1) * 255);
  const g = Math.round(clamp((-normal.y / length) * 0.5 + 0.5, 0, 1) * 255);
  const b = Math.round(clamp(((normal.z + 0.72) / length) * 0.5 + 0.5, 0, 1) * 255);
  return `rgb(${r}, ${g}, ${b})`;
}

function semanticFill(role) {
  const palette = {
    body_mass: 'rgba(117,164,70,0.92)',
    head_orientation: 'rgba(180,91,53,0.96)',
    terminal_mouth: 'rgba(92,19,34,0.96)',
    limb_bud: 'rgba(163,105,58,0.88)',
    shell_plate: 'rgba(91,101,128,0.92)',
    contact_point: 'rgba(190,81,220,0.82)',
    posteriorBulbousMass: 'rgba(109,142,68,0.94)',
    bodyBridge: 'rgba(132,157,77,0.94)',
    anteriorChestMass: 'rgba(159,133,67,0.95)',
    anteriorUprightNeck: 'rgba(188,112,60,0.95)',
    anteriorHead: 'rgba(198,75,53,0.97)',
    radialContactLimb: 'rgba(139,90,58,0.9)',
    groundContact: 'rgba(190,81,220,0.86)',
  };
  return palette[role] || 'rgba(215,220,185,0.84)';
}

function humanProxyRole(role) {
  return String(role).replaceAll('_', ' ');
}

function clayFill(primitive, depth01) {
  const warm = primitive.role === 'terminal_mouth' ? [96, 28, 38] : primitive.role === 'head_orientation' ? [173, 97, 54] : [132, 142, 92];
  const light = 0.58 + depth01 * 0.3 + (primitive.center.y < 0 ? 0.08 : -0.03);
  const channel = value => Math.round(clamp(value * light, 16, 245));
  return `rgb(${channel(warm[0])}, ${channel(warm[1])}, ${channel(warm[2])})`;
}

function proxyPrimitiveDepth(primitive) {
  return projectProxyPoint(primitive.center).depth01;
}

function renderProxyPrimitiveSvg(primitive, kind, width, height) {
  const projected = projectProxyPoint(primitive.center, width, height);
  const baseRadius = Math.max(2.5, (primitive.radius || 0.04) * width * 0.42);
  const depth = projected.depth01;
  const fillByKind = {
    clay: clayFill(primitive, depth),
    depth: depthFill(depth),
    normal: normalFill(primitive.center),
    mask: 'rgb(255,255,255)',
    semantic: semanticFill(primitive.role),
  };
  const fill = fillByKind[kind] || fillByKind.clay;
  const opacity = kind === 'mask' ? 1 : primitive.role === 'body_mass' ? 0.84 : 0.9;
  const stroke = primitive.role === 'terminal_mouth' && kind === 'clay' ? 'rgba(255,176,100,0.85)' : 'rgba(8,13,10,0.28)';
  if (primitive.kind === 'capsule') {
    const length = (primitive.length || 0.08) * width * 0.4;
    const tilt = primitive.t ? (primitive.t - 0.5) * 24 : 0;
    return `<line x1="${round(projected.x - length / 2, 2)}" y1="${round(projected.y, 2)}" x2="${round(projected.x + length / 2, 2)}" y2="${round(projected.y, 2)}" stroke="${fill}" stroke-width="${round(baseRadius * 1.3, 2)}" stroke-linecap="round" opacity="${opacity}" transform="rotate(${round(tilt, 2)} ${projected.x} ${projected.y})"><title>${xml(humanProxyRole(primitive.role))}</title></line>`;
  }
  if (primitive.kind === 'box') {
    const sizeX = Math.max(8, (primitive.size?.x || 0.08) * width * 0.38);
    const sizeY = Math.max(5, (primitive.size?.y || 0.04) * height * 0.55);
    const tilt = primitive.t ? (primitive.t - 0.5) * 32 : 0;
    return `<rect x="${round(projected.x - sizeX / 2, 2)}" y="${round(projected.y - sizeY / 2, 2)}" width="${round(sizeX, 2)}" height="${round(sizeY, 2)}" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="1" opacity="${opacity}" transform="rotate(${round(tilt, 2)} ${projected.x} ${projected.y})"><title>${xml(humanProxyRole(primitive.role))}</title></rect>`;
  }
  const rx = baseRadius * (primitive.kind === 'metaball' ? 1.35 : 1);
  const ry = baseRadius * (primitive.kind === 'metaball' ? 0.88 : 1);
  return `<ellipse cx="${projected.x}" cy="${projected.y}" rx="${round(rx, 2)}" ry="${round(ry, 2)}" fill="${fill}" stroke="${stroke}" stroke-width="1" opacity="${opacity}"><title>${xml(humanProxyRole(primitive.role))}</title></ellipse>`;
}

function renderProxyMapSvg({ candidate, packet, kind }) {
  const width = 320;
  const height = 240;
  const background = kind === 'mask' ? '#000000' : kind === 'normal' ? 'rgb(128,128,255)' : kind === 'depth' ? 'rgb(16,16,16)' : '#07130f';
  const sorted = [...packet.proxyPrimitives].sort((a, b) => proxyPrimitiveDepth(a) - proxyPrimitiveDepth(b));
  const body = sorted.map(primitive => renderProxyPrimitiveSvg(primitive, kind, width, height)).join('\n    ');
  const title = `${candidate.id} ${kind} proxy control`;
  const depthRange = kind === 'depth' ? ' data-depth-range="near-white far-black"' : '';
  const normalEncoding = kind === 'normal' ? ' data-normal-encoding="rgb-object-space"' : '';
  const maskMode = kind === 'mask' ? ' data-mask-mode="silhouette"' : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${xml(title)}" data-proxy-render="${xml(kind)}"${depthRange}${normalEncoding}${maskMode}>
  <rect width="100%" height="100%" fill="${background}"/>
  <g data-layer="proxy-primitives" data-candidate-id="${xml(candidate.id)}" data-primitive-count="${packet.proxyPrimitives.length}">
    ${body}
  </g>
  <text x="12" y="20" fill="${kind === 'mask' || kind === 'depth' ? 'rgba(255,255,255,0.68)' : 'rgba(238,246,214,0.72)'}" font-size="12" font-family="Menlo, Monaco, monospace">${xml(title)}</text>
</svg>`;
}

export function createLirmSpeciationArmatureProxyRenderBundle({ witness, candidate, candidateId } = {}) {
  const selectedCandidate = candidate || witness?.candidates?.find(item => item.id === candidateId);
  if (!witness || !selectedCandidate) {
    throw new Error('createLirmSpeciationArmatureProxyRenderBundle requires a witness and candidate or candidateId');
  }
  const packet = createLirmSpeciationArmatureControlPacket({ witness, candidate: selectedCandidate });
  const candidateDir = selectedCandidate.id;
  const mapKinds = ['clay', 'depth', 'normal', 'mask', 'semantic'];
  const renderMaps = mapKinds.map(kind => ({
    kind,
    path: `${candidateDir}/${kind}-control.svg`,
    svg: renderProxyMapSvg({ candidate: selectedCandidate, packet, kind }),
  }));
  return {
    schema: LIRM_SPECIATION_ARMATURE_PROXY_RENDER_BUNDLE_SCHEMA,
    route: LIRM_SPECIATION_ARMATURE_PROXY_RENDER_ROUTE,
    sourceWitnessId: witness.witnessId,
    sourceWitnessRoute: witness.route,
    candidateId: selectedCandidate.id,
    seed: selectedCandidate.seed,
    gestalt: selectedCandidate.bodyPlan.gestalt,
    silhouette: selectedCandidate.bodyPlan.silhouette,
    camera: {
      projection: 'orthographic',
      view: 'front-three-quarter',
      coordinateFrame: 'normalized-proxy-primitives',
      note: 'software SVG projection of packet proxy primitives, not mesh render',
    },
    proxyPrimitiveCount: packet.proxyPrimitives.length,
    semanticHandles: selectedCandidate.semanticHandles,
    contactPoints: selectedCandidate.contactPoints,
    renderMaps,
    falseClosureGuards: {
      finishedCreatureClaim: 'forbidden',
      generatorFiringClaim: 'not_yet_fired',
      proxyRenderClaim: 'depth_normal_conditioning_witness_only',
    },
  };
}

export async function writeLirmSpeciationArmatureProxyRenderWitness(options = {}) {
  const outDir = options.outDir || join(process.cwd(), 'artifacts', 'lirm-speciation-armature-proxy-renders-v0');
  const seed = String(options.seed || DEFAULT_SEED);
  const candidateCount = Math.max(1, Number(options.candidateCount || DEFAULT_CANDIDATE_COUNT));
  const columns = Math.max(1, Number(options.columns || DEFAULT_COLUMNS));
  const witness = options.witness || createLirmSpeciationArmatureWitness({ seed, candidateCount, columns });
  const candidateIds = options.candidateIds || ['lirm-armature-08', 'lirm-armature-11', 'lirm-armature-16', 'lirm-armature-22', 'lirm-armature-24'];
  await mkdir(outDir, { recursive: true });
  const bundles = [];
  const outputBundles = [];
  for (const candidateId of candidateIds) {
    const bundle = createLirmSpeciationArmatureProxyRenderBundle({ witness, candidateId });
    const candidateDir = join(outDir, candidateId);
    await mkdir(candidateDir, { recursive: true });
    await writeFile(join(candidateDir, 'bundle.json'), `${JSON.stringify({ ...bundle, renderMaps: bundle.renderMaps.map(map => ({ kind: map.kind, path: map.path })) }, null, 2)}\n`);
    for (const map of bundle.renderMaps) {
      await writeFile(join(outDir, map.path), map.svg);
    }
    bundles.push(bundle);
    outputBundles.push({
      candidateId,
      bundle: `${candidateId}/bundle.json`,
      maps: bundle.renderMaps.map(map => ({ kind: map.kind, path: map.path })),
    });
  }
  const receipt = {
    schema: LIRM_SPECIATION_ARMATURE_PROXY_RENDER_WITNESS_SCHEMA,
    route: LIRM_SPECIATION_ARMATURE_PROXY_RENDER_ROUTE,
    seed,
    sourceWitnessId: witness.witnessId,
    candidateIds,
    bundles: bundles.map(bundle => ({
      schema: bundle.schema,
      candidateId: bundle.candidateId,
      camera: bundle.camera,
      proxyPrimitiveCount: bundle.proxyPrimitiveCount,
      renderMaps: bundle.renderMaps.map(map => ({ kind: map.kind, path: map.path })),
    })),
    falseClosureGuards: {
      finishedCreatureClaim: 'forbidden',
      generatorFiringClaim: 'not_yet_fired',
      proxyRenderClaim: 'depth_normal_conditioning_witness_only',
    },
    outputInventory: {
      receipt: 'receipt.json',
      bundles: outputBundles,
    },
  };
  const receiptPath = join(outDir, 'receipt.json');
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return {
    schema: LIRM_SPECIATION_ARMATURE_PROXY_RENDER_WRITE_RESULT_SCHEMA,
    route: LIRM_SPECIATION_ARMATURE_PROXY_RENDER_ROUTE,
    outDir,
    seed,
    receiptPath,
    candidateIds,
    bundleCount: bundles.length,
  };
}

const vec3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
const add3 = (a, b) => vec3(a.x + b.x, a.y + b.y, a.z + b.z);
const sub3 = (a, b) => vec3(a.x - b.x, a.y - b.y, a.z - b.z);
const mul3 = (a, s) => vec3(a.x * s, a.y * s, a.z * s);
const dot3 = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const len3 = a => Math.hypot(a.x, a.y, a.z);
const norm3 = a => {
  const length = len3(a) || 1;
  return vec3(a.x / length, a.y / length, a.z / length);
};
const abs3 = a => vec3(Math.abs(a.x), Math.abs(a.y), Math.abs(a.z));
const max3 = (a, b) => vec3(Math.max(a.x, b.x), Math.max(a.y, b.y), Math.max(a.z, b.z));

function rotateY(point, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: point.x * cos - point.z * sin,
    y: point.y,
    z: point.x * sin + point.z * cos,
  };
}

function smoothMin(a, b, k) {
  const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1);
  return (b * (1 - h)) + (a * h) - (k * h * (1 - h));
}

function primitiveAxis(primitive) {
  if (primitive.pairMember === 'left' || primitive.pairMember === 'right') {
    const lateral = primitive.pairMember === 'right' ? 0.28 : -0.28;
    const forward = primitive.t ? (primitive.t - 0.5) * 0.28 : 0;
    return norm3(vec3(forward, -1, lateral));
  }
  const side = primitive.side === 'right' ? 1 : primitive.side === 'left' ? -1 : 0;
  const forward = primitive.t ? (primitive.t - 0.5) * 0.28 : 0;
  return norm3(vec3(forward, side || 0.3, 0.18));
}

function createImplicitPrimitives(candidate, controlFactors) {
  const normalizedControlFactors = controlFactors || normalizeSupportControlFactors();
  const packet = createLirmSpeciationArmatureControlPacket({
    witness: { candidates: [candidate], witnessId: 'inline' },
    candidate,
    controlFactors: normalizedControlFactors.requested,
  });
  return packet.proxyPrimitives.map((primitive, index) => {
    const center = vec3(primitive.center.x, primitive.center.y, primitive.center.z);
    if (primitive.kind === 'capsule') {
      const axis = primitiveAxis(primitive);
      const halfLength = (primitive.length || primitive.radius || 0.08) * 0.48;
      return {
        ...primitive,
        index,
        implicitKind: 'capsule',
        center,
        radius: Math.max(0.018, primitive.radius || 0.025),
        endpoints: {
          a: sub3(center, mul3(axis, halfLength)),
          b: add3(center, mul3(axis, halfLength)),
        },
      };
    }
    if (primitive.kind === 'box') {
      return {
        ...primitive,
        index,
        implicitKind: 'rounded_box',
        center,
        radius: Math.max(0.012, primitive.size?.z || 0.025),
        halfSize: {
          x: Math.max(0.035, (primitive.size?.x || 0.08) * 0.52),
          y: Math.max(0.018, (primitive.size?.y || 0.05) * 0.72),
          z: Math.max(0.012, (primitive.size?.z || 0.03) * 1.2),
        },
      };
    }
    return {
      ...primitive,
      index,
      implicitKind: 'sphere',
      center,
      radius: Math.max(0.018, primitive.radius || 0.04),
    };
  });
}

function sdSphere(point, primitive) {
  return len3(sub3(point, primitive.center)) - primitive.radius;
}

function sdCapsule(point, primitive) {
  const pa = sub3(point, primitive.endpoints.a);
  const ba = sub3(primitive.endpoints.b, primitive.endpoints.a);
  const h = clamp(dot3(pa, ba) / Math.max(dot3(ba, ba), 0.00001), 0, 1);
  return len3(sub3(pa, mul3(ba, h))) - primitive.radius;
}

function sdRoundedBox(point, primitive) {
  const q = sub3(abs3(sub3(point, primitive.center)), primitive.halfSize);
  const outside = len3(max3(q, vec3(0, 0, 0)));
  const inside = Math.min(Math.max(q.x, Math.max(q.y, q.z)), 0);
  return outside + inside - primitive.radius;
}

function sdEllipsoid(point, primitive) {
  const offset = sub3(point, primitive.center);
  const normalized = vec3(
    offset.x / primitive.radius.x,
    offset.y / primitive.radius.y,
    offset.z / primitive.radius.z,
  );
  return (len3(normalized) - 1) * Math.min(primitive.radius.x, primitive.radius.y, primitive.radius.z);
}

function primitiveDistance(point, primitive) {
  if (primitive.implicitKind === 'capsule') return sdCapsule(point, primitive);
  if (primitive.implicitKind === 'rounded_box') return sdRoundedBox(point, primitive);
  if (primitive.implicitKind === 'ellipsoid') return sdEllipsoid(point, primitive);
  return sdSphere(point, primitive);
}

function silhouetteMaskHash(mask) {
  const hash = createHash('sha256');
  hash.update(`${mask.width}x${mask.height}:`);
  hash.update(Buffer.from(mask.data.map(value => value ? 1 : 0)));
  return `sha256:${hash.digest('hex')}`;
}

function validateGestaltEnvelope(value) {
  if (!value || typeof value.id !== 'string' || !/^[A-Za-z0-9._-]+$/.test(value.id)) {
    throw new Error('gestalt envelope id must be a filesystem-safe nonempty string');
  }
  const mask = value.mask;
  if (!mask || !Number.isInteger(mask.width) || !Number.isInteger(mask.height) || mask.width < 8 || mask.height < 8) {
    throw new Error('gestalt envelope mask must be at least 8x8');
  }
  if (!Array.isArray(mask.data) || mask.data.length !== mask.width * mask.height) {
    throw new Error('gestalt envelope mask dimensions do not match its data');
  }
  const foregroundCount = mask.data.reduce((count, item) => count + (item ? 1 : 0), 0);
  if (foregroundCount === 0 || foregroundCount === mask.data.length) {
    throw new Error('gestalt envelope mask requires foreground and background');
  }
  const pressure = Number(value.pressure);
  if (!Number.isFinite(pressure) || pressure <= 0) {
    throw new Error('gestalt envelope pressure must be greater than zero');
  }
  if (pressure > 1) throw new Error('gestalt envelope pressure must not exceed one');
  const depthRadius = Number(value.depthRadius ?? 0.2);
  if (!Number.isFinite(depthRadius) || depthRadius <= 0) {
    throw new Error('gestalt envelope depthRadius must be positive');
  }
  const normalizedMask = {
    width: mask.width,
    height: mask.height,
    data: mask.data.map(item => item ? 1 : 0),
  };
  return {
    id: value.id,
    mask: normalizedMask,
    maskHash: silhouetteMaskHash(normalizedMask),
    pressure,
    depthRadius,
    roundness: Math.max(0, Number(value.roundness ?? 0.035)),
    lineage: value.lineage || {},
    signedDistance: createSignedDistanceField(normalizedMask),
  };
}

export function createLirmGestaltEnvelopeFromLatentGeneration({
  shapeSpaceReceipt,
  generationId,
  mask,
  pressure,
  depthRadius = 0.22,
  roundness = 0.045,
  envelopeId = generationId,
} = {}) {
  if (shapeSpaceReceipt?.schema !== 'kaminos.lirm-silhouette-basin-latent.v0') {
    throw new Error('latent gestalt source must use kaminos.lirm-silhouette-basin-latent.v0');
  }
  const effectiveRoute = shapeSpaceReceipt.routeIdentity?.effectiveRoute;
  if (effectiveRoute !== 'mlx-sdf-vae-posterior-basin-perturbation-v0') {
    throw new Error(`latent gestalt source has unexpected effective route: ${effectiveRoute || 'missing'}`);
  }
  const generation = shapeSpaceReceipt.generations?.find(item => item.generationId === generationId);
  if (!generation) {
    throw new Error(`latent gestalt generation not found: ${generationId || 'missing'}`);
  }
  if (generation.acceptedForDownstream !== true) {
    throw new Error(`latent gestalt generation is not accepted for downstream use: ${generationId}`);
  }
  if (!mask || !Number.isInteger(mask.width) || !Number.isInteger(mask.height) || !Array.isArray(mask.data)) {
    throw new Error('latent gestalt generation requires a decoded binary mask');
  }
  const sourceMaskHash = `sha256:${createHash('sha256')
    .update(Buffer.from(mask.data.map(value => value ? 1 : 0)))
    .digest('hex')}`;
  if (sourceMaskHash !== generation.maskHash) {
    throw new Error(`latent gestalt mask hash mismatch for ${generationId}: expected ${generation.maskHash}, got ${sourceMaskHash}`);
  }
  return {
    id: envelopeId,
    mask,
    pressure,
    depthRadius,
    roundness,
    lineage: {
      sourceReceiptSchema: shapeSpaceReceipt.schema,
      requestedRoute: shapeSpaceReceipt.routeIdentity?.requestedRoute,
      effectiveRoute,
      generationId,
      sourceBasinIndex: generation.sourceBasinIndex,
      sourceShapeId: generation.sourceShapeId,
      sourceMaskHash,
      posteriorStrength: generation.strength,
      sourceMaskPath: generation.maskPath,
      acceptedForDownstream: generation.acceptedForDownstream,
    },
  };
}

function bilinearSample(field, px, py) {
  const x = clamp(px, 0, field.width - 1);
  const y = clamp(py, 0, field.height - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(field.width - 1, x0 + 1);
  const y1 = Math.min(field.height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const at = (xx, yy) => field.data[yy * field.width + xx];
  return at(x0, y0) * (1 - tx) * (1 - ty)
    + at(x1, y0) * tx * (1 - ty)
    + at(x0, y1) * (1 - tx) * ty
    + at(x1, y1) * tx * ty;
}

function gestaltEnvelopeDistance(point, envelope) {
  const worldWidth = 2.35;
  const worldHeight = 1.9;
  const px = (point.x / worldWidth + 0.5) * (envelope.signedDistance.width - 1);
  const py = (0.5 - point.y / worldHeight) * (envelope.signedDistance.height - 1);
  const sampled = bilinearSample(envelope.signedDistance, px, py);
  const pixelScale = Math.max(worldWidth / envelope.signedDistance.width, worldHeight / envelope.signedDistance.height);
  const planar = -sampled * pixelScale;
  const outsideX = Math.max(Math.abs(point.x) - worldWidth * 0.5, 0);
  const outsideY = Math.max(Math.abs(point.y) - worldHeight * 0.5, 0);
  const planarWithBounds = planar + Math.hypot(outsideX, outsideY);
  const slab = Math.abs(point.z) - envelope.depthRadius;
  return Math.max(planarWithBounds, slab) - envelope.roundness;
}

function evaluateImplicitField(point, primitives, gestaltEnvelope = null) {
  let fieldDistance = Infinity;
  let closestDistance = Infinity;
  let closestPrimitive = primitives[0];
  for (const primitive of primitives) {
    const distance = primitiveDistance(point, primitive);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestPrimitive = primitive;
    }
    fieldDistance = fieldDistance === Infinity ? distance : smoothMin(fieldDistance, distance, 0.075);
  }
  if (gestaltEnvelope) {
    const envelopeDistance = gestaltEnvelopeDistance(point, gestaltEnvelope);
    fieldDistance = fieldDistance * (1 - gestaltEnvelope.pressure) + envelopeDistance * gestaltEnvelope.pressure;
  }
  return { distance: fieldDistance, closestDistance, primitive: closestPrimitive };
}

function implicitNormal(point, primitives, gestaltEnvelope = null) {
  const e = 0.006;
  const dx = evaluateImplicitField(vec3(point.x + e, point.y, point.z), primitives, gestaltEnvelope).distance
    - evaluateImplicitField(vec3(point.x - e, point.y, point.z), primitives, gestaltEnvelope).distance;
  const dy = evaluateImplicitField(vec3(point.x, point.y + e, point.z), primitives, gestaltEnvelope).distance
    - evaluateImplicitField(vec3(point.x, point.y - e, point.z), primitives, gestaltEnvelope).distance;
  const dz = evaluateImplicitField(vec3(point.x, point.y, point.z + e), primitives, gestaltEnvelope).distance
    - evaluateImplicitField(vec3(point.x, point.y, point.z - e), primitives, gestaltEnvelope).distance;
  return norm3(vec3(dx, dy, dz));
}

export const LIRM_ARMATURE_PROGRAM_FIXED_PROJECTION_ENVELOPE = Object.freeze({
  screenWidthWorld: 2.65,
  screenHeightWorld: 2.05,
  rayOriginDepth: 1.46,
  maxTravel: 3.0,
  framingPolicy: 'fixed-world-envelope-no-variant-autofit',
});

function raymarchImplicitPixel({
  pixelX,
  pixelY,
  width,
  height,
  primitives,
  gestaltEnvelope = null,
  cameraYaw = 0.42,
}) {
  const screenX = ((pixelX + 0.5) / width - 0.5)
    * LIRM_ARMATURE_PROGRAM_FIXED_PROJECTION_ENVELOPE.screenWidthWorld;
  const screenY = (0.5 - (pixelY + 0.5) / height)
    * LIRM_ARMATURE_PROGRAM_FIXED_PROJECTION_ENVELOPE.screenHeightWorld;
  const origin = rotateY(
    vec3(screenX, screenY, LIRM_ARMATURE_PROGRAM_FIXED_PROJECTION_ENVELOPE.rayOriginDepth),
    cameraYaw,
  );
  const direction = norm3(rotateY(vec3(0, 0, -1), cameraYaw));
  let travel = 0;
  const maxTravel = LIRM_ARMATURE_PROGRAM_FIXED_PROJECTION_ENVELOPE.maxTravel;
  for (let step = 0; step < 88 && travel < maxTravel; step += 1) {
    const point = add3(origin, mul3(direction, travel));
    const field = evaluateImplicitField(point, primitives, gestaltEnvelope);
    if (field.distance < 0.0065) {
      const normal = implicitNormal(point, primitives, gestaltEnvelope);
      return {
        hit: true,
        point,
        travel,
        depth01: clamp(travel / maxTravel, 0, 1),
        normal,
        primitive: field.primitive,
      };
    }
    travel += clamp(field.distance * 0.62, 0.008, 0.08);
  }
  return { hit: false };
}

function rgbFill(r, g, b) {
  return `rgb(${Math.round(clamp(r, 0, 255))},${Math.round(clamp(g, 0, 255))},${Math.round(clamp(b, 0, 255))})`;
}

function implicitClayFill(hit) {
  const roleBase = {
    body_mass: [126, 151, 88],
    head_orientation: [178, 94, 58],
    terminal_mouth: [82, 22, 36],
    limb_bud: [157, 102, 62],
    shell_plate: [86, 94, 122],
    contact_point: [183, 87, 205],
    posteriorBulbousMass: [111, 137, 72],
    bodyBridge: [129, 146, 78],
    anteriorChestMass: [157, 124, 70],
    anteriorUprightNeck: [178, 98, 57],
    anteriorHead: [190, 72, 50],
    radialContactLimb: [142, 87, 57],
    groundContact: [183, 87, 205],
  };
  const base = roleBase[hit.primitive.role] || [128, 137, 93];
  const lightDir = norm3(vec3(-0.45, 0.64, 0.62));
  const rimDir = norm3(vec3(0.7, -0.1, 0.32));
  const diffuse = clamp(dot3(hit.normal, lightDir), 0, 1);
  const rim = Math.pow(clamp(dot3(hit.normal, rimDir), 0, 1), 2.6);
  const shade = 0.38 + diffuse * 0.58 + rim * 0.28;
  return rgbFill(base[0] * shade, base[1] * shade, base[2] * shade);
}

function implicitTrellisClayFill(hit) {
  const roleBase = {
    body_mass: [142, 132, 106],
    head_orientation: [154, 124, 92],
    terminal_mouth: [70, 38, 35],
    limb_bud: [118, 93, 66],
    shell_plate: [96, 93, 84],
    contact_point: [112, 88, 104],
    posteriorBulbousMass: [137, 126, 101],
    bodyBridge: [143, 127, 96],
    anteriorChestMass: [151, 122, 87],
    anteriorUprightNeck: [157, 112, 79],
    anteriorHead: [164, 102, 75],
    radialContactLimb: [119, 91, 64],
    groundContact: [112, 88, 104],
  };
  const base = roleBase[hit.primitive.role] || [138, 126, 102];
  const lightDir = norm3(vec3(-0.36, 0.7, 0.62));
  const rimDir = norm3(vec3(0.62, -0.08, 0.38));
  const diffuse = clamp(dot3(hit.normal, lightDir), 0, 1);
  const rim = Math.pow(clamp(dot3(hit.normal, rimDir), 0, 1), 2.2);
  const shade = 0.48 + diffuse * 0.5 + rim * 0.22;
  return rgbFill(base[0] * shade, base[1] * shade, base[2] * shade);
}

function implicitDepthFill(hit) {
  const level = 244 - hit.depth01 * 216;
  return rgbFill(level, level, level);
}

function implicitNormalFill(hit) {
  return rgbFill(
    (hit.normal.x * 0.5 + 0.5) * 255,
    ((-hit.normal.y) * 0.5 + 0.5) * 255,
    (hit.normal.z * 0.5 + 0.5) * 255,
  );
}

function implicitMapFill(hit, kind) {
  if (kind === 'depth') return implicitDepthFill(hit);
  if (kind === 'normal') return implicitNormalFill(hit);
  if (kind === 'mask') return 'rgb(255,255,255)';
  if (kind === 'semantic') return semanticFill(hit.primitive.role).replaceAll(' ', '');
  return implicitClayFill(hit);
}

function renderImplicitMapsSvg({
  candidate,
  primitives,
  gestaltEnvelope = null,
  pixelWidth = 192,
  pixelHeight = 144,
  cameraYaw = 0.42,
}) {
  const displayWidth = 320;
  const displayHeight = 240;
  const fieldKind = gestaltEnvelope ? 'smooth-sdf-metaball-silhouette-morph' : 'smooth-sdf-metaball';
  const outputSuffix = gestaltEnvelope ? 'composite' : 'implicit';
  const envelopeAttribute = gestaltEnvelope ? ` data-gestalt-envelope-id="${xml(gestaltEnvelope.id)}"` : '';
  const mapKinds = ['clay', 'depth', 'normal', 'mask', 'semantic'];
  const rectsByKind = Object.fromEntries(mapKinds.map(kind => [kind, []]));
  const primitivePixels = new Map(primitives.map(primitive => [primitive.index, []]));
  for (let y = 0; y < pixelHeight; y += 1) {
    for (let x = 0; x < pixelWidth; x += 1) {
      const hit = raymarchImplicitPixel({
        pixelX: x,
        pixelY: y,
        width: pixelWidth,
        height: pixelHeight,
        primitives,
        gestaltEnvelope,
        cameraYaw,
      });
      if (!hit.hit) continue;
      primitivePixels.get(hit.primitive.index)?.push({
        x,
        y,
        depth01: hit.depth01,
      });
      for (const kind of mapKinds) {
        rectsByKind[kind].push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${implicitMapFill(hit, kind)}"/>`);
      }
    }
  }
  const backgrounds = {
    clay: '#07130f',
    depth: 'rgb(16,16,16)',
    normal: 'rgb(128,128,255)',
    mask: '#000000',
    semantic: '#07130f',
  };
  const attrs = {
    clay: '',
    depth: ' data-depth-source="ray-surface-hit" data-depth-range="near-white far-black"',
    normal: ' data-normal-source="field-gradient" data-normal-encoding="rgb-object-space"',
    mask: ' data-mask-mode="surface-hit-silhouette"',
    semantic: '',
  };
  const renderMaps = mapKinds.map(kind => {
    const title = `${candidate.id} ${kind} implicit 3D control`;
    return {
      kind,
      path: `${candidate.id}/${kind}-${outputSuffix}.svg`,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${displayWidth}" height="${displayHeight}" viewBox="0 0 ${pixelWidth} ${pixelHeight}" role="img" aria-label="${xml(title)}" data-implicit-render="${xml(kind)}" data-render-mode="raymarched-implicit-field" data-field-kind="${fieldKind}"${envelopeAttribute}${attrs[kind]}>
  <metadata>candidate=${xml(candidate.id)}; terminal mouth is a semantic surface primitive; pixels are ray hits against an implicit 3D field${gestaltEnvelope ? `; gestaltEnvelope=${xml(gestaltEnvelope.id)}; pressure=${gestaltEnvelope.pressure}` : ''}</metadata>
  <rect x="0" y="0" width="${pixelWidth}" height="${pixelHeight}" fill="${backgrounds[kind]}"/>
  <g data-layer="implicit-surface-pixels" data-candidate-id="${xml(candidate.id)}" data-pixel-grid="${pixelWidth}x${pixelHeight}" data-primitive-count="${primitives.length}" style="shape-rendering:crispEdges">
    ${rectsByKind[kind].join('\n    ')}
  </g>
</svg>`,
    };
  });
  const primitiveVisibility = primitives.map(primitive => {
    const pixels = primitivePixels.get(primitive.index) || [];
    const sum = pixels.reduce((acc, pixel) => ({
      x: acc.x + pixel.x,
      y: acc.y + pixel.y,
      depth: acc.depth + pixel.depth01,
    }), { x: 0, y: 0, depth: 0 });
    return {
      id: primitive.id || `${primitive.role}-${primitive.index}`,
      index: primitive.index,
      role: primitive.role,
      pairId: primitive.pairId || null,
      pairMember: primitive.pairMember || null,
      visiblePixelCount: pixels.length,
      projectedCentroid: pixels.length > 0
        ? {
          x: round(sum.x / pixels.length),
          y: round(sum.y / pixels.length),
          depth01: round(sum.depth / pixels.length),
        }
        : null,
    };
  });
  return {
    renderMaps,
    projectionEvidence: {
      schema: 'kaminos.projected-support-identity-evidence.v0',
      pixelGrid: { width: pixelWidth, height: pixelHeight },
      cameraYawRadians: cameraYaw,
      organismalMaskPixelCount: primitiveVisibility.reduce(
        (sum, primitive) => sum + primitive.visiblePixelCount,
        0,
      ),
      projectedContactMarkerOccupancy: primitiveVisibility
        .filter(primitive => primitive.role === 'contact_point')
        .reduce((sum, primitive) => sum + primitive.visiblePixelCount, 0),
      projectedSupportGeometryOccupancy: primitiveVisibility
        .filter(primitive => primitive.role === 'limb_bud')
        .reduce((sum, primitive) => sum + primitive.visiblePixelCount, 0),
      primitiveVisibility,
    },
  };
}

function renderImplicitTrellisSourceSvg({
  candidate,
  primitives,
  gestaltEnvelope = null,
  pixelWidth = 256,
  pixelHeight = 192,
  cameraYaw = 0.42,
}) {
  const displaySize = 512;
  const fieldKind = gestaltEnvelope ? 'smooth-sdf-metaball-silhouette-morph' : 'smooth-sdf-metaball';
  const envelopeAttribute = gestaltEnvelope ? ` data-gestalt-envelope-id="${xml(gestaltEnvelope.id)}"` : '';
  const rects = [];
  let minX = pixelWidth;
  let minY = pixelHeight;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < pixelHeight; y += 1) {
    for (let x = 0; x < pixelWidth; x += 1) {
      const hit = raymarchImplicitPixel({
        pixelX: x,
        pixelY: y,
        width: pixelWidth,
        height: pixelHeight,
        primitives,
        gestaltEnvelope,
        cameraYaw,
      });
      if (!hit.hit) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + 1);
      maxY = Math.max(maxY, y + 1);
      rects.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${implicitTrellisClayFill(hit)}"/>`);
    }
  }
  const pad = 12;
  const cropX = Math.max(0, minX - pad);
  const cropY = Math.max(0, minY - pad);
  const cropW = Math.min(pixelWidth, maxX + pad) - cropX;
  const cropH = Math.min(pixelHeight, maxY + pad) - cropY;
  const viewBox = maxX >= 0
    ? `${cropX} ${cropY} ${Math.max(cropW, 1)} ${Math.max(cropH, 1)}`
    : `0 0 ${pixelWidth} ${pixelHeight}`;
  const title = `${candidate.id} tight transparent implicit clay Trellis source`;
  return {
    kind: 'trellis-clay',
    path: `${candidate.id}/trellis-source.svg`,
    rasterPath: `${candidate.id}/trellis-source.png`,
    effectiveSource: 'tight-cropped-transparent-implicit-clay',
    requiredFor: ['trellis_clay_probe', 'trellis_prior_assay', 'sam3_isolation'],
    framing: {
      background: 'transparent',
      crop: 'tight-surface-bounds',
      sourcePixelGrid: `${pixelWidth}x${pixelHeight}`,
      displayedPixels: `${displaySize}x${displaySize}`,
    },
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${displaySize}" height="${displaySize}" viewBox="${viewBox}" role="img" aria-label="${xml(title)}" data-trellis-source="implicit-clay-tight" data-background="transparent" data-crop="tight-surface-bounds" data-render-mode="raymarched-implicit-field" data-field-kind="${fieldKind}"${envelopeAttribute}>
  <metadata>candidate=${xml(candidate.id)}; tight transparent crop for Trellis mesh probing; not a depth/normal/control map${gestaltEnvelope ? `; gestaltEnvelope=${xml(gestaltEnvelope.id)}; pressure=${gestaltEnvelope.pressure}` : ''}</metadata>
  <g data-layer="implicit-trellis-source-pixels" data-candidate-id="${xml(candidate.id)}" data-pixel-grid="${pixelWidth}x${pixelHeight}" data-primitive-count="${primitives.length}" style="shape-rendering:crispEdges">
    ${rects.join('\n    ')}
  </g>
</svg>`,
  };
}

export function createLirmSpeciationArmatureImplicitBodyBundle({
  witness,
  candidate,
  candidateId,
  controlFactors: requestedControlFactors,
} = {}) {
  const selectedCandidate = candidate || witness?.candidates?.find(item => item.id === candidateId);
  if (!witness || !selectedCandidate) {
    throw new Error('createLirmSpeciationArmatureImplicitBodyBundle requires a witness and candidate or candidateId');
  }
  const controlFactors = normalizeSupportControlFactors(requestedControlFactors);
  const implicitPrimitives = createImplicitPrimitives(selectedCandidate, controlFactors);
  const cameraYaw = controlFactors.effective.cameraYawRadians;
  const renderResult = renderImplicitMapsSvg({
    candidate: selectedCandidate,
    primitives: implicitPrimitives,
    cameraYaw,
  });
  const renderMaps = renderResult.renderMaps;
  const trellisSource = renderImplicitTrellisSourceSvg({
    candidate: selectedCandidate,
    primitives: implicitPrimitives,
    cameraYaw,
  });
  const implicitPrimitiveInventory = implicitPrimitives.map(primitive => ({
    id: primitive.id || `${primitive.role}-${primitive.index}`,
    index: primitive.index,
    role: primitive.role,
    implicitKind: primitive.implicitKind,
    sourceHandleId: primitive.sourceHandleId || null,
    pairId: primitive.pairId || null,
    pairMember: primitive.pairMember || null,
    side: primitive.side || null,
    contactRole: primitive.contactRole || null,
    entersBodySdf: true,
  }));
  return {
    schema: LIRM_SPECIATION_ARMATURE_IMPLICIT_BODY_BUNDLE_SCHEMA,
    route: LIRM_SPECIATION_ARMATURE_IMPLICIT_BODY_ROUTE,
    sourceWitnessId: witness.witnessId,
    sourceWitnessRoute: witness.route,
    candidateId: selectedCandidate.id,
    seed: selectedCandidate.seed,
    gestalt: selectedCandidate.bodyPlan.gestalt,
    silhouette: selectedCandidate.bodyPlan.silhouette,
    renderMode: 'raymarched-implicit-field',
    controlFactors,
    fieldModel: {
      kind: 'smooth-sdf-metaball',
      surfaceThreshold: 0.0065,
      smoothUnionK: 0.075,
      primitiveSources: [
        'gestalt_body_plan',
        'body_mass_axis_samples',
        'terminal_mouth_handle',
        'head_handle',
        ...(controlFactors.effective.limbEmission === 'centerline' ? ['limb_buds'] : []),
        'shell_plates',
        ...(controlFactors.effective.contactGeometry === 'body-sdf' ? ['contact_points'] : []),
      ],
      contactSemantics: controlFactors.effective.contactGeometry === 'body-sdf'
        ? 'included-in-body-sdf'
        : 'sidecar-only',
      supportSemantics: controlFactors.effective.limbEmission === 'centerline'
        ? 'sidecar-plus-centerline-body-sdf'
        : 'bilateral-sidecar-only',
    },
    camera: {
      projection: 'orthographic',
      view: controlFactors.effective.projection === 'legacy-yaw-0.42'
        ? 'front-three-quarter'
        : 'pairing-legible-three-quarter',
      yawRadians: cameraYaw,
      coordinateFrame: 'normalized-implicit-body',
      raySource: 'software-sdf-raymarch',
    },
    implicitPrimitiveCount: implicitPrimitives.length,
    implicitPrimitiveInventory,
    supportSemanticInventory: createSupportSemanticInventory(selectedCandidate),
    projectionEvidence: renderResult.projectionEvidence,
    semanticHandles: selectedCandidate.semanticHandles,
    contactPoints: selectedCandidate.contactPoints,
    renderMaps,
    trellisSource,
    falseClosureGuards: {
      finishedCreatureClaim: 'forbidden',
      generatorFiringClaim: 'not_yet_fired',
      implicitBodyClaim: 'raymarched_control_surface_only',
      projectionProxyClaim: 'superseded_by_implicit_surface',
    },
  };
}

function validateArmatureProgramParameters(armatureProgram, parameters) {
  if (!armatureProgram || typeof armatureProgram !== 'object') throw new Error('armature program is required');
  if (typeof armatureProgram.id !== 'string' || !armatureProgram.id.trim()) throw new Error('armature program requires stable id');
  if (typeof armatureProgram.parameterVocabulary !== 'string' || !armatureProgram.parameterVocabulary.trim()) {
    throw new Error('armature program requires parameter vocabulary');
  }
  if (!Array.isArray(armatureProgram.parameterSpecs) || armatureProgram.parameterSpecs.length === 0) {
    throw new Error('armature program requires parameter specs');
  }
  if (typeof armatureProgram.createPrimitives !== 'function') throw new Error('armature program requires primitive factory');
  const normalized = {};
  for (const spec of armatureProgram.parameterSpecs) {
    const value = Number(parameters?.[spec.id]);
    if (!Number.isFinite(value)) throw new Error(`missing armature program parameter: ${spec.id}`);
    if (value < spec.min || value > spec.max) throw new Error(`armature program parameter out of range: ${spec.id}`);
    normalized[spec.id] = value;
  }
  if (Object.keys(parameters ?? {}).length !== armatureProgram.parameterSpecs.length) {
    throw new Error('armature program parameter identity mismatch');
  }
  return normalized;
}

function adaptArmatureProgramPrimitive(primitive, index) {
  if (!primitive || typeof primitive.role !== 'string' || !primitive.role.trim()) {
    throw new Error(`armature primitive ${index} requires semantic role`);
  }
  if (primitive.kind === 'ellipsoid') {
    const radii = [primitive.radius?.x, primitive.radius?.y, primitive.radius?.z];
    if (![primitive.center?.x, primitive.center?.y, primitive.center?.z, ...radii].every(Number.isFinite)
        || radii.some(value => value <= 0)) {
      throw new Error(`invalid ellipsoid armature primitive: ${index}`);
    }
    return { ...primitive, index, implicitKind: 'ellipsoid' };
  }
  if (primitive.kind === 'capsule') {
    if (![primitive.a?.x, primitive.a?.y, primitive.a?.z, primitive.b?.x, primitive.b?.y, primitive.b?.z, primitive.radius]
      .every(Number.isFinite) || primitive.radius <= 0) {
      throw new Error(`invalid capsule armature primitive: ${index}`);
    }
    return {
      ...primitive,
      index,
      implicitKind: 'capsule',
      center: mul3(add3(primitive.a, primitive.b), 0.5),
      endpoints: { a: primitive.a, b: primitive.b },
    };
  }
  throw new Error(`unsupported armature primitive kind: ${primitive.kind}`);
}

export function createLirmArmatureProgramImplicitBodyBundle({
  armatureProgram,
  parameters,
  candidateId = 'lirm-armature-program-candidate',
  pixelWidth = 192,
  pixelHeight = 144,
  cameraYawRadians = 0.42,
} = {}) {
  if (typeof candidateId !== 'string' || !/^[A-Za-z0-9._-]+$/.test(candidateId)) {
    throw new Error('armature program candidateId must be filesystem-safe');
  }
  if (!Number.isInteger(pixelWidth) || !Number.isInteger(pixelHeight) || pixelWidth < 32 || pixelHeight < 24) {
    throw new Error('armature program conditioning raster must be at least 32x24');
  }
  if (!Number.isFinite(cameraYawRadians)) {
    throw new Error('armature program cameraYawRadians must be finite');
  }
  const normalizedParameters = validateArmatureProgramParameters(armatureProgram, parameters);
  const sourcePrimitives = armatureProgram.createPrimitives(normalizedParameters);
  if (!Array.isArray(sourcePrimitives) || sourcePrimitives.length === 0) {
    throw new Error('armature program primitive factory returned no primitives');
  }
  const implicitPrimitives = sourcePrimitives.map(adaptArmatureProgramPrimitive);
  const candidate = { id: candidateId };
  const renderResult = renderImplicitMapsSvg({
    candidate,
    primitives: implicitPrimitives,
    pixelWidth,
    pixelHeight,
    cameraYaw: cameraYawRadians,
  });
  const renderMaps = renderResult.renderMaps;
  const trellisSource = renderImplicitTrellisSourceSvg({
    candidate,
    primitives: implicitPrimitives,
    pixelWidth,
    pixelHeight,
    cameraYaw: cameraYawRadians,
  });
  return {
    schema: LIRM_ARMATURE_PROGRAM_IMPLICIT_BODY_BUNDLE_SCHEMA,
    route: LIRM_ARMATURE_PROGRAM_IMPLICIT_BODY_ROUTE,
    requestedRoute: LIRM_ARMATURE_PROGRAM_IMPLICIT_BODY_ROUTE,
    effectiveRoute: LIRM_ARMATURE_PROGRAM_IMPLICIT_BODY_ROUTE,
    candidateId,
    armatureProgram: {
      id: armatureProgram.id,
      parameterVocabulary: armatureProgram.parameterVocabulary,
      parameterSpecs: armatureProgram.parameterSpecs,
    },
    parameters: normalizedParameters,
    renderMode: 'raymarched-implicit-field',
    fieldModel: {
      kind: 'smooth-sdf-armature-program',
      surfaceThreshold: 0.0065,
      smoothUnionK: 0.075,
      primitiveKinds: [...new Set(implicitPrimitives.map(primitive => primitive.implicitKind))],
    },
    effectiveConfig: {
      pixelWidth,
      pixelHeight,
      projection: 'orthographic',
      view: 'front-three-quarter',
      cameraYawRadians,
      fixedProjectionEnvelope: { ...LIRM_ARMATURE_PROGRAM_FIXED_PROJECTION_ENVELOPE },
      raySource: 'software-sdf-raymarch',
    },
    implicitPrimitiveCount: implicitPrimitives.length,
    semanticRoles: [...new Set(implicitPrimitives.map(primitive => primitive.role))],
    projectionEvidence: renderResult.projectionEvidence,
    renderMaps,
    trellisSource,
    falseClosureGuards: {
      finishedCreatureClaim: 'forbidden',
      generatorFiringClaim: 'not_yet_fired',
      programFitClaim: 'parameters_supplied_by_caller',
      implicitBodyClaim: 'raymarched_control_surface_only',
    },
  };
}

export async function writeLirmArmatureProgramImplicitBodyWitness({
  outDir = join(process.cwd(), 'artifacts', 'lirm-armature-program-implicit-body-v0'),
  armatureProgram,
  parameters,
  candidateId = 'lirm-armature-program-candidate',
  pixelWidth = 192,
  pixelHeight = 144,
  cameraYawRadians = 0.42,
} = {}) {
  await mkdir(outDir, { recursive: true });
  const receiptPath = join(outDir, 'receipt.json');
  const requestedConfig = { pixelWidth, pixelHeight, cameraYawRadians };
  const initialized = {
    schema: LIRM_ARMATURE_PROGRAM_IMPLICIT_BODY_WITNESS_SCHEMA,
    status: 'running',
    phase: 'writer_initialized',
    failurePhase: null,
    requestedRoute: LIRM_ARMATURE_PROGRAM_IMPLICIT_BODY_ROUTE,
    effectiveRoute: null,
    candidateId,
    requestedArmatureProgram: {
      id: armatureProgram?.id ?? null,
      parameterVocabulary: armatureProgram?.parameterVocabulary ?? null,
    },
    requestedConfig,
    effectiveConfig: null,
    lastTrustworthyEvidence: 'invocation recorded; no bundle accepted',
    outputInventory: { bundle: null, maps: [], trellisSource: null },
    outputEvidence: [],
  };
  await writeFile(receiptPath, `${JSON.stringify(initialized, null, 2)}\n`);
  try {
    const bundle = createLirmArmatureProgramImplicitBodyBundle({
      armatureProgram,
      parameters,
      candidateId,
      pixelWidth,
      pixelHeight,
      cameraYawRadians,
    });
    const candidateDir = join(outDir, candidateId);
    await mkdir(candidateDir, { recursive: true });
    const outputEvidence = [];
    const bundleRelativePath = `${candidateId}/bundle.json`;
    const bundlePath = join(outDir, bundleRelativePath);
    await writeFile(bundlePath, `${JSON.stringify({
      ...bundle,
      renderMaps: bundle.renderMaps.map(map => ({ kind: map.kind, path: map.path })),
      trellisSource: { ...bundle.trellisSource, svg: undefined },
    }, null, 2)}\n`);
    outputEvidence.push(await createOutputEvidence(bundlePath, bundleRelativePath));

    const maps = [];
    for (const map of bundle.renderMaps) {
      const svgPath = join(outDir, map.path);
      const rasterPath = map.path.replace(/\.svg$/, '.png');
      const pngPath = join(outDir, rasterPath);
      await writeFile(svgPath, map.svg);
      rasterizeSvgWithSips(svgPath, pngPath);
      outputEvidence.push(
        await createOutputEvidence(svgPath, map.path),
        await createOutputEvidence(pngPath, rasterPath),
      );
      maps.push({ kind: map.kind, path: map.path, rasterPath });
    }

    const trellisSvgPath = join(outDir, bundle.trellisSource.path);
    const trellisRasterPath = join(outDir, bundle.trellisSource.rasterPath);
    await writeFile(trellisSvgPath, bundle.trellisSource.svg);
    rasterizeSvgWithSips(trellisSvgPath, trellisRasterPath);
    outputEvidence.push(
      await createOutputEvidence(trellisSvgPath, bundle.trellisSource.path),
      await createOutputEvidence(trellisRasterPath, bundle.trellisSource.rasterPath),
    );
    const receipt = {
      ...initialized,
      status: 'complete',
      phase: 'witness_written',
      effectiveRoute: bundle.effectiveRoute,
      armatureProgram: bundle.armatureProgram,
      parameters: bundle.parameters,
      effectiveConfig: bundle.effectiveConfig,
      implicitPrimitiveCount: bundle.implicitPrimitiveCount,
      semanticRoles: bundle.semanticRoles,
      lastTrustworthyEvidence: 'all conditioning maps and Trellis source written with byte and hash evidence',
      falseClosureGuards: bundle.falseClosureGuards,
      outputInventory: {
        bundle: bundleRelativePath,
        maps,
        trellisSource: {
          kind: bundle.trellisSource.kind,
          path: bundle.trellisSource.path,
          rasterPath: bundle.trellisSource.rasterPath,
        },
      },
      outputEvidence,
    };
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    return {
      schema: LIRM_ARMATURE_PROGRAM_IMPLICIT_BODY_WRITE_RESULT_SCHEMA,
      route: LIRM_ARMATURE_PROGRAM_IMPLICIT_BODY_ROUTE,
      outDir,
      receiptPath,
      candidateId,
      bundlePath,
    };
  } catch (error) {
    await writeFile(receiptPath, `${JSON.stringify({
      ...initialized,
      status: 'failed',
      phase: 'bundle-creation-or-write',
      failurePhase: 'bundle-creation-or-write',
      errorMessage: String(error?.message || error),
    }, null, 2)}\n`);
    throw error;
  }
}

export function createLirmSpeciationArmatureGestaltCompositeBundle({ witness, candidate, candidateId, gestaltEnvelope } = {}) {
  const selectedCandidate = candidate || witness?.candidates?.find(item => item.id === candidateId);
  if (!witness || !selectedCandidate) {
    throw new Error('createLirmSpeciationArmatureGestaltCompositeBundle requires a witness and candidate or candidateId');
  }
  const envelope = validateGestaltEnvelope(gestaltEnvelope);
  const compositeId = `${selectedCandidate.id}__${envelope.id}`;
  const renderCandidate = { ...selectedCandidate, id: compositeId };
  const implicitPrimitives = createImplicitPrimitives(selectedCandidate);
  const renderResult = renderImplicitMapsSvg({
    candidate: renderCandidate,
    primitives: implicitPrimitives,
    gestaltEnvelope: envelope,
  });
  const renderMaps = renderResult.renderMaps;
  const trellisSource = renderImplicitTrellisSourceSvg({ candidate: renderCandidate, primitives: implicitPrimitives, gestaltEnvelope: envelope });
  const silhouetteLineage = {
    id: envelope.id,
    maskHash: envelope.maskHash,
    ...envelope.lineage,
  };
  return {
    schema: LIRM_SPECIATION_ARMATURE_GESTALT_COMPOSITE_BUNDLE_SCHEMA,
    route: LIRM_SPECIATION_ARMATURE_GESTALT_COMPOSITE_ROUTE,
    compositeId,
    sourceWitnessId: witness.witnessId,
    sourceWitnessRoute: witness.route,
    candidateId: selectedCandidate.id,
    seed: selectedCandidate.seed,
    gestalt: selectedCandidate.bodyPlan.gestalt,
    silhouette: selectedCandidate.bodyPlan.silhouette,
    renderMode: 'raymarched-implicit-field',
    fieldModel: {
      kind: 'smooth-sdf-metaball-silhouette-morph',
      actual3dStructure: true,
      surfaceThreshold: 0.0065,
      smoothUnionK: 0.075,
      gestaltPressure: envelope.pressure,
      gestaltDepthRadius: envelope.depthRadius,
      composition: 'signed-distance-linear-morph-v0',
      primitiveSources: ['procedural_armature_implicit_field', 'silhouette_envelope_rounded_volume'],
    },
    camera: {
      projection: 'orthographic',
      view: 'front-three-quarter',
      coordinateFrame: 'normalized-implicit-body',
      raySource: 'software-sdf-raymarch',
    },
    gestaltEnvelope: {
      id: envelope.id,
      maskHash: envelope.maskHash,
      width: envelope.mask.width,
      height: envelope.mask.height,
      pressure: envelope.pressure,
      depthRadius: envelope.depthRadius,
      roundness: envelope.roundness,
      lineage: envelope.lineage,
    },
    dualLineage: {
      armature: {
        witnessId: witness.witnessId,
        candidateId: selectedCandidate.id,
        candidateSeed: selectedCandidate.seed,
      },
      silhouette: silhouetteLineage,
    },
    implicitPrimitiveCount: implicitPrimitives.length,
    projectionEvidence: renderResult.projectionEvidence,
    semanticHandles: selectedCandidate.semanticHandles,
    contactPoints: selectedCandidate.contactPoints,
    renderMaps,
    trellisSource,
    falseClosureGuards: {
      finishedCreatureClaim: 'forbidden',
      generatorFiringClaim: 'not_yet_fired',
      implicitBodyClaim: 'raymarched_composite_control_surface_only',
      flatExtrusionClaim: 'forbidden',
      dualLineageVerified: true,
    },
  };
}

function pgmBytes(mask) {
  const header = Buffer.from(`P5\n${mask.width} ${mask.height}\n255\n`, 'ascii');
  const pixels = Buffer.from(mask.data.map(value => value ? 255 : 0));
  return Buffer.concat([header, pixels]);
}

export function decodeBinaryPgmMask(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  let offset = 0;
  const isWhitespace = byte => byte === 9 || byte === 10 || byte === 13 || byte === 32;
  const nextToken = () => {
    while (offset < bytes.length) {
      if (isWhitespace(bytes[offset])) {
        offset += 1;
        continue;
      }
      if (bytes[offset] === 35) {
        while (offset < bytes.length && bytes[offset] !== 10 && bytes[offset] !== 13) offset += 1;
        continue;
      }
      break;
    }
    const start = offset;
    while (offset < bytes.length && !isWhitespace(bytes[offset]) && bytes[offset] !== 35) offset += 1;
    return bytes.subarray(start, offset).toString('ascii');
  };
  const magic = nextToken();
  if (magic !== 'P5') throw new Error('gestalt mask PGM must use binary P5 encoding');
  const width = Number(nextToken());
  const height = Number(nextToken());
  const maxValue = Number(nextToken());
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('gestalt mask PGM has invalid dimensions');
  }
  if (maxValue !== 255) throw new Error('gestalt mask PGM must use max value 255');
  if (!isWhitespace(bytes[offset])) throw new Error('gestalt mask PGM is missing the binary payload separator');
  const separator = bytes[offset];
  offset += 1;
  if (separator === 13 && bytes[offset] === 10) offset += 1;
  const pixelCount = width * height;
  if (bytes.length - offset !== pixelCount) {
    throw new Error(`gestalt mask PGM payload size mismatch: expected ${pixelCount}, got ${bytes.length - offset}`);
  }
  return {
    width,
    height,
    data: Array.from(bytes.subarray(offset), byte => byte >= 128 ? 1 : 0),
  };
}

async function createOutputEvidence(absolutePath, relativePath) {
  const bytes = await readFile(absolutePath);
  return {
    path: relativePath,
    byteSize: bytes.byteLength,
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  };
}

export async function writeLirmSpeciationArmatureGestaltCompositeWitness(options = {}) {
  const outDir = options.outDir || join(process.cwd(), 'artifacts', 'lirm-speciation-armature-gestalt-composites-v0');
  const witness = options.witness || createLirmSpeciationArmatureWitness({
    seed: String(options.seed || DEFAULT_SEED),
    candidateCount: Math.max(1, Number(options.candidateCount || DEFAULT_CANDIDATE_COUNT)),
    columns: Math.max(1, Number(options.columns || DEFAULT_COLUMNS)),
  });
  const compositions = options.compositions;
  if (!Array.isArray(compositions) || compositions.length === 0) {
    throw new Error('writeLirmSpeciationArmatureGestaltCompositeWitness requires nonempty compositions');
  }
  await mkdir(outDir, { recursive: true });
  const receiptPath = join(outDir, 'receipt.json');
  const initialized = {
    schema: LIRM_SPECIATION_ARMATURE_GESTALT_COMPOSITE_WITNESS_SCHEMA,
    route: LIRM_SPECIATION_ARMATURE_GESTALT_COMPOSITE_ROUTE,
    status: 'running',
    phase: 'writer_initialized',
    lastTrustworthyEvidence: 'writer_initialized',
    requestedCompositionCount: compositions.length,
  };
  await writeFile(receiptPath, `${JSON.stringify(initialized, null, 2)}\n`);
  try {
    const bundles = [];
    const outputBundles = [];
    const outputEvidence = [];
    for (const composition of compositions) {
      const bundle = createLirmSpeciationArmatureGestaltCompositeBundle({
        witness,
        candidateId: composition.candidateId,
        gestaltEnvelope: composition.gestaltEnvelope,
      });
      const compositeDir = join(outDir, bundle.compositeId);
      await mkdir(compositeDir, { recursive: true });
      const gestaltMaskRelativePath = `${bundle.compositeId}/gestalt-mask.pgm`;
      const bundleRelativePath = `${bundle.compositeId}/bundle.json`;
      const gestaltMaskPath = join(outDir, gestaltMaskRelativePath);
      const bundlePath = join(outDir, bundleRelativePath);
      await writeFile(gestaltMaskPath, pgmBytes(composition.gestaltEnvelope.mask));
      await writeFile(bundlePath, `${JSON.stringify({
        ...bundle,
        renderMaps: bundle.renderMaps.map(map => ({ kind: map.kind, path: map.path })),
        trellisSource: { ...bundle.trellisSource, svg: undefined },
      }, null, 2)}\n`);
      outputEvidence.push(
        await createOutputEvidence(gestaltMaskPath, gestaltMaskRelativePath),
        await createOutputEvidence(bundlePath, bundleRelativePath),
      );
      for (const map of bundle.renderMaps) {
        const svgPath = join(outDir, map.path);
        const pngPath = svgPath.replace(/\.svg$/, '.png');
        await writeFile(svgPath, map.svg);
        rasterizeSvgWithSips(svgPath, pngPath);
        outputEvidence.push(
          await createOutputEvidence(svgPath, map.path),
          await createOutputEvidence(pngPath, map.path.replace(/\.svg$/, '.png')),
        );
      }
      const trellisSvgPath = join(outDir, bundle.trellisSource.path);
      const trellisRasterPath = join(outDir, bundle.trellisSource.rasterPath);
      await writeFile(trellisSvgPath, bundle.trellisSource.svg);
      rasterizeSvgWithSips(trellisSvgPath, trellisRasterPath);
      outputEvidence.push(
        await createOutputEvidence(trellisSvgPath, bundle.trellisSource.path),
        await createOutputEvidence(trellisRasterPath, bundle.trellisSource.rasterPath),
      );
      bundles.push(bundle);
      outputBundles.push({
        compositeId: bundle.compositeId,
        bundle: `${bundle.compositeId}/bundle.json`,
        gestaltMask: `${bundle.compositeId}/gestalt-mask.pgm`,
        maps: bundle.renderMaps.map(map => ({
          kind: map.kind,
          path: map.path,
          rasterPath: map.path.replace(/\.svg$/, '.png'),
        })),
        trellisSource: {
          path: bundle.trellisSource.path,
          rasterPath: bundle.trellisSource.rasterPath,
        },
      });
    }
    const receipt = {
      ...initialized,
      status: 'complete',
      phase: 'witness_written',
      lastTrustworthyEvidence: 'all_composite_outputs_written',
      sourceWitnessId: witness.witnessId,
      generatedCompositionCount: bundles.length,
      bundles: bundles.map(bundle => ({
        schema: bundle.schema,
        compositeId: bundle.compositeId,
        candidateId: bundle.candidateId,
        fieldModel: bundle.fieldModel,
        gestaltEnvelope: bundle.gestaltEnvelope,
        dualLineage: bundle.dualLineage,
        renderMaps: bundle.renderMaps.map(map => ({ kind: map.kind, path: map.path })),
        trellisSource: {
          path: bundle.trellisSource.path,
          rasterPath: bundle.trellisSource.rasterPath,
        },
      })),
      falseClosureGuards: {
        finishedCreatureClaim: 'forbidden',
        generatorFiringClaim: 'not_yet_fired',
        flatExtrusionClaim: 'forbidden',
        dualLineageVerifiedCount: bundles.filter(bundle => bundle.falseClosureGuards.dualLineageVerified).length,
      },
      outputInventory: {
        receipt: 'receipt.json',
        bundles: outputBundles,
      },
      outputEvidence,
    };
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    return {
      schema: LIRM_SPECIATION_ARMATURE_GESTALT_COMPOSITE_WRITE_RESULT_SCHEMA,
      route: LIRM_SPECIATION_ARMATURE_GESTALT_COMPOSITE_ROUTE,
      outDir,
      receiptPath,
      bundleCount: bundles.length,
      compositeIds: bundles.map(bundle => bundle.compositeId),
    };
  } catch (error) {
    await writeFile(receiptPath, `${JSON.stringify({
      ...initialized,
      status: 'failed',
      phase: 'compose_or_render',
      failurePhase: 'compose_or_render',
      lastTrustworthyEvidence: 'writer_initialized',
      errorMessage: String(error?.message || error),
    }, null, 2)}\n`);
    throw error;
  }
}

export async function writeLirmSpeciationArmatureImplicitBodyWitness(options = {}) {
  const outDir = options.outDir || join(process.cwd(), 'artifacts', 'lirm-speciation-armature-implicit-bodies-v0');
  const seed = String(options.seed || DEFAULT_SEED);
  const candidateCount = Math.max(1, Number(options.candidateCount || DEFAULT_CANDIDATE_COUNT));
  const columns = Math.max(1, Number(options.columns || DEFAULT_COLUMNS));
  const witness = options.witness || createLirmSpeciationArmatureWitness({ seed, candidateCount, columns });
  const candidateIds = options.candidateIds || ['lirm-armature-08', 'lirm-armature-11', 'lirm-armature-16', 'lirm-armature-22', 'lirm-armature-24'];
  await mkdir(outDir, { recursive: true });
  const bundles = [];
  const outputBundles = [];
  for (const candidateId of candidateIds) {
    const bundle = createLirmSpeciationArmatureImplicitBodyBundle({ witness, candidateId });
    const candidateDir = join(outDir, candidateId);
    await mkdir(candidateDir, { recursive: true });
    await writeFile(join(candidateDir, 'bundle.json'), `${JSON.stringify({ ...bundle, renderMaps: bundle.renderMaps.map(map => ({ kind: map.kind, path: map.path })) }, null, 2)}\n`);
    for (const map of bundle.renderMaps) {
      const svgPath = join(outDir, map.path);
      const pngPath = svgPath.replace(/\.svg$/, '.png');
      await writeFile(svgPath, map.svg);
      rasterizeSvgWithSips(svgPath, pngPath);
    }
    await writeFile(join(outDir, bundle.trellisSource.path), bundle.trellisSource.svg);
    rasterizeSvgWithSips(join(outDir, bundle.trellisSource.path), join(outDir, bundle.trellisSource.rasterPath));
    bundles.push(bundle);
    outputBundles.push({
      candidateId,
      bundle: `${candidateId}/bundle.json`,
      maps: bundle.renderMaps.map(map => ({ kind: map.kind, path: map.path, rasterPath: map.path.replace(/\.svg$/, '.png') })),
      trellisSource: {
        kind: bundle.trellisSource.kind,
        path: bundle.trellisSource.path,
        rasterPath: bundle.trellisSource.rasterPath,
        effectiveSource: bundle.trellisSource.effectiveSource,
      },
    });
  }
  const receipt = {
    schema: LIRM_SPECIATION_ARMATURE_IMPLICIT_BODY_WITNESS_SCHEMA,
    route: LIRM_SPECIATION_ARMATURE_IMPLICIT_BODY_ROUTE,
    seed,
    sourceWitnessId: witness.witnessId,
    candidateIds,
    bundles: bundles.map(bundle => ({
      schema: bundle.schema,
      candidateId: bundle.candidateId,
      renderMode: bundle.renderMode,
      fieldModel: bundle.fieldModel,
      camera: bundle.camera,
      implicitPrimitiveCount: bundle.implicitPrimitiveCount,
      renderMaps: bundle.renderMaps.map(map => ({ kind: map.kind, path: map.path })),
      trellisSource: {
        kind: bundle.trellisSource.kind,
        path: bundle.trellisSource.path,
        rasterPath: bundle.trellisSource.rasterPath,
        effectiveSource: bundle.trellisSource.effectiveSource,
        framing: bundle.trellisSource.framing,
      },
    })),
    falseClosureGuards: {
      finishedCreatureClaim: 'forbidden',
      generatorFiringClaim: 'not_yet_fired',
      implicitBodyClaim: 'raymarched_control_surface_only',
      projectionProxyClaim: 'superseded_by_implicit_surface',
    },
    outputInventory: {
      receipt: 'receipt.json',
      bundles: outputBundles,
    },
  };
  const receiptPath = join(outDir, 'receipt.json');
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return {
    schema: LIRM_SPECIATION_ARMATURE_IMPLICIT_BODY_WRITE_RESULT_SCHEMA,
    route: LIRM_SPECIATION_ARMATURE_IMPLICIT_BODY_ROUTE,
    outDir,
    seed,
    receiptPath,
    candidateIds,
    bundleCount: bundles.length,
  };
}

function createConditioningPrompt(candidate, packet) {
  const hasShell = candidate.semanticHandles.some(handle => handle.kind === 'shell_plate');
  const limbCount = candidate.semanticHandles.filter(handle => handle.kind === 'limb_bud').length;
  const motion = candidate.motionAffordance.primary;
  const preserve = [
    'the axial body curve',
    'the belly contact patch',
    'the terminal front mouth',
    'the head orientation',
    'the crawl contact points',
  ];
  if (hasShell) preserve.push('the dorsal shell or plate rhythm');
  if (limbCount > 0) preserve.push('the small brace-drag limb nubs');
  return {
    positive: [
      `small crawling hoard-thief creature, ${candidate.bodyPlan.gestalt.label}, ${candidate.bodyPlan.silhouette.class}, invertebrate body plan, wet clay and keratin material, anxious semi-cute gross creature design`,
      `model-prior hooks: ${candidate.bodyPlan.gestalt.priorHooks.join(', ')}`,
      `control pressure: ${candidate.bodyPlan.controlPressures.mode}, semantic adherence ${candidate.bodyPlan.controlPressures.semanticAdherence}, silhouette fall-forward ${candidate.bodyPlan.controlPressures.silhouetteFallForward}, prior invitation ${candidate.bodyPlan.controlPressures.priorInvitation}`,
      `fall-forward hooks: ${candidate.bodyPlan.controlPressures.fallForwardPrompts.join(', ')}`,
      `primary motion affordance: ${motion}`,
      `preserve ${preserve.join(', ')}`,
      `source candidate ${candidate.id}, lineage ${candidate.lineage.mutationPath.join(' / ')}`,
      'three-quarter studio render, isolated body, readable silhouette, sculptural volume, no text',
    ].join('; '),
    negative: [
      'centered eye',
      'humanoid face',
      'two-legged mascot',
      'flat icon',
      'logo',
      'text labels',
      'finished glossy toy',
      'background scenery',
      'extra disconnected bodies',
    ].join(', '),
    preserve: packet.promptContract.preserve,
    allowMutation: packet.promptContract.allowMutation,
    hallucinateBeyond: packet.promptContract.hallucinateBeyond,
  };
}

function valueRange(values) {
  return {
    min: round(Math.min(...values)),
    max: round(Math.max(...values)),
  };
}

function renderConditioningPanelSvg({ candidate, sourceImages, prompt }) {
  const panelWidth = 720;
  const panelHeight = 560;
  const cellW = 220;
  const cellH = 170;
  const gap = 16;
  const startX = 24;
  const startY = 48;
  const panels = sourceImages.map((source, index) => {
    const col = index % 3;
    const row = Math.floor(index / 3);
    const x = startX + col * (cellW + gap);
    const y = startY + row * (cellH + gap);
    return `<g data-panel-kind="${xml(source.kind)}">
      <rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" rx="8" fill="#07130f" stroke="rgba(238,246,214,0.22)"/>
      <image href="${xml(source.path)}" x="${x + 8}" y="${y + 22}" width="${cellW - 16}" height="${cellH - 34}" preserveAspectRatio="xMidYMid meet" data-source-kind="${xml(source.kind)}"/>
      <text x="${x + 10}" y="${y + 16}" fill="rgba(238,246,214,0.76)" font-size="11" font-family="Menlo, Monaco, monospace">${xml(source.kind)}</text>
    </g>`;
  }).join('\n    ');
  const promptText = prompt.positive.length > 320 ? `${prompt.positive.slice(0, 317)}...` : prompt.positive;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${panelWidth}" height="${panelHeight}" viewBox="0 0 ${panelWidth} ${panelHeight}" role="img" aria-label="${xml(candidate.id)} conditioning package" data-conditioning-panel="lirm-speciation-armature" data-candidate-id="${xml(candidate.id)}">
  <rect width="100%" height="100%" fill="#04100c"/>
  <text x="24" y="28" fill="rgba(238,246,214,0.9)" font-size="15" font-family="Menlo, Monaco, monospace">${xml(candidate.id)} implicit body conditioning package</text>
  <g data-layer="source-map-grid">
    ${panels}
  </g>
  <g data-layer="prompt-contract">
    <rect x="24" y="420" width="672" height="112" rx="8" fill="rgba(238,246,214,0.08)" stroke="rgba(238,246,214,0.2)"/>
    <text x="38" y="444" fill="rgba(238,246,214,0.84)" font-size="12" font-family="Menlo, Monaco, monospace">prompt</text>
    <foreignObject x="38" y="456" width="642" height="58">
      <div xmlns="http://www.w3.org/1999/xhtml" style="color:rgba(238,246,214,0.78);font:11px Menlo, Monaco, monospace;line-height:1.35;">${xml(promptText)}</div>
    </foreignObject>
    <text x="38" y="520" fill="rgba(238,246,214,0.52)" font-size="10" font-family="Menlo, Monaco, monospace">source package only; no generator firing has occurred</text>
  </g>
</svg>`;
}

function rasterizeSvgWithSips(svgPath, pngPath) {
  const result = spawnSync('sips', ['-s', 'format', 'png', svgPath, '--out', pngPath], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`sips failed rasterizing ${svgPath}: ${(result.stderr || result.stdout || '').trim()}`);
  }
}

export function createLirmSpeciationArmatureConditioningPackage({ witness, candidate, candidateId } = {}) {
  const selectedCandidate = candidate || witness?.candidates?.find(item => item.id === candidateId);
  if (!witness || !selectedCandidate) {
    throw new Error('createLirmSpeciationArmatureConditioningPackage requires a witness and candidate or candidateId');
  }
  const proxyBundle = createLirmSpeciationArmatureProxyRenderBundle({ witness, candidate: selectedCandidate });
  const implicitBundle = createLirmSpeciationArmatureImplicitBodyBundle({ witness, candidate: selectedCandidate });
  const packet = createLirmSpeciationArmatureControlPacket({ witness, candidate: selectedCandidate });
  const trellisSource = {
    ...implicitBundle.trellisSource,
    path: 'trellis-source.svg',
    rasterPath: 'trellis-source.png',
    sourceImplicitPath: implicitBundle.trellisSource.path,
  };
  const sourceImages = implicitBundle.renderMaps.map(map => ({
    kind: map.kind,
    path: `source-maps/${map.kind}-control.svg`,
    rasterPath: `source-maps/${map.kind}-control.png`,
    sourceImplicitPath: map.path,
    sourceProxyPath: proxyBundle.renderMaps.find(proxyMap => proxyMap.kind === map.kind)?.path,
    requiredFor: map.kind === 'mask'
      ? ['imagegen_conditioning', 'sam3_isolation', 'alpha_cutout']
      : ['imagegen_conditioning', map.kind === 'clay' ? 'trellis_clay_probe' : `${map.kind}_control`],
    effectiveSource: 'local-procedural-implicit-body-raymarch',
  }));
  const prompt = createConditioningPrompt(selectedCandidate, packet);
  return {
    schema: LIRM_SPECIATION_ARMATURE_CONDITIONING_PACKAGE_SCHEMA,
    route: LIRM_SPECIATION_ARMATURE_CONDITIONING_PACKAGE_ROUTE,
    sourceWitnessId: witness.witnessId,
    sourceWitnessRoute: witness.route,
    candidateId: selectedCandidate.id,
    seed: selectedCandidate.seed,
    gestalt: selectedCandidate.bodyPlan.gestalt,
    silhouette: selectedCandidate.bodyPlan.silhouette,
    sourceProxyRender: {
      schema: proxyBundle.schema,
      route: proxyBundle.route,
      candidateId: proxyBundle.candidateId,
      camera: proxyBundle.camera,
      proxyPrimitiveCount: proxyBundle.proxyPrimitiveCount,
    },
    sourceImplicitBody: {
      schema: implicitBundle.schema,
      route: implicitBundle.route,
      candidateId: implicitBundle.candidateId,
      camera: implicitBundle.camera,
      renderMode: implicitBundle.renderMode,
      fieldModel: implicitBundle.fieldModel,
      implicitPrimitiveCount: implicitBundle.implicitPrimitiveCount,
    },
    preferredSourceRoute: LIRM_SPECIATION_ARMATURE_IMPLICIT_BODY_ROUTE,
    sourceImages,
    trellisSource,
    prompt,
    routeCandidates: [
      {
        route: 'imagegen_img2img_depth_normal',
        status: 'requires_registered_imagegen_route',
        inputs: ['clay', 'depth', 'normal', 'mask', 'semantic'],
        purpose: 'test whether imagegen preserves implicit 3D body identity before mesh/splat routes',
      },
      {
        route: 'trellis2mlx_fast_clay_probe',
        status: 'registered_greenroom_route_but_queue_blocked_by_existing_pixal3d_job',
        inputs: ['trellisSource', 'mask'],
        purpose: 'cheap 3D sanity probe from the tight transparent implicit clay source, not depth-normal conditioning',
      },
      {
        route: 'world_tracing_masked_probe',
        status: 'registered_greenroom_route',
        inputs: ['clay', 'mask'],
        purpose: 'optional splat-ish/object reconstruction experiment if mesh route is blocked',
      },
    ],
    conditioningPanel: {
      path: 'conditioning-panel.svg',
      svg: renderConditioningPanelSvg({ candidate: selectedCandidate, sourceImages, prompt }),
    },
    falseClosureGuards: {
      finishedCreatureClaim: 'forbidden',
      generatorFiringClaim: 'not_yet_fired',
      conditioningClaim: 'source_package_only',
      greenroomClaim: 'gpu_routes_require_greenroom_receipt',
    },
  };
}

export async function writeLirmSpeciationArmatureConditioningPackages(options = {}) {
  const outDir = options.outDir || join(process.cwd(), 'artifacts', 'lirm-speciation-armature-conditioning-packages-v0');
  const seed = String(options.seed || DEFAULT_SEED);
  const candidateCount = Math.max(1, Number(options.candidateCount || DEFAULT_CANDIDATE_COUNT));
  const columns = Math.max(1, Number(options.columns || DEFAULT_COLUMNS));
  const witness = options.witness || createLirmSpeciationArmatureWitness({ seed, candidateCount, columns });
  const candidateIds = options.candidateIds || ['lirm-armature-08', 'lirm-armature-11', 'lirm-armature-16', 'lirm-armature-22', 'lirm-armature-24'];
  await mkdir(outDir, { recursive: true });
  const packages = [];
  const outputPackages = [];
  for (const candidateId of candidateIds) {
    const pkg = createLirmSpeciationArmatureConditioningPackage({ witness, candidateId });
    const implicitBundle = createLirmSpeciationArmatureImplicitBodyBundle({ witness, candidateId });
    const candidateDir = join(outDir, candidateId);
    const sourceMapDir = join(candidateDir, 'source-maps');
    await mkdir(sourceMapDir, { recursive: true });
    for (const map of implicitBundle.renderMaps) {
      const svgPath = join(sourceMapDir, `${map.kind}-control.svg`);
      const pngPath = join(sourceMapDir, `${map.kind}-control.png`);
      await writeFile(svgPath, map.svg);
      rasterizeSvgWithSips(svgPath, pngPath);
    }
    await writeFile(join(candidateDir, pkg.trellisSource.path), pkg.trellisSource.svg);
    rasterizeSvgWithSips(join(candidateDir, pkg.trellisSource.path), join(candidateDir, pkg.trellisSource.rasterPath));
    await writeFile(join(candidateDir, 'conditioning-panel.svg'), pkg.conditioningPanel.svg);
    const packageJson = {
      ...pkg,
      conditioningPanel: { path: pkg.conditioningPanel.path },
      trellisSource: {
        ...pkg.trellisSource,
        svg: undefined,
      },
    };
    await writeFile(join(candidateDir, 'conditioning-package.json'), `${JSON.stringify(packageJson, null, 2)}\n`);
    packages.push(pkg);
    outputPackages.push({
      candidateId,
      package: `${candidateId}/conditioning-package.json`,
      panel: `${candidateId}/conditioning-panel.svg`,
      sourceMaps: pkg.sourceImages.map(image => ({
        kind: image.kind,
        path: `${candidateId}/${image.path}`,
        rasterPath: `${candidateId}/${image.rasterPath}`,
      })),
      trellisSource: {
        kind: pkg.trellisSource.kind,
        path: `${candidateId}/${pkg.trellisSource.path}`,
        rasterPath: `${candidateId}/${pkg.trellisSource.rasterPath}`,
        effectiveSource: pkg.trellisSource.effectiveSource,
      },
    });
  }
  const receipt = {
    schema: LIRM_SPECIATION_ARMATURE_CONDITIONING_PACKAGE_WITNESS_SCHEMA,
    route: LIRM_SPECIATION_ARMATURE_CONDITIONING_PACKAGE_ROUTE,
    seed,
    sourceWitnessId: witness.witnessId,
    candidateIds,
      packages: packages.map(pkg => ({
        schema: pkg.schema,
        candidateId: pkg.candidateId,
        gestalt: pkg.gestalt,
        silhouette: pkg.silhouette,
        preferredSourceRoute: pkg.preferredSourceRoute,
        sourceImplicitBody: pkg.sourceImplicitBody,
      sourceImages: pkg.sourceImages.map(image => ({ kind: image.kind, path: image.path, rasterPath: image.rasterPath })),
      trellisSource: {
        kind: pkg.trellisSource.kind,
        path: pkg.trellisSource.path,
        rasterPath: pkg.trellisSource.rasterPath,
        effectiveSource: pkg.trellisSource.effectiveSource,
        framing: pkg.trellisSource.framing,
      },
      routeCandidates: pkg.routeCandidates,
    })),
    falseClosureGuards: {
      finishedCreatureClaim: 'forbidden',
      generatorFiringClaim: 'not_yet_fired',
      conditioningClaim: 'source_package_only',
      greenroomClaim: 'gpu_routes_require_greenroom_receipt',
    },
    outputInventory: {
      receipt: 'receipt.json',
      packages: outputPackages,
    },
  };
  const receiptPath = join(outDir, 'receipt.json');
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return {
    schema: LIRM_SPECIATION_ARMATURE_CONDITIONING_PACKAGE_WRITE_RESULT_SCHEMA,
    route: LIRM_SPECIATION_ARMATURE_CONDITIONING_PACKAGE_ROUTE,
    outDir,
    seed,
    receiptPath,
    candidateIds,
    packageCount: packages.length,
  };
}

export function createLirmSpeciationArmatureWitness(options = {}) {
  const seed = String(options.seed || DEFAULT_SEED);
  const candidateCount = Math.max(1, Number(options.candidateCount || DEFAULT_CANDIDATE_COUNT));
  const columns = Math.max(1, Number(options.columns || DEFAULT_COLUMNS));
  const rows = Math.ceil(candidateCount / columns);
  const candidates = Array.from({ length: candidateCount }, (_, index) => createCandidate(seed, index, candidateCount));
  const gestaltKinds = [...new Set(candidates.map(candidate => candidate.bodyPlan.gestalt.kind))];
  const silhouetteClasses = [...new Set(candidates.map(candidate => candidate.bodyPlan.silhouette.class))];
  const gestaltAssay = {
    kind: 'silhouette_gestalt_v0',
    archetypeSource: 'seeded_gestalt_archetype_v0',
    gestaltKinds,
    silhouetteClasses,
    candidateCount,
  };
  const controlPressureAssay = {
    kind: 'semantic_adherence_silhouette_fall_forward_v0',
    semanticAdherenceRange: valueRange(candidates.map(candidate => candidate.bodyPlan.controlPressures.semanticAdherence)),
    silhouetteFallForwardRange: valueRange(candidates.map(candidate => candidate.bodyPlan.controlPressures.silhouetteFallForward)),
    priorInvitationRange: valueRange(candidates.map(candidate => candidate.bodyPlan.controlPressures.priorInvitation)),
    modes: [...new Set(candidates.map(candidate => candidate.bodyPlan.controlPressures.mode))],
    rigidAnchors: candidates[0]?.bodyPlan.controlPressures.rigidAnchors || [],
    elasticZones: candidates[0]?.bodyPlan.controlPressures.elasticZones || [],
  };
  const baseWitness = {
    schema: LIRM_SPECIATION_ARMATURE_WITNESS_SCHEMA,
    route: LIRM_SPECIATION_ARMATURE_ROUTE,
    seed,
    witnessId: `lirm-speciation-armature-${hashSeed(seed).toString(16).padStart(8, '0')}`,
    createdBy: 'procedural_morphology_armature_not_imagegen',
    candidateFamily: {
      rootParentId: ROOT_PARENT_ID,
      family: 'small-ground-hoard-thief',
      gestaltAssay,
      controlPressureAssay,
      intendedUse: ['lirms_body_plan_selection', 'imagegen_conditioning', 'sam3_isolation', 'trellis_probe', 'motion_affordance_preview'],
    },
    candidates,
    contactSheet: {
      kind: 'svg_contact_sheet',
      columns,
      rows,
      renderedCandidateCount: candidateCount,
      visualEvidenceStatus: 'generated_local_svg',
      path: null,
      svg: '',
    },
    receipt: {
      schema: LIRM_SPECIATION_ARMATURE_RECEIPT_SCHEMA,
      routeIdentity: {
        schema: 'kaminos.route-identity.v0',
        requestedRoute: LIRM_SPECIATION_ARMATURE_ROUTE,
        effectiveRoute: LIRM_SPECIATION_ARMATURE_ROUTE,
        backend: 'local-procedural-js',
      },
      generatorRole: 'procedural_morphology_armature',
      promptOnly: false,
      seed,
      rootParentId: ROOT_PARENT_ID,
      requestedCandidateCount: candidateCount,
      effectiveCandidateCount: candidateCount,
      gestaltAssay,
      controlPressureAssay,
      controlMaps: ['silhouette', 'gestalt-silhouette', 'semantic-map', 'axis-depth-cue', 'contact-points'],
      falseClosureGuards: {
        promptOnlyLirmAttempt: 'not_used',
        finishedCreatureClaim: 'forbidden',
        generatorFiringClaim: 'not_yet_fired',
        proxyGeometryClaim: 'control_primitives_only',
        visualEvidence: 'contact_sheet_only',
      },
      outputInventory: {},
    },
  };
  const svg = renderContactSheetSvg(baseWitness);
  return {
    ...baseWitness,
    contactSheet: {
      ...baseWitness.contactSheet,
      svg,
    },
  };
}

export async function writeLirmSpeciationArmatureWitness(options = {}) {
  const outDir = options.outDir || join(process.cwd(), 'artifacts', 'lirm-speciation-armature-witness-v0');
  const contactSheetName = options.contactSheetName || 'contact-sheet.svg';
  const contactSheetRasterName = options.contactSheetRasterName || contactSheetName.replace(/\.svg$/i, '.png');
  const receiptName = options.receiptName || 'receipt.json';
  await mkdir(outDir, { recursive: true });
  const witness = createLirmSpeciationArmatureWitness(options);
  const contactSheetPath = join(outDir, contactSheetName);
  const contactSheetRasterPath = join(outDir, contactSheetRasterName);
  const receiptPath = join(outDir, receiptName);
  const receiptWitness = {
    ...witness,
    contactSheet: {
      ...witness.contactSheet,
      path: contactSheetName,
    },
    receipt: {
      ...witness.receipt,
      outputInventory: {
        contactSheet: contactSheetName,
        contactSheetRaster: contactSheetRasterName,
        receipt: receiptName,
      },
    },
  };
  const controlPacketPaths = [];
  for (const candidate of witness.candidates) {
    const candidateDirName = join('control-packets', candidate.id);
    const candidateDir = join(outDir, candidateDirName);
    const packet = createLirmSpeciationArmatureControlPacket({ witness, candidate });
    await mkdir(candidateDir, { recursive: true });
    await writeFile(join(candidateDir, 'packet.json'), `${JSON.stringify(packet, null, 2)}\n`);
    await writeFile(join(candidateDir, 'proxy-primitives.json'), `${JSON.stringify(packet.proxyPrimitives, null, 2)}\n`);
    await writeFile(join(candidateDir, 'semantic-control.svg'), renderCandidateControlSvg(candidate, 'semantic-svg'));
    await writeFile(join(candidateDir, 'silhouette-control.svg'), renderCandidateControlSvg(candidate, 'silhouette-svg'));
    controlPacketPaths.push(`${candidateDirName}/packet.json`);
  }
  receiptWitness.receipt.outputInventory.controlPackets = controlPacketPaths;
  await writeFile(contactSheetPath, witness.contactSheet.svg);
  rasterizeSvgWithSips(contactSheetPath, contactSheetRasterPath);
  await writeFile(receiptPath, `${JSON.stringify(receiptWitness, null, 2)}\n`);
  return {
    schema: LIRM_SPECIATION_ARMATURE_WRITE_RESULT_SCHEMA,
    route: LIRM_SPECIATION_ARMATURE_ROUTE,
    outDir,
    seed: receiptWitness.seed,
    receiptPath,
    contactSheetPath,
    contactSheetRasterPath,
    candidateCount: receiptWitness.candidates.length,
    controlPacketCount: controlPacketPaths.length,
  };
}
