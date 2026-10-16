// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const fnBody = name => { const at = source.indexOf(`async function ${name}(`); assert.ok(at >= 0, `${name} exists`); return source.slice(at, source.indexOf('\n  }\n', at)); };

// The step's own GPU cost, measured, not inferred from wall time: timestamp
// queries around the sim pass and the pressure projection over N steps from the
// current state. The receipt names the feature status, the step count, the
// reaction law and appearance model in force, and per-step means in microseconds.

test('sampleSimGpuProfile times the sim pass and the projection over N steps with timestamp queries', () => {
  const body = fnBody('sampleSimGpuProfile');
  assert.match(body, /identity: SIM_GPU_PROFILE_IDENTITY/);
  assert.match(body, /if \(!device\.features\?\.has\?\.\('timestamp-query'\)\) \{[^}]*timestamp-query-not-supported/, 'unsupported is a named status, not zeros');
  assert.match(body, /const steps = Math\.max\(1, Math\.min\(4096, Math\.floor\(Number\(options\.steps\) \|\| 64\)\)\);/);
  assert.match(body, /device\.createQuerySet\(\{ type: 'timestamp', count: steps \* 4 \}\)/, 'two intervals per step: sim pass, projection');
  assert.match(body, /encodeSim\(encoder, \{\s*timestampWrites: \{ querySet, beginningOfPassWriteIndex: step \* 4, endOfPassWriteIndex: step \* 4 \+ 1 \},\s*finalTimestampWrites: \{ querySet, beginningOfPassWriteIndex: step \* 4 \+ 2, endOfPassWriteIndex: step \* 4 \+ 3 \},\s*\}\)/);
  assert.match(body, /updateUniforms\(/, 'each step packs its uniforms like a real step');
  assert.match(body, /resolveQuerySet\(querySet, 0, steps \* 4, resolveBuffer, 0\)/);
  assert.match(body, /const encoder = device\.createCommandEncoder\([^)]*\);\n\s*updateUniforms\(/, 'one encoder and one submit per step, like the frame loop');
  assert.match(body, /profile\.simPass = stats\(simSamples\);/, 'order statistics (median, min, p10, p90) beside the mean');
  assert.match(body, /return \{ mean: [^}]*median: q\(0\.5\), min: sorted\[0\], p10: q\(0\.1\), p90: q\(0\.9\), count: samples\.length \};/);
  assert.match(body, /simPassMicrosecondsPerStep/);
  assert.match(body, /projectionMicrosecondsPerStep/);
  assert.match(body, /const overrideModel = APPEARANCE_MODELS\.includes\(options\.appearanceModel\) \? options\.appearanceModel : null;/, 'one page can profile either model (ABAB) without reloading');
  assert.match(body, /controlsSnapshot\.appearanceModel = savedAppearanceModel;/, 'the override is restored in finally');
  assert.match(body, /reactionLaw: state\.reactantCombustion\?\.effective\?\.law \?\? null, appearanceModel: state\.appearanceModel\?\.effective \?\? null/, 'the receipt names what was in force');
  assert.match(source, /^\s*sampleSimGpuProfile,$/m, 'exposed on the page API');
  assert.match(source, /const SIM_GPU_PROFILE_IDENTITY = 'kaminos\.volume\.sim-gpu-profile\.v0';/);
});
