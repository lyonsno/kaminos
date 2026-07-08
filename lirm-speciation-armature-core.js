import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const LIRM_SPECIATION_ARMATURE_WITNESS_SCHEMA = 'kaminos.lirm-speciation-armature-witness.v0';
export const LIRM_SPECIATION_ARMATURE_CANDIDATE_SCHEMA = 'kaminos.lirm-speciation-armature-candidate.v0';
export const LIRM_SPECIATION_ARMATURE_RECEIPT_SCHEMA = 'kaminos.lirm-speciation-armature-receipt.v0';
export const LIRM_SPECIATION_ARMATURE_CONTROL_PACKET_SCHEMA = 'kaminos.lirm-speciation-armature-control-packet.v0';
export const LIRM_SPECIATION_ARMATURE_PROXY_RENDER_BUNDLE_SCHEMA = 'kaminos.lirm-speciation-armature-proxy-render-bundle.v0';
export const LIRM_SPECIATION_ARMATURE_PROXY_RENDER_WITNESS_SCHEMA = 'kaminos.lirm-speciation-armature-proxy-render-witness.v0';
export const LIRM_SPECIATION_ARMATURE_CONDITIONING_PACKAGE_SCHEMA = 'kaminos.lirm-speciation-armature-conditioning-package.v0';
export const LIRM_SPECIATION_ARMATURE_CONDITIONING_PACKAGE_WITNESS_SCHEMA = 'kaminos.lirm-speciation-armature-conditioning-package-witness.v0';
export const LIRM_SPECIATION_ARMATURE_ROUTE = 'kaminos/lirm-speciation-armature/contact-sheet-v0';
export const LIRM_SPECIATION_ARMATURE_CONTROL_PACKET_ROUTE = 'kaminos/lirm-speciation-armature/control-packet-v0';
export const LIRM_SPECIATION_ARMATURE_PROXY_RENDER_ROUTE = 'kaminos/lirm-speciation-armature/proxy-render-v0';
export const LIRM_SPECIATION_ARMATURE_CONDITIONING_PACKAGE_ROUTE = 'kaminos/lirm-speciation-armature/conditioning-package-v0';
export const LIRM_SPECIATION_ARMATURE_WRITE_RESULT_SCHEMA = 'kaminos.lirm-speciation-armature-write-result.v0';
export const LIRM_SPECIATION_ARMATURE_PROXY_RENDER_WRITE_RESULT_SCHEMA = 'kaminos.lirm-speciation-armature-proxy-render-write-result.v0';
export const LIRM_SPECIATION_ARMATURE_CONDITIONING_PACKAGE_WRITE_RESULT_SCHEMA = 'kaminos.lirm-speciation-armature-conditioning-package-write-result.v0';

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
      label: 'terminal mouth concentration',
      strength: params.mouthIntensity,
      region: {
        x: round(clamp(head.x + (0.035 + params.headBias * 0.028), 0.05, 0.985)),
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
      controlMaps: ['silhouette', 'semantic-map', 'axis-depth-cue', 'contact-points', 'proxy-primitives'],
      promptPacket: {
        subject: 'small crawling hoard thief creature',
        preserve: ['body axis', 'belly contact patch', 'head orientation', 'terminal front mouth', 'limb bud count'],
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
  const candidateTitle = [
    `${candidate.id}: ${candidate.motionAffordance.primary}`,
    `segments ${candidate.bodyPlan.segmentCount}`,
    `limb pairs ${candidate.bodyPlan.limbPairCount}`,
    `shell plates ${candidate.bodyPlan.shellPlateCount}`,
    `terminal mouth`,
  ].join(' / ');
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
      <title class="candidate-title">${xml(candidateTitle)}</title>
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

function createProxyPrimitives(candidate) {
  const primitives = [];
  const width = 0.09 + candidate.bodyPlan.contactWidth * 0.08;
  for (const sample of candidate.bodyPlan.axisSamples) {
    primitives.push({
      kind: 'metaball',
      role: 'body_mass',
      center: proxyPoint(sample),
      radius: round(width * candidate.bodyPlan.bulkScale * (0.82 + Math.sin(sample.t * Math.PI) * 0.24)),
      falloff: 'smooth_union',
    });
  }

  const head = candidate.semanticHandles.find(handle => handle.kind === 'head');
  const mouth = candidate.semanticHandles.find(handle => handle.kind === 'mouth');
  primitives.push({
    kind: 'sphere',
    role: 'head_orientation',
    center: proxyPoint(head.region, 0.02),
    radius: round(head.region.radius * 1.35),
    materialHint: 'soft_head_mass',
  });
  primitives.push({
    kind: 'sphere',
    role: 'terminal_mouth',
    center: proxyPoint(mouth.region, 0.055),
    radius: mouth.region.radius,
    materialHint: 'mouth_dark_wet_terminal',
  });

  for (const handle of candidate.semanticHandles.filter(item => item.kind === 'limb_bud')) {
    primitives.push({
      kind: 'capsule',
      role: 'limb_bud',
      center: proxyPoint(handle.region, -0.015),
      radius: round(0.018 + handle.strength * 0.018),
      length: round(handle.region.length * 1.7),
      side: handle.region.side,
      t: handle.region.t,
      materialHint: 'brace_drag_nub',
    });
  }

  for (const handle of candidate.semanticHandles.filter(item => item.kind === 'shell_plate')) {
    primitives.push({
      kind: 'box',
      role: 'shell_plate',
      center: proxyPoint(handle.region, 0.075),
      size: {
        x: round(handle.region.width * 1.4),
        y: 0.052,
        z: round(0.018 + candidate.bodyPlan.armorPressure * 0.04),
      },
      t: handle.region.t,
      materialHint: 'dorsal_plate',
    });
  }

  for (const point of candidate.contactPoints) {
    primitives.push({
      kind: 'sphere',
      role: 'contact_point',
      contactRole: point.role,
      center: proxyPoint(point, -0.08),
      radius: round(point.radius * 1.4),
      materialHint: 'ground_contact_marker',
    });
  }

  return primitives;
}

export function createLirmSpeciationArmatureControlPacket({ witness, candidate, candidateId } = {}) {
  const selectedCandidate = candidate || witness?.candidates?.find(item => item.id === candidateId);
  if (!witness || !selectedCandidate) {
    throw new Error('createLirmSpeciationArmatureControlPacket requires a witness and candidate or candidateId');
  }
  const candidateDir = `control-packets/${selectedCandidate.id}`;
  const proxyPrimitives = createProxyPrimitives(selectedCandidate);
  return {
    schema: LIRM_SPECIATION_ARMATURE_CONTROL_PACKET_SCHEMA,
    route: LIRM_SPECIATION_ARMATURE_CONTROL_PACKET_ROUTE,
    sourceWitnessId: witness.witnessId,
    sourceWitnessRoute: witness.route,
    candidateId: selectedCandidate.id,
    seed: selectedCandidate.seed,
    lineage: selectedCandidate.lineage,
    motionAffordance: selectedCandidate.motionAffordance,
    semanticHandles: selectedCandidate.semanticHandles,
    contactPoints: selectedCandidate.contactPoints,
    proxyPrimitives,
    conditioningMaps: [
      { kind: 'semantic-svg', path: `${candidateDir}/semantic-control.svg`, effectiveSource: 'local-procedural-svg' },
      { kind: 'silhouette-svg', path: `${candidateDir}/silhouette-control.svg`, effectiveSource: 'local-procedural-svg' },
      { kind: 'proxy-primitives-json', path: `${candidateDir}/proxy-primitives.json`, effectiveSource: 'local-procedural-proxy-primitives' },
    ],
    promptContract: {
      subject: 'small crawling hoard thief creature',
      preserve: ['axis curve', 'belly contact', 'terminal front mouth', 'head orientation', 'contact points'],
      allowMutation: ['surface material', 'micro anatomy', 'gross-cute balance', 'skin/shell texture'],
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
      'small crawling hoard-thief creature, invertebrate body plan, wet clay and keratin material, anxious semi-cute gross creature design',
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
  <text x="24" y="28" fill="rgba(238,246,214,0.9)" font-size="15" font-family="Menlo, Monaco, monospace">${xml(candidate.id)} proxy conditioning package</text>
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

export function createLirmSpeciationArmatureConditioningPackage({ witness, candidate, candidateId } = {}) {
  const selectedCandidate = candidate || witness?.candidates?.find(item => item.id === candidateId);
  if (!witness || !selectedCandidate) {
    throw new Error('createLirmSpeciationArmatureConditioningPackage requires a witness and candidate or candidateId');
  }
  const proxyBundle = createLirmSpeciationArmatureProxyRenderBundle({ witness, candidate: selectedCandidate });
  const packet = createLirmSpeciationArmatureControlPacket({ witness, candidate: selectedCandidate });
  const sourceImages = proxyBundle.renderMaps.map(map => ({
    kind: map.kind,
    path: `source-maps/${map.kind}-control.svg`,
    sourceProxyPath: map.path,
    requiredFor: map.kind === 'mask'
      ? ['imagegen_conditioning', 'sam3_isolation', 'alpha_cutout']
      : ['imagegen_conditioning', map.kind === 'clay' ? 'trellis_clay_probe' : `${map.kind}_control`],
    effectiveSource: 'local-procedural-proxy-render',
  }));
  const prompt = createConditioningPrompt(selectedCandidate, packet);
  return {
    schema: LIRM_SPECIATION_ARMATURE_CONDITIONING_PACKAGE_SCHEMA,
    route: LIRM_SPECIATION_ARMATURE_CONDITIONING_PACKAGE_ROUTE,
    sourceWitnessId: witness.witnessId,
    sourceWitnessRoute: witness.route,
    candidateId: selectedCandidate.id,
    seed: selectedCandidate.seed,
    sourceProxyRender: {
      schema: proxyBundle.schema,
      route: proxyBundle.route,
      candidateId: proxyBundle.candidateId,
      camera: proxyBundle.camera,
      proxyPrimitiveCount: proxyBundle.proxyPrimitiveCount,
    },
    sourceImages,
    prompt,
    routeCandidates: [
      {
        route: 'imagegen_img2img_depth_normal',
        status: 'requires_registered_imagegen_route',
        inputs: ['clay', 'depth', 'normal', 'mask', 'semantic'],
        purpose: 'test whether imagegen preserves proxy body identity before mesh/splat routes',
      },
      {
        route: 'trellis2mlx_fast_clay_probe',
        status: 'registered_greenroom_route_but_queue_blocked_by_existing_pixal3d_job',
        inputs: ['clay', 'mask'],
        purpose: 'cheap 3D sanity probe from the clay proxy source, not depth-normal conditioning',
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
    const proxyBundle = createLirmSpeciationArmatureProxyRenderBundle({ witness, candidateId });
    const candidateDir = join(outDir, candidateId);
    const sourceMapDir = join(candidateDir, 'source-maps');
    await mkdir(sourceMapDir, { recursive: true });
    for (const map of proxyBundle.renderMaps) {
      await writeFile(join(sourceMapDir, `${map.kind}-control.svg`), map.svg);
    }
    await writeFile(join(candidateDir, 'conditioning-panel.svg'), pkg.conditioningPanel.svg);
    const packageJson = {
      ...pkg,
      conditioningPanel: { path: pkg.conditioningPanel.path },
    };
    await writeFile(join(candidateDir, 'conditioning-package.json'), `${JSON.stringify(packageJson, null, 2)}\n`);
    packages.push(pkg);
    outputPackages.push({
      candidateId,
      package: `${candidateId}/conditioning-package.json`,
      panel: `${candidateId}/conditioning-panel.svg`,
      sourceMaps: pkg.sourceImages.map(image => ({ kind: image.kind, path: `${candidateId}/${image.path}` })),
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
      sourceImages: pkg.sourceImages.map(image => ({ kind: image.kind, path: image.path })),
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
  await writeFile(receiptPath, `${JSON.stringify(receiptWitness, null, 2)}\n`);
  return {
    schema: LIRM_SPECIATION_ARMATURE_WRITE_RESULT_SCHEMA,
    route: LIRM_SPECIATION_ARMATURE_ROUTE,
    outDir,
    seed: receiptWitness.seed,
    receiptPath,
    contactSheetPath,
    candidateCount: receiptWitness.candidates.length,
    controlPacketCount: controlPacketPaths.length,
  };
}
