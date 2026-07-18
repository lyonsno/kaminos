import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const witness = await readFile(new URL('../volume-boundary-splat-motion-witness.mjs', import.meta.url), 'utf8');

assert.match(
  witness,
  /kaminos\.volume\.boundary-splat-projected-work-aligned-sequence\.v0/,
  'projected-work motion witness must publish a distinct stable schema',
);
assert.match(
  witness,
  /volume_boundary_splat_projected_work_sequence/,
  'Greenroom route must carry the requested projected-work sequence targets',
);
assert.match(
  witness,
  /--projected-work-targets/,
  'the witness must expose the same target list as an explicit CLI input',
);
assert.match(
  witness,
  /projected-work sequence requires exact targets 0,12,24/,
  'the first aligned slice must reject stale, default, or silently substituted targets',
);
assert.match(
  witness,
  /captureProjectedWorkSequence/,
  'all projected-work arms must be captured inside one controlled sequence',
);
assert.match(
  witness,
  /boundarySplatMode:\s*'kernel_moment_full_flame_union'/,
  'the sequence must preserve the exact full-flame union renderer mode',
);
assert.match(
  witness,
  /boundarySplatProjectedWorkTargetPixels:\s*targetPixels/,
  'each frozen arm must apply its explicit projected-work target',
);
assert.match(
  witness,
  /boundary-splat-live-union-source-preserving-v0/,
  'full support must retain its source-preserving selector identity',
);
assert.match(
  witness,
  /boundary-splat-live-union-projected-footprint-hash-thinning-v0/,
  'thinned arms must retain the exact projected-footprint hash selector identity',
);
assert.match(
  witness,
  /projected-work stale requested\/effective target/,
  'requested and effective selector targets must be compared per arm',
);
assert.match(
  witness,
  /projected-work selector identity disagreement/,
  'wrong or source-preserving selector fallback must fail the thinned arms',
);
assert.match(
  witness,
  /projected-work full-union disagreement/,
  'all arms must preserve the same pre-selection full-union population',
);
assert.match(
  witness,
  /projected-work copy\/overflow rejected/,
  'copy or overflow telemetry must fail the sequence',
);
assert.match(
  witness,
  /projected-work blank\/partial evidence rejected/,
  'missing or blank arm output must fail loudly',
);
assert.match(
  witness,
  /projected-work live motion rejected/,
  'cached or static arm output must not certify motion',
);
assert.match(
  witness,
  /same-browser-same-frozen-state-full-12-24-v0/,
  'the report must name its cross-arm alignment authority',
);
assert.match(
  witness,
  /timingStatus:\s*'not-measured-by-motion-witness'/,
  'the visual sequence must not launder missing or partial timestamps into fresh cost evidence',
);
assert.match(
  witness,
  /lastTrustworthyEvidence\.projectedWorkSequence/,
  'a mid-sequence failure must still preserve the last trustworthy arm ledger',
);
assert.match(
  witness,
  /failurePhase\s*=\s*'projected-work-sequence-capture'/,
  'durable failure reports must identify projected-work capture failure',
);
assert.match(
  witness,
  /failurePhase\s*=\s*'projected-work-sequence-validation'/,
  'durable failure reports must identify projected-work validation failure',
);

console.log('boundary splat projected-work motion witness contracts passed');
