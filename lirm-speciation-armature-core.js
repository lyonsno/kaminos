import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const LIRM_SPECIATION_ARMATURE_WITNESS_SCHEMA = 'kaminos.lirm-speciation-armature-witness.v0';
export const LIRM_SPECIATION_ARMATURE_CANDIDATE_SCHEMA = 'kaminos.lirm-speciation-armature-candidate.v0';
export const LIRM_SPECIATION_ARMATURE_RECEIPT_SCHEMA = 'kaminos.lirm-speciation-armature-receipt.v0';
export const LIRM_SPECIATION_ARMATURE_ROUTE = 'kaminos/lirm-speciation-armature/contact-sheet-v0';
export const LIRM_SPECIATION_ARMATURE_WRITE_RESULT_SCHEMA = 'kaminos.lirm-speciation-armature-write-result.v0';

const ROOT_PARENT_ID = 'root-soft-crawling-hoard-thief';
const DEFAULT_SEED = 'molten-lirm-speciation-armature-v0';
const DEFAULT_CANDIDATE_COUNT = 25;
const DEFAULT_COLUMNS = 5;

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

function createSemanticHandles(candidateId, params, axisSamples) {
  const head = axisSamples[axisSamples.length - 1];
  const belly = axisSamples[Math.floor(axisSamples.length * 0.45)];
  const tail = axisSamples[0];
  const handles = [
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
      label: 'mouth concentration',
      strength: params.mouthIntensity,
      region: { x: head.x, y: round(head.y + 0.015), radius: round(0.026 + params.mouthIntensity * 0.025) },
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
  const segmentCount = 5 + ((index * 3 + Math.floor(rng() * 5)) % 7);
  const limbPairCount = 1 + ((index + Math.floor(rng() * 6)) % 5);
  const armorPressure = round(clamp((index % 3 === 0 ? 0.62 : 0.24) + rng() * 0.42 + Math.sin(index * 1.7) * 0.08, 0.05, 0.95));
  const shellPlateCount = armorPressure > 0.55 ? 2 + ((index + Math.floor(rng() * 4)) % 5) : 0;
  const curveAmplitude = round(0.035 + rng() * 0.105 + (index % 5 === 2 ? 0.035 : 0));
  const curvePhase = round((rng() * Math.PI * 2) + index * 0.23);
  const headBias = round(0.15 + rng() * 0.74);
  const contactWidth = round(0.42 + rng() * 0.43);
  const bellyDrop = round(0.35 + rng() * 0.58);
  const mouthIntensity = round(0.38 + rng() * 0.55);
  const limbScale = round(0.36 + rng() * 0.48);
  const cuteGrossBlend = round(0.18 + rng() * 0.78);
  const asymmetry = round(index % 2 === 0 ? 0.05 + rng() * 0.07 : 0.11 + rng() * 0.13);
  const sensoryNubCount = cuteGrossBlend > 0.48 ? 1 + ((index + Math.floor(rng() * 3)) % 3) : 0;
  const bodyLength = round(clamp(0.52 + rng() * 0.38 + (segmentCount - 7) * 0.035, 0.46, 0.92));
  const bodyCenter = round(0.5 + (rng() - 0.5) * 0.11);
  const postureLift = round((index % 5 === 3 ? -0.055 : 0) + (index % 5 === 1 ? 0.045 : 0) + (rng() - 0.5) * 0.055);
  const bulkScale = round(clamp(0.72 + rng() * 0.74 + (bellyDrop - 0.5) * 0.28, 0.62, 1.55));

  const params = {
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
    },
    semanticHandles,
    contactPoints,
    motionAffordance,
    firingAffordances: {
      acceptsImagegenConditioning: true,
      acceptsSamIsolation: true,
      acceptsTrellisProbe: true,
      acceptsSharpProbe: true,
      controlMaps: ['silhouette', 'semantic-map', 'axis-depth-cue', 'contact-points'],
      promptPacket: {
        subject: 'small crawling hoard thief creature',
        preserve: ['body axis', 'belly contact patch', 'head/mouth orientation', 'limb bud count'],
        mutate: ['surface material', 'gross-cute balance', 'shell/soft tissue texture'],
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
  const candidateLabel = xml(`${candidate.label} ${candidate.motionAffordance.primary}`);
  const bodyWidth = (0.07 + candidate.bodyPlan.contactWidth * 0.055) * candidate.bodyPlan.bulkScale;
  const segmentEllipses = axis.map((point, sampleIndex) => {
    const t = sampleIndex / Math.max(1, axis.length - 1);
    const rx = round((0.058 + bodyWidth * (1.1 - Math.abs(t - 0.45))) * w, 2);
    const ry = round((0.047 + bodyWidth * 0.48 + Math.sin(t * Math.PI) * 0.025) * h, 2);
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
      <rect x="${x0 + 6}" y="${y0 + 6}" width="${cellWidth - 12}" height="${cellHeight - 12}" rx="9" fill="rgba(16,22,18,0.92)" stroke="rgba(167,210,144,0.22)" stroke-width="1"/>
      <text x="${x0 + 13}" y="${y0 + 21}" fill="rgba(235,244,216,0.9)" font-size="10" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">${candidate.id}</text>
      <text x="${x0 + 13}" y="${y0 + cellHeight - 14}" fill="rgba(235,244,216,0.75)" font-size="10" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">${candidateLabel}</text>
      <g data-layer="silhouette" opacity="1">
        <path d="M ${toX(0.1)} ${toY(0.76)} C ${toX(0.28)} ${toY(0.92)}, ${toX(0.66)} ${toY(0.92)}, ${toX(0.9)} ${toY(0.76)}" fill="none" stroke="${colors.shadow}" stroke-width="13" stroke-linecap="round" opacity="0.5"/>
        ${segmentEllipses}
        <ellipse cx="${toX(head.region.x)}" cy="${toY(head.region.y)}" rx="${round(head.region.radius * w * 1.15, 2)}" ry="${round(head.region.radius * h * 0.95, 2)}" fill="${colors.head}" opacity="0.96"/>
      </g>
      <g data-layer="semantic-map">
        <polyline points="${axisPoints}" fill="none" stroke="${colors.axis}" stroke-width="2" stroke-linecap="round" stroke-dasharray="4 4" opacity="0.82"/>
        ${limbs}
        ${shellPlates}
        ${bellyRect}
        ${sensory}
        <circle cx="${toX(mouth.region.x)}" cy="${toY(mouth.region.y)}" r="${round(mouth.region.radius * w, 2)}" fill="${colors.mouth}" stroke="rgba(255,172,97,0.75)" stroke-width="1"/>
        ${contacts}
      </g>
    </g>
  `;
}

function renderContactSheetSvg(witness) {
  const columns = witness.contactSheet.columns;
  const rows = witness.contactSheet.rows;
  const cellWidth = 204;
  const cellHeight = 166;
  const margin = 22;
  const topMargin = 84;
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
  ${body}
</svg>`;
}

export function createLirmSpeciationArmatureWitness(options = {}) {
  const seed = String(options.seed || DEFAULT_SEED);
  const candidateCount = Math.max(1, Number(options.candidateCount || DEFAULT_CANDIDATE_COUNT));
  const columns = Math.max(1, Number(options.columns || DEFAULT_COLUMNS));
  const rows = Math.ceil(candidateCount / columns);
  const candidates = Array.from({ length: candidateCount }, (_, index) => createCandidate(seed, index, candidateCount));
  const baseWitness = {
    schema: LIRM_SPECIATION_ARMATURE_WITNESS_SCHEMA,
    route: LIRM_SPECIATION_ARMATURE_ROUTE,
    seed,
    witnessId: `lirm-speciation-armature-${hashSeed(seed).toString(16).padStart(8, '0')}`,
    createdBy: 'procedural_morphology_armature_not_imagegen',
    candidateFamily: {
      rootParentId: ROOT_PARENT_ID,
      family: 'small-ground-hoard-thief',
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
      controlMaps: ['silhouette', 'semantic-map', 'axis-depth-cue', 'contact-points'],
      falseClosureGuards: {
        promptOnlyLirmAttempt: 'not_used',
        finishedCreatureClaim: 'forbidden',
        generatorFiringClaim: 'not_yet_fired',
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
  const receiptName = options.receiptName || 'receipt.json';
  await mkdir(outDir, { recursive: true });
  const witness = createLirmSpeciationArmatureWitness(options);
  const contactSheetPath = join(outDir, contactSheetName);
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
        receipt: receiptName,
      },
    },
  };
  await writeFile(contactSheetPath, witness.contactSheet.svg);
  await writeFile(receiptPath, `${JSON.stringify(receiptWitness, null, 2)}\n`);
  return {
    schema: LIRM_SPECIATION_ARMATURE_WRITE_RESULT_SCHEMA,
    route: LIRM_SPECIATION_ARMATURE_ROUTE,
    outDir,
    seed: receiptWitness.seed,
    receiptPath,
    contactSheetPath,
    candidateCount: receiptWitness.candidates.length,
  };
}
