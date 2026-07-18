import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

async function source(name) {
  try {
    return await readFile(new URL(name, root), 'utf8');
  } catch {
    assert.fail(`${name} is absent`);
  }
}

const page = await source('view-conditioned-transfer-gpu-builder.html');
const witness = await source('view-conditioned-transfer-gpu-builder.mjs');

assert.match(page, /kaminos\.view-conditioned-transfer-gpu-builder-page\.v0/, 'page schema is explicit');
assert.match(page, /gpu-resident-d12-t2-builder-v0/, 'effective builder identity is explicit');
assert.match(page, /manifest\.treatment\.label\s*===\s*['"]d12-t2['"]/, 'page requires the authenticated d12-t2 treatment');
assert.match(page, /EXPECTED_DENSE_SHAPE\s*=\s*\[96,\s*242,\s*314\]/, 'page requires the exact dense workload');
assert.match(page, /EXPECTED_REDUCED_SHAPE\s*=\s*\[12,\s*121,\s*157\]/, 'page requires the exact reduced workload');
assert.match(page, /DENSE_SLICES_PER_GROUP\s*=\s*8/, 'builder binds the exact eight-slice depth partition');
assert.match(page, /@builtin\(global_invocation_id\)[\s\S]*gid\.z[\s\S]*DENSE_SLICES_PER_GROUP/, 'builder dispatches one invocation per reduced depth/tile element');
assert.match(page, /builtRidge[\s\S]*builtNonridge[\s\S]*builtTransmittance/, 'builder preserves Ridge, Non-Ridge, and shared transmittance outputs');
assert.match(page, /tilePixelCount[\s\S]*tileRadiance[\s\S]*tileTransmittance/, 'builder performs explicit post-composition tile averaging');
assert.match(page, /persistedRidge[\s\S]*persistedNonridge[\s\S]*persistedTransmittance/, 'built transfer buffers are checked against the authenticated persisted treatment');
assert.match(page, /builderOutputValidation[\s\S]*compositorOutputValidation/, 'builder and rendered output correctness are independently reported');
assert.match(page, /beginningOfPassWriteIndex[\s\S]*endOfPassWriteIndex[\s\S]*resolveQuerySet/, 'GPU timestamps span the measured command sequence');
assert.match(page, /firstWrites\s*&&\s*lastWrites[\s\S]*firstWrites\s*\|\|\s*lastWrites/, 'unmeasured sequences cannot counterfeit an empty timestampWrites descriptor');
assert.match(page, /runBuilder[\s\S]*runReducedComposition[\s\S]*cadence/, 'reduced schedules include one builder and the requested number of rendered frames');
assert.match(page, /runDenseComposition[\s\S]*cadence/, 'dense schedules execute the same requested number of rendered frames');
assert.match(page, /requestedCadences[\s\S]*effectiveCadences/, 'requested and effective cadences are both reported');
assert.match(page, /pairedWinFraction[\s\S]*pairedMedianRatio[\s\S]*pairedRatioP10[\s\S]*pairedRatioP90/, 'AB/BA cadence stability is reported instead of hidden behind unpaired medians');
assert.doesNotMatch(page, /requestedCadences\.(slice|splice)|Math\.min\([^\n]*cadence/i, 'page must not silently cap caller cadences');
assert.match(page, /Natural dense control[\s\S]*Persisted d12-t2 target[\s\S]*GPU-built d12-t2[\s\S]*Amplified residual/, 'visual witness anchors all four image roles');
assert.match(page, /optimizationClaimAllowed:\s*false/, 'page begins without optimization claim authority');

assert.match(witness, /kaminos\.view-conditioned-transfer-gpu-builder\.v0/, 'witness schema is explicit');
assert.match(witness, /--input-manifest[\s\S]*--treatment-report[\s\S]*--out-dir[\s\S]*--samples[\s\S]*--warmup[\s\S]*--cadences/, 'load-bearing assay inputs are caller supplied');
assert.match(witness, /parseCadences[\s\S]*split\(['"]\s*,\s*['"]\)[\s\S]*positive integer/, 'witness parses every requested cadence explicitly');
assert.doesNotMatch(witness, /cadences\.(slice|splice)|Math\.min\([^\n]*cadence/i, 'witness must not silently cap caller cadences');
assert.match(witness, /remote-debugging-port=0/, 'witness launches one isolated browser with an ephemeral CDP port');
assert.match(witness, /browserLaunchCount:\s*1/, 'witness receipts exactly one browser launch');
assert.match(witness, /timestampStatus[\s\S]*builderOutputValidation[\s\S]*compositorOutputValidation[\s\S]*optimizationClaimAllowed/, 'witness rejects missing timestamp or correctness authority');
assert.match(witness, /pageReport\.effectiveCadences[\s\S]*args\.cadences/, 'Node independently rejects silently changed cadences');
assert.match(witness, /pageReport\.effectiveSamples[\s\S]*args\.samples/, 'Node independently rejects silently changed sample counts');
assert.match(witness, /status:\s*'failed'[\s\S]*failurePhase/, 'witness writes durable failure state');
assert.match(witness, /rmAsync\(screenshotPath[\s\S]*writeJson\(reportPath/, 'stale visual output is removed before the running report is published');
assert.match(witness, /runCleanupActions[\s\S]*chrome-termination[\s\S]*server-termination[\s\S]*http-root-removal/, 'witness exhaustively cleans up one-browser resources');

console.log('view-conditioned transfer GPU builder contracts passed');
