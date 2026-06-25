#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const ORB_INNER_ENGINE_PROMPT_MATRIX_IDENTITY = 'orb-inner-engine-prompt-matrix-v0';

function hashString(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function sha256Text(text) {
  return createHash('sha256').update(text).digest('hex');
}

function jsonWrite(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

function parseArgs(argv) {
  const values = new Map();
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const hasValue = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--');
    const value = hasValue ? argv[++i] : 'true';
    values.set(key, value);
  }
  return {
    get(key, fallback = undefined) {
      return values.has(key) ? values.get(key) : fallback;
    },
  };
}

const PROMPT_FAMILIES = [
  {
    id: 'reactor-insert',
    subject: 'macro product render of a circular amber reactor insert',
    concreteParts: 'stacked blackened steel turbine rings, heavy bronze collars, radial cooling ribs, dark shadow gaps, amber ceramic light channels, a small ember aperture at the center',
    composition: 'socket-centered square composition, orthographic front view, dark neutral background, crisp rim silhouette',
  },
  {
    id: 'mechanical-iris',
    subject: 'front view of an ornate mechanical iris engine core',
    concreteParts: 'overlapping shutter blades, nested gear rings, scorched gunmetal ribs, copper pin joints, amber glass slits, deep occlusion pockets between the blades',
    composition: 'symmetrical circular artifact interior, close-up, flat-on camera, dark workshop render lighting',
  },
  {
    id: 'turbine-stator',
    subject: 'close-up render of a compact turbine stator furnace core',
    concreteParts: 'radial stator fins, concentric machined rings, soot-dark cavities, bolted ribs, orange molten enamel channels, hot center plug recessed behind metal',
    composition: 'centered industrial component view, square crop, high-detail material study, dark gray backdrop',
  },
  {
    id: 'furnace-core',
    subject: 'fantasy forge component showing a contained amber furnace core',
    concreteParts: 'nested iron bands, ribbed heat baffles, charred outer rim machinery, small glowing inner crucible, segmented orange channels bounded by cold metal',
    composition: 'front-biased socket insert, circular crop with readable edge machinery, deep shadows around the rim',
  },
  {
    id: 'arcane-jewel',
    subject: 'ornate amber artifact socket with a mechanical jewel-like engine inside',
    concreteParts: 'faceted ember glass, black enamel gear rings, fine radial ribs, bronze occluder petals, dark cavities, thin orange light traces trapped under metal lips',
    composition: 'jewelry macro render, centered circular medallion interior, sharp focus, low-key studio light',
  },
  {
    id: 'aperture-contained-machine',
    subject: 'contained inner machine visible through a circular aperture proxy',
    concreteParts: 'foreground dark aperture lip, recessed amber reactor center, nested machine rings, radial ribs half-hidden by occluders, blackened outer machinery, bounded orange spill on the rim',
    composition: 'the viewer sees through a heavy shell opening into the socket, close-up square frame, strong depth layering',
  },
];

const DECOMPOSED_PROMPT_FAMILIES = [
  {
    id: 'black-ceramic-clockwork-insert',
    decompositionLayer: 'mechanical-substrate',
    compositionRole: 'cold-occluding-socket-structure',
    subject: 'macro product render of a black ceramic clockwork aperture insert',
    concreteParts: 'radial shutter leaves, nested baffle rings, hard occluder geometry, stepped gunmetal ribs, black ceramic teeth, copper pin joints, empty recessed central socket',
    composition: 'orthographic front view, square crop, matte charcoal background, crisp machined silhouette, unlit opaque surfaces',
  },
  {
    id: 'segmented-energy-inlay',
    decompositionLayer: 'bounded-energy',
    compositionRole: 'emissive-channel-plate',
    subject: 'isolated red-orange emissive channel inlay plate for a circular artifact',
    concreteParts: 'thin red-orange glowing enamel lines, segmented radial channel masks, amber light traces, small hot center mark, dark transparent gaps between channels',
    composition: 'flat graphic material plate, square crop, black background, high contrast bounded glow, restrained low-bloom edges',
  },
  {
    id: 'mechanical-energy-composite-reference',
    decompositionLayer: 'composite-reference',
    compositionRole: 'reference-only-combined-read',
    subject: 'black ceramic radial shutter artifact with separate red-orange channel inlays seated beneath it',
    concreteParts: 'dark occluding baffles, nested rings, radial ribs, red-orange emissive inlay lines visible only through grooves, recessed center, shadowed rim matter',
    composition: 'front-biased socket insert, square crop, hard material edges, restrained glow contained below the top layer',
  },
];

const SAFETY_AXES = [
  {
    id: 'legacy-evil-token',
    triggerCandidate: 'evil',
    triggerTokens: ['evil'],
    mutation: prompt => `${prompt}. The design language is an evil orb inner engine, ominous but non-character and non-violent.`,
    expectedOutcome: 'may-block',
  },
  {
    id: 'temperature-white-hot-token',
    triggerCandidate: 'white-hot',
    triggerTokens: ['white-hot'],
    mutation: prompt => prompt.replace('amber', 'white-hot amber'),
    expectedOutcome: 'may-block-or-overexpose',
  },
  {
    id: 'negative-safety-card-token',
    triggerCandidate: 'safety-filter-card',
    triggerTokens: ['safety filter', 'blocked card'],
    mutation: prompt => prompt,
    negative: 'safety filter card, blocked card, warning text, black error screen',
    expectedOutcome: 'may-block-from-negative-keywords',
  },
];

function cleanPromptForFamily(family, mode) {
  const density = mode === 'dense'
    ? 'many small mechanical details, alternating wide and narrow ribs, layered occluder shadows, irregular soot staining, high-frequency machined bevels'
    : 'clear readable mechanical structure, strong radial ribs, nested rings, bounded glow';
  return [
    family.subject,
    family.concreteParts,
    density,
    'warm amber and orange emission stays inside channels and behind metal, darker outer machinery rim, no visible text',
    family.composition,
    'physically plausible metal, ceramic, glass, and shadow, polished concept-art render',
  ].join('. ');
}

function cleanPromptForDecomposedFamily(family, mode) {
  const density = mode === 'dense'
    ? 'many small asymmetric bevels, alternating narrow and wide segments, tiny fasteners, irregular soot-dark patina, high-frequency hard-surface detail'
    : 'clear readable radial structure, sharp segment boundaries, layered depth, precise material separation';
  const layerConstraint = family.decompositionLayer === 'mechanical-substrate'
    ? 'cold inactive material study, matte opaque ceramic and alloy surfaces, mechanical parts remain solid and non-optical'
    : (family.decompositionLayer === 'bounded-energy'
        ? 'red-orange emissive channel material stays in thin bounded inlays, dark gaps stay visible, text-free abstract material plate'
        : 'separate dark top structure and red-orange inlay layer remain readable as two composited materials, glow stays below the occluding top layer');
  return [
    family.subject,
    family.concreteParts,
    density,
    layerConstraint,
    family.composition,
    'physically plausible hard-surface concept-art render',
  ].join('. ');
}

function itemSeed({ matrixSeed, familyId, variantId }) {
  return String(hashString(`${matrixSeed}:${familyId}:${variantId}`) % 2147483647);
}

function qualityHypothesisFor(familyId, decompositionLayer = null) {
  if (decompositionLayer === 'mechanical-substrate') {
    return {
      familyTarget: familyId,
      decompositionLayer,
      mustRead: [
        'radial shutter structure',
        'nested rings',
        'radial ribs',
        'hard occluder geometry',
        'dark outer machinery',
        'empty socket depth',
      ],
      rejectRead: [
        'clean camera lens',
        'glowing glass eye',
        'flat orange disk',
        'full fireball',
        'generic sci-fi portal',
        'new outer shell design',
      ],
    };
  }
  if (decompositionLayer === 'bounded-energy') {
    return {
      familyTarget: familyId,
      decompositionLayer,
      mustRead: [
        'bounded emissive channels',
        'red-orange inlay material',
        'segmented radial mask',
        'small hot center',
        'transparent gaps',
      ],
      rejectRead: [
        'full fireball',
        'unbounded bloom ball',
        'smoke plume',
        'flat orange disk',
        'clean camera lens',
        'warning text',
        'new outer shell design',
      ],
    };
  }
  if (decompositionLayer === 'composite-reference') {
    return {
      familyTarget: familyId,
      decompositionLayer,
      mustRead: [
        'two-layer composition',
        'dark occluding top structure',
        'bounded emissive channels',
        'radial ribs',
        'nested rings',
        'contained center',
      ],
      rejectRead: [
        'clean camera lens',
        'full fireball',
        'unbounded bloom ball',
        'flat orange disk',
        'single flat disk',
        'new outer shell design',
      ],
    };
  }
  return {
    familyTarget: familyId,
    mustRead: [
      'hot radial center',
      'nested rings',
      'radial ribs',
      'mechanical occluders',
      'dark outer machinery',
      'bounded orange channels',
    ],
    rejectRead: [
      'flat orange disk',
      'generic fireball',
      'unbounded bloom ball',
      'clean camera lens',
      'pasted aura',
      'new outer shell design',
    ],
  };
}

function makeItem({ index, coreSeed, matrixSeed, providerId, family, variant }) {
  const basePrompt = cleanPromptForFamily(family, variant.mode || 'clean');
  const positive = variant.mutate ? variant.mutate(basePrompt) : basePrompt;
  const negative = variant.negative || '';
  const triggerTokens = variant.triggerTokens || [];
  return {
    id: `orb-inner-engine-prompt-${String(index + 1).padStart(2, '0')}`,
    status: 'queued',
    coreSeed,
    matrixSeed,
    providerId,
    generatorRoute: providerId,
    promptFamily: family.id,
    promptVariant: variant.id,
    decompositionLayer: family.decompositionLayer || null,
    compositionRole: family.compositionRole || null,
    batchLane: variant.batchLane,
    seed: itemSeed({ matrixSeed, familyId: family.id, variantId: variant.id }),
    positive,
    negative,
    promptSha256: sha256Text(JSON.stringify({ positive, negative })),
    safetyHypothesis: {
      expectedOutcome: variant.expectedOutcome,
      triggerTokens,
      notes: variant.notes,
    },
    qualityHypothesis: qualityHypothesisFor(family.id, family.decompositionLayer || null),
    framing: {
      aspectRatio: '1:1',
      crop: 'socket-centered circular core with readable outer machinery',
      background: 'dark neutral or aperture-proxy depth',
      camera: 'front-biased close-up',
    },
    executionPolicy: {
      isolateFromQualityRun: variant.batchLane === 'safety-ablation',
      greenroomRequired: false,
      timingRequired: true,
      blockedOutputStatus: 'provider-blocked-output',
      routeFailureMustWriteReceipt: true,
    },
    downstreamRoutes: ['sharp.splat', 'trellis2mlx.mesh-pbr', 'pixal3d.mesh-pbr'],
  };
}

function makeDecomposedItem({ index, coreSeed, matrixSeed, providerId, family, variant }) {
  const basePrompt = cleanPromptForDecomposedFamily(family, variant.mode || 'clean');
  const positive = variant.mutate ? variant.mutate(basePrompt) : basePrompt;
  const negative = '';
  return {
    id: `orb-inner-engine-prompt-${String(index + 1).padStart(2, '0')}`,
    status: 'queued',
    coreSeed,
    matrixSeed,
    providerId,
    generatorRoute: providerId,
    promptFamily: family.id,
    promptVariant: variant.id,
    decompositionLayer: family.decompositionLayer,
    compositionRole: family.compositionRole,
    batchLane: 'decomposed-quality',
    seed: itemSeed({ matrixSeed, familyId: family.id, variantId: variant.id }),
    positive,
    negative,
    promptSha256: sha256Text(JSON.stringify({ positive, negative })),
    safetyHypothesis: {
      expectedOutcome: 'should-complete',
      triggerTokens: [],
      notes: 'Decomposed affirmative prompt. Avoids overloaded structural and combustion vocabulary in the cold substrate pass.',
    },
    qualityHypothesis: qualityHypothesisFor(family.id, family.decompositionLayer),
    framing: {
      aspectRatio: '1:1',
      crop: family.decompositionLayer === 'bounded-energy'
        ? 'centered circular channel plate with transparent-looking dark gaps'
        : 'socket-centered circular mechanical insert with readable edge machinery',
      background: family.decompositionLayer === 'bounded-energy' ? 'black or transparent-looking dark field' : 'dark neutral material study',
      camera: 'front-biased close-up',
    },
    executionPolicy: {
      isolateFromQualityRun: true,
      greenroomRequired: true,
      timingRequired: true,
      blockedOutputStatus: 'provider-blocked-output',
      blankOutputStatus: 'provider-blank-output',
      routeFailureMustWriteReceipt: true,
    },
    downstreamRoutes: ['shader.composite', 'sharp.splat', 'trellis2mlx.mesh-pbr', 'pixal3d.mesh-pbr'],
  };
}

function makeVariantsForFamily(familyIndex) {
  const safetyAxis = SAFETY_AXES[familyIndex % SAFETY_AXES.length];
  return [
    {
      id: 'clean-affirmative',
      batchLane: 'quality-baseline',
      mode: 'clean',
      expectedOutcome: 'should-complete',
      triggerTokens: [],
      notes: 'Affirmative, visually grounded baseline. Avoids negation and known risky tokens.',
    },
    {
      id: 'dense-affirmative',
      batchLane: 'quality-baseline',
      mode: 'dense',
      expectedOutcome: 'should-complete',
      triggerTokens: [],
      notes: 'Higher-detail baseline to test whether simplistic/lens-like output is prompt underspecification.',
    },
    {
      id: safetyAxis.id,
      batchLane: 'safety-ablation',
      mode: 'clean',
      mutate: safetyAxis.mutation,
      negative: safetyAxis.negative || '',
      expectedOutcome: safetyAxis.expectedOutcome,
      triggerTokens: safetyAxis.triggerTokens,
      notes: `Safety probe for ${safetyAxis.triggerCandidate}; run isolated from quality batches.`,
    },
  ];
}

function makeDecomposedVariantsForFamily(family) {
  if (family.decompositionLayer === 'mechanical-substrate') {
    return [
      { id: 'orthographic-cold-substrate', mode: 'clean' },
      {
        id: 'dense-baffle-substrate',
        mode: 'dense',
        mutate: prompt => `${prompt}. Emphasize broken ring cadence and visible negative space between occluder leaves.`,
      },
      {
        id: 'aperture-shadow-substrate',
        mode: 'clean',
        mutate: prompt => `${prompt}. Foreground aperture shadow partially hides the outer baffle ring while the central socket remains empty.`,
      },
    ];
  }
  if (family.decompositionLayer === 'bounded-energy') {
    return [
      { id: 'thin-channel-energy', mode: 'clean' },
      {
        id: 'dense-channel-energy',
        mode: 'dense',
        mutate: prompt => `${prompt}. Emissive lines vary in thickness and leave dark masked separations between every segment.`,
      },
      {
        id: 'center-pulse-energy',
        mode: 'clean',
        mutate: prompt => `${prompt}. The small center mark is brighter than the outer inlays but the outer glow remains tightly bounded.`,
      },
    ];
  }
  return [
    { id: 'restrained-composite-reference', mode: 'clean' },
    {
      id: 'dense-composite-reference',
      mode: 'dense',
      mutate: prompt => `${prompt}. The dark top layer casts occlusion over the red-orange inlay layer.`,
    },
    {
      id: 'aperture-composite-reference',
      mode: 'clean',
      mutate: prompt => `${prompt}. A dark aperture lip crops the outer ring without changing the artifact structure.`,
    },
  ];
}

export function createOrbInnerEnginePromptMatrix({
  coreSeed = 'molten-heartfucker-core-v0',
  matrixSeed = 'ideogram-prompt-matrix-v0',
  providerId = 'local-image.ideogram4',
} = {}) {
  const items = [];
  for (const [familyIndex, family] of PROMPT_FAMILIES.entries()) {
    for (const variant of makeVariantsForFamily(familyIndex)) {
      items.push(makeItem({
        index: items.length,
        coreSeed,
        matrixSeed,
        providerId,
        family,
        variant,
      }));
    }
  }
  for (const family of DECOMPOSED_PROMPT_FAMILIES) {
    for (const variant of makeDecomposedVariantsForFamily(family)) {
      items.push(makeDecomposedItem({
        index: items.length,
        coreSeed,
        matrixSeed,
        providerId,
        family,
        variant,
      }));
    }
  }
  return {
    identity: ORB_INNER_ENGINE_PROMPT_MATRIX_IDENTITY,
    coreSeed,
    matrixSeed,
    providerId,
    createdBy: 'molten-heartfucker',
    target: 'evil-orb-inner-engine',
    strategy: {
      promptVsDistributionRule: 'Test adjacent prompt families under the same route: if adjacent prompt families make rich machinery while direct orb wording blocks or collapses, treat this as prompt pathology; if all clean adjacent families collapse to flat/lens/simple disks, treat it as model or route distribution anti-evidence.',
      ideogramNotes: [
        'Ideogram guidance says negative phrasing can fail because the model focuses on the unwanted keyword; quality baselines therefore use affirmative descriptions and empty negative prompts.',
        'Ideogram troubleshooting recommends visually grounded synonyms, important details early, and prompt length below roughly 150-160 words.',
        'Ideogram V4 API distinguishes text_prompt, which enables Magic Prompt automatically, from json_prompt, which disables Magic Prompt and is consumed directly.',
      ],
      decompositionPlan: {
        status: 'active',
        layers: ['mechanical-substrate', 'bounded-energy', 'composite-reference'],
        hypothesis: 'If the generator can make a cold hard-surface socket and a separate bounded red-orange energy plate more reliably than a combined molten engine, later shader/composite work can assemble the core while preserving procedural fallback.',
        activeBatchLane: 'decomposed-quality',
      },
      sourceDocs: [
        'https://docs.ideogram.ai/using-ideogram/prompting-guide/3-prompt-structure',
        'https://docs.ideogram.ai/using-ideogram/prompting-guide/4-handling-negatives',
        'https://docs.ideogram.ai/using-ideogram/prompting-guide/8-troubleshooting',
        'https://developer.ideogram.ai/api-reference/api-reference/generate-v4',
      ],
    },
    priorObservations: [
      {
        status: 'provider-blocked-output',
        providerId: 'local-image.ideogram4',
        promptFamily: 'legacy-orb-direct',
        outputPath: '/tmp/kaminos-orb-inner-engine-ideogram-live-smoke/orb-inner-engine-concept-loop-v0/images/local-image.ideogram4/orb-inner-engine-concept-01.png',
        timing: { timeTotalSeconds: 144.3, routeDurationMsKnown: true },
        detectorMetrics: {
          blackRatio: 0.9796791076660156,
          whiteRatio: 0.010051727294921875,
          centerWhiteRatio: 1,
          colorRatio: 0,
        },
        inference: 'Route success was false closure; black safety-card output is not generated art.',
      },
      {
        status: 'complete-but-weak',
        providerId: 'local-image.ideogram4',
        promptFamily: 'sanitized-amber-core',
        outputPath: '/tmp/kaminos-orb-inner-engine-ideogram-safe-smoke-r2/orb-inner-engine-concept-loop-v0/images/local-image.ideogram4/orb-inner-engine-concept-01.png',
        timing: { timeTextEncoderSeconds: 30.9, timeSamplingSeconds: 154.1, timeTotalSeconds: 238.7, memoryPeakGb: 11.55 },
        visualVerdict: 'usable concept seed but too sparse and lens-like; lacks radial rib complexity, occluder breakup, nested mechanical channeling, and trapped aperture containment',
      },
    ],
    promptFamilies: PROMPT_FAMILIES,
    decomposedPromptFamilies: DECOMPOSED_PROMPT_FAMILIES,
    safetyAxes: SAFETY_AXES.map(axis => ({
      id: axis.id,
      triggerCandidate: axis.triggerCandidate,
      triggerTokens: axis.triggerTokens,
      expectedOutcome: axis.expectedOutcome,
    })),
    executionPlan: {
      firstPass: 'run quality-baseline items first, record timing and blocked-output status per item',
      decomposedPass: 'run decomposed-quality items through greenroom in a small batch: mechanical substrate, bounded energy, then a composite reference control',
      secondPass: 'run safety-ablation items only in an isolated batch when mapping filter triggers',
      review: 'feed generated image paths and this rubric into Gemini or another VLM; keep human visual smoke for finalists',
      timing: 'Real local Ideogram observations are minutes per 512x512 image; fixture-route millisecond timing is not generator timing.',
    },
    items,
  };
}

export function createGeminiReviewPacket(matrix) {
  const imageRoot = `images/${matrix.providerId}`;
  return {
    identity: 'orb-inner-engine-gemini-review-packet-v0',
    parentIdentity: matrix.identity,
    providerId: matrix.providerId,
    rubric: {
      acceptIf: [
        'contained radial engine visible through or suitable behind apertures',
        'hot center with bounded emission',
        'dark rim machinery and inner occlusion',
        'nested rings and radial ribs are structurally visible',
      ],
      rejectIf: [
        'safety filter card',
        'flat orange disk',
        'generic fireball',
        'clean camera lens',
        'bloom ball',
        'outer shell redesign dominates the image',
      ],
      scoreFields: [
        'radial rib structure',
        'nested ring depth',
        'mechanical occluder breakup',
        'aperture-contained emission',
        'dark rim machinery',
        'bounded orange channel readability',
        'decomposed layer usability',
      ],
      outputSchema: {
        itemId: 'string',
        accepted: 'boolean',
        scores0To5: 'object',
        rejectionReasons: 'string[]',
        shortVisualVerdict: 'string',
      },
    },
    items: matrix.items.map(item => ({
      itemId: item.id,
      promptFamily: item.promptFamily,
      promptVariant: item.promptVariant,
      decompositionLayer: item.decompositionLayer,
      compositionRole: item.compositionRole,
      batchLane: item.batchLane,
      expectedImagePath: `${imageRoot}/${item.id}.png`,
      promptSha256: item.promptSha256,
      safetyHypothesis: item.safetyHypothesis,
      qualityHypothesis: item.qualityHypothesis,
    })),
  };
}

function makePromptQueue(matrix) {
  return {
    identity: 'orb-inner-engine-prompt-matrix-queue-v0',
    parentIdentity: matrix.identity,
    coreSeed: matrix.coreSeed,
    matrixSeed: matrix.matrixSeed,
    providerId: matrix.providerId,
    items: matrix.items.map(item => ({
      id: item.id,
      status: item.status,
      generatorRoute: item.providerId,
      seed: item.seed,
      positive: item.positive,
      negative: item.negative,
      framing: item.framing,
      batchLane: item.batchLane,
      promptFamily: item.promptFamily,
      promptVariant: item.promptVariant,
      decompositionLayer: item.decompositionLayer,
      compositionRole: item.compositionRole,
      safetyHypothesis: item.safetyHypothesis,
      qualityHypothesis: item.qualityHypothesis,
      downstreamRoutes: item.downstreamRoutes,
    })),
  };
}

export function writeOrbInnerEnginePromptMatrixBundle({
  outDir,
  coreSeed = 'molten-heartfucker-core-v0',
  matrixSeed = 'ideogram-prompt-matrix-v0',
  providerId = 'local-image.ideogram4',
} = {}) {
  if (!outDir) {
    throw new Error('writeOrbInnerEnginePromptMatrixBundle requires caller-provided outDir');
  }
  const bundleRoot = resolve(outDir, ORB_INNER_ENGINE_PROMPT_MATRIX_IDENTITY);
  mkdirSync(bundleRoot, { recursive: true });
  const matrix = createOrbInnerEnginePromptMatrix({ coreSeed, matrixSeed, providerId });
  const promptQueue = makePromptQueue(matrix);
  const geminiReviewPacket = createGeminiReviewPacket(matrix);

  const matrixPath = join(bundleRoot, 'prompt-matrix.json');
  const promptQueuePath = join(bundleRoot, 'prompt-queue.json');
  const geminiReviewPacketPath = join(bundleRoot, 'gemini-review-packet.json');
  const receiptPath = join(bundleRoot, 'receipt.json');

  jsonWrite(matrixPath, matrix);
  jsonWrite(promptQueuePath, promptQueue);
  jsonWrite(geminiReviewPacketPath, geminiReviewPacket);

  const receipt = {
    ok: true,
    identity: ORB_INNER_ENGINE_PROMPT_MATRIX_IDENTITY,
    coreSeed,
    matrixSeed,
    providerId,
    itemCount: matrix.items.length,
    qualityBaselineCount: matrix.items.filter(item => item.batchLane === 'quality-baseline').length,
    safetyAblationCount: matrix.items.filter(item => item.batchLane === 'safety-ablation').length,
    decomposedQualityCount: matrix.items.filter(item => item.batchLane === 'decomposed-quality').length,
    outputs: {
      bundleRoot,
      matrixPath,
      promptQueuePath,
      geminiReviewPacketPath,
      receiptPath,
    },
    honesty: {
      liveGeneratorsInvoked: false,
      status: 'matrix-only-no-live-generation',
      boundary: 'This receipt records prompts, safety hypotheses, and review packet shape only. No Ideogram, Gemini, SHARP, mesh, or volume route was executed.',
    },
  };
  jsonWrite(receiptPath, receipt);

  return {
    ok: true,
    identity: ORB_INNER_ENGINE_PROMPT_MATRIX_IDENTITY,
    bundleRoot,
    matrixPath,
    promptQueuePath,
    geminiReviewPacketPath,
    receiptPath,
  };
}

const invokedAsScript = process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href;
if (invokedAsScript) {
  const args = parseArgs(process.argv);
  const result = writeOrbInnerEnginePromptMatrixBundle({
    outDir: args.get('--out-dir'),
    coreSeed: args.get('--core-seed', 'molten-heartfucker-core-v0'),
    matrixSeed: args.get('--matrix-seed', 'ideogram-prompt-matrix-v0'),
    providerId: args.get('--provider-id', 'local-image.ideogram4'),
  });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
