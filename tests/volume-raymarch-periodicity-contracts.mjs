import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

const raymarch = sourceBetween(
  core,
  'fn raymarchVolume(in: VSOut, sceneDepthEndT: f32) -> RaymarchResult {',
  'fn fs(in: VSOut) -> @location(0) vec4<f32> {',
);

assert.doesNotMatch(
  raymarch,
  /\b(?:sin|cos)\s*\(/,
  'production raymarch appearance must not contain direct explicit periodic modulation',
);
assert.doesNotMatch(
  raymarch,
  /verticalPhaseBreak|verticalPuffBreak/,
  'vertical phase/puff waves must not directly regularize smoke, fire, or vapor appearance',
);
assert.match(
  raymarch,
  /let\s+transportedPyroStructure\s*=\s*clamp\(/,
  'pyro appearance must derive structure from transported fields rather than a synthetic CPU atlas',
);
assert.doesNotMatch(
  raymarch,
  /pyroMemoryPattern|pyroMemoryCell|pyroSpatialEnergy|pyroMemoryStructure|samplePyroMaterialMemoryCell/,
  'the retired periodic pyro-memory atlas must not remain in production raymarch through an alias or sampler',
);
assert.doesNotMatch(
  raymarch,
  /microDetailDomainWarp|microFilamentNoise|filamentNoise|shredNoise|fireNoise|curtainNoise/,
  'production raymarch appearance must not call indirect periodic filament or domain-warp painters',
);
assert.doesNotMatch(
  core,
  /fn\s+microDetailDomainWarp\b|fn\s+microFilamentNoise\b/,
  'presentation-only periodic helper functions must be removed rather than left as dormant authority',
);
assert.match(
  raymarch,
  /let\s+transportedCurtainStructure\s*=\s*clamp\(/,
  'smoke curtain variation must derive from transported microdetail and material structure',
);
assert.match(
  raymarch,
  /let\s+transportedFireStructure\s*=\s*clamp\(/,
  'fire variation must derive from transported reaction and interface structure',
);
assert.match(
  raymarch,
  /let\s+visibleDetailOverlayGain\s*=\s*mix\(1\.0, 0\.35, detailScaleArtifactQuarantine\);/,
  'transported detail must preserve the inherited tall-plume amplitude quarantine',
);
assert.match(
  raymarch,
  /let\s+materialStructure\s*=\s*smoothstep\([^;]+\)\s*\*\s*visibleDetailOverlayGain;/,
  'transported material structure must respect the visible-detail amplitude quarantine',
);
assert.match(
  raymarch,
  /let\s+shredStructure\s*=\s*smoothstep\([^;]+\)\s*\*\s*visibleDetailOverlayGain;/,
  'transported shred structure must respect the visible-detail amplitude quarantine',
);
assert.match(
  raymarch,
  /let\s+fireStructure\s*=\s*smoothstep\([^;]+\)\s*\*\s*visibleDetailOverlayGain;/,
  'transported fire structure must respect the visible-detail amplitude quarantine',
);

function assertRetiredPyroBoundary(source) {
  const pyroStateUpdate = sourceBetween(
    source,
    'function updatePyroDynamicDetailState({ simReadback = null, inputKind = \'control-proxy\' } = {}) {',
    '\n  let adapter = null;',
  );

  assert.doesNotMatch(
    pyroStateUpdate,
    /Math\.(?:sin|cos)\s*\(/,
    'renderer-adjacent Pyro state must not synthesize a self-advancing periodic atlas',
  );
  assert.doesNotMatch(
    source,
    /fn\s+samplePyroMaterialMemoryCell\b/,
    'the synthetic Pyro atlas sampler must be removed from shader authority',
  );
  assert.equal(
    [...source.matchAll(/\bpyro_detail_cells\b/g)].length,
    1,
    'the reserved Pyro field name may occur only in its uniform-layout declaration; expression access and aliases are forbidden',
  );
  assert.match(
    source,
    /^\s*pyro_detail_cells:\s*array<vec4<f32>,\s*24>,\s*$/m,
    'the one reserved Pyro field occurrence must remain the exact compatibility declaration',
  );
  assert.doesNotMatch(
    source,
    /identity:\s*'pyro-material-memory-spatial-coupling-v0'|updateRule:\s*'pyro-cellular-detail-memory-deterministic-ca-v0'|(?:materialShaderReadiness|shaderReadiness):\s*'blocked-reset'/,
    'initial and live receipts must not advertise retired spatial-atlas authority',
  );

  const reservedUploadLoop = sourceBetween(
    source,
    '    for (let memoryIndex = 0; memoryIndex < 24; memoryIndex += 1) {',
    '    const pyroInterfaceFocus',
  );
  assert.equal(
    reservedUploadLoop.trim(),
    `for (let memoryIndex = 0; memoryIndex < 24; memoryIndex += 1) {
      uniforms[88 + memoryIndex * 4] = 0;
      uniforms[89 + memoryIndex * 4] = 0;
      uniforms[90 + memoryIndex * 4] = 0;
      uniforms[91 + memoryIndex * 4] = 0;
    }`,
    'the bounded reserved Pyro upload loop must contain exactly four direct zero writes and no aliases or later overwrite',
  );

  const receiptSlices = [
    {
      name: 'initial renderer coupling',
      source: sourceBetween(source, '    pyroMaterialRendererCoupling: {', '    pressureTierDispatches: [],'),
      readinessField: 'materialShaderReadiness',
      requireUploadedCells: true,
    },
    {
      name: 'initial material-memory projection',
      source: sourceBetween(source, '    pyroDynamicDetail: {', '    lastFrameEnergy: 0,'),
      readinessField: 'shaderReadiness',
      requireUploadedCells: false,
    },
    {
      name: 'rebuilt material-memory projection',
      source: sourceBetween(source, '  function buildPyroDynamicDetailMaterialMemory({', '  function updatePyroDynamicDetailState({'),
      readinessField: 'shaderReadiness',
      requireUploadedCells: false,
    },
    {
      name: 'live renderer coupling',
      source: sourceBetween(source, '    state.pyroMaterialRendererCoupling = {', '    state.runtimeQualityRequested ='),
      readinessField: 'materialShaderReadiness',
      requireUploadedCells: true,
    },
  ];
  for (const receipt of receiptSlices) {
    const readinessValues = [...receipt.source.matchAll(
      new RegExp(`${receipt.readinessField}:\\s*'([^']+)'`, 'g'),
    )].map(match => match[1]);
    assert.deepEqual(
      readinessValues,
      ['retired-synthetic-atlas'],
      `${receipt.name} must independently declare retired synthetic-atlas readiness exactly once`,
    );
    if (receipt.requireUploadedCells) {
      const uploadedCellValues = [...receipt.source.matchAll(/uploadedCells:\s*([^,\n}]+)/g)]
        .map(match => match[1].trim());
      assert.deepEqual(
        uploadedCellValues,
        ['0'],
        `${receipt.name} must independently fail closed on synthetic atlas uploads`,
      );
    }
  }
}

assertRetiredPyroBoundary(core);

const retiredPyroMutations = [
  [
    'aliased reserved-array read',
    source => source.replace(
      'fn raymarchVolume(in: VSOut, sceneDepthEndT: f32) -> RaymarchResult {',
      `fn raymarchVolume(in: VSOut, sceneDepthEndT: f32) -> RaymarchResult {
  let renamedReservedCells = u.pyro_detail_cells;
  let leakedReservedCell = renamedReservedCells[0u];`,
    ),
  ],
  [
    'post-zero nonzero overwrite',
    source => source.replace(
      '      uniforms[91 + memoryIndex * 4] = 0;',
      `      uniforms[91 + memoryIndex * 4] = 0;
      uniforms[91 + memoryIndex * 4] = pyroMaterialEnergy;`,
    ),
  ],
  [
    'aliased reserved destination overwrite',
    source => source.replace(
      '      uniforms[91 + memoryIndex * 4] = 0;',
      `      uniforms[91 + memoryIndex * 4] = 0;
      const latePyroOffset = 91;
      uniforms[latePyroOffset + memoryIndex * 4] = pyroMaterialEnergy;`,
    ),
  ],
  [
    'single-projection receipt drift',
    source => source.replace(
      "      materialShaderReadiness: 'retired-synthetic-atlas',",
      "      materialShaderReadiness: 'active-synthetic-atlas',",
    ),
  ],
];

for (const [name, mutate] of retiredPyroMutations) {
  assert.throws(
    () => assertRetiredPyroBoundary(mutate(core)),
    `${name} must violate the retired Pyro semantic boundary`,
  );
}

console.log('volume raymarch periodicity contracts passed');
