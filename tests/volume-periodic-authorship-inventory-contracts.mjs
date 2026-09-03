import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const TOP_LEVEL_PERIODIC_INVENTORY_SOURCE = /^volume.*\.(?:html|cjs|js|mjs|py|ts|tsx)$/;
const isPeriodicInventorySource = name => (
  TOP_LEVEL_PERIODIC_INVENTORY_SOURCE.test(name) || name === 'selective-head-live-runtime.mjs'
);
const sourceFiles = readdirSync(root)
  .filter(isPeriodicInventorySource)
  .sort();
const qualifiedTrigAuthority = /\b(?:Math|np|numpy|math)\s*\.\s*(?:sin|cos|tan)\b/g;
const unqualifiedTrigCall = /(?<![\w.])(?:sin|cos|tan)\s*\(/g;
const destructuredTrigAuthority = /\b(?:const|let|var)\s*\{[^}]*\b(?:sin|cos|tan)\b[^}]*\}\s*=\s*(?:Math|np)\b/g;
const bareTrigAliasAuthority = /\b(?:const|let|var)\s+[A-Za-z_]\w*\s*=\s*(?:sin|cos|tan)\s*;/g;
const pythonImportedTrigAuthority = /^\s*from\s+(?:numpy|math)\s+import\s+[^#\n]*\b(?:sin|cos|tan)\b/g;
const pythonBareTrigAliasAuthority = /^\s*[A-Za-z_]\w*\s*=\s*(?:sin|cos|tan)\s*(?:#.*)?$/g;

function explicitTrigAuthorities(line) {
  return [
    ...line.matchAll(qualifiedTrigAuthority),
    ...line.matchAll(unqualifiedTrigCall),
    ...line.matchAll(destructuredTrigAuthority),
    ...line.matchAll(bareTrigAliasAuthority),
    ...line.matchAll(pythonImportedTrigAuthority),
    ...line.matchAll(pythonBareTrigAliasAuthority),
  ].sort((left, right) => left.index - right.index);
}

const admitted = new Map([
  ['volume-core.js', [
    { class: 'operator-authored wind angle to direction', line: /windDirection = vec3<f32>\(cos\(windAngle\), 0\.0, sin\(windAngle\)\);/, calls: 2 },
  ]],
  ['selective-head-live-runtime.mjs', [
    { class: 'frozen-model static Fourier coordinate representation', line: /standardize\((?:sin|cos)\(phase\), featureIndex\)/, calls: 2 },
  ]],
  ['volume-exact-basin-support-probe.py', [
    { class: 'offline model-probe static Fourier coordinate representation', line: /fourier\.extend\(\[np\.sin\(phase\), np\.cos\(phase\)\]\)/, calls: 2 },
  ]],
  ['volume-residual-upscale-mlx.py', [
    { class: 'offline trainer static Fourier x/y coordinate representation', line: /np\.(?:sin|cos)\((?:xx|yy) \* frequency\)/, calls: 4 },
  ]],
  ['volume-stage-b-analytical-rebake.mjs', [
    { class: 'camera perspective projection geometry', line: /Math\.tan\((?:\(40 \* Math\.PI \/ 180\) \* 0\.5|20 \* Math\.PI \/ 180)\)/, calls: 2 },
  ]],
  ['volume-raymarch-filament-orbit-witness.mjs', [
    { class: 'diagnostic camera orbit geometry', line: /originalCamera\.target\[[02]\] \+ d[xyz] \* Math\.(?:cos|sin)\(angle\) [+-] d[xyz] \* Math\.(?:sin|cos)\(angle\)/, calls: 4 },
  ]],
  ['volume-intrinsic-presentation-witness.mjs', [
    { class: 'diagnostic camera holdout geometry', line: /cameraOriginalPose\.target\[[02]\] \+ d[xyz] \* Math\.(?:cos|sin)\(orbitAngle\) [+-] d[xyz] \* Math\.(?:sin|cos)\(orbitAngle\)/, calls: 4 },
  ]],
]);

function assertPeriodicAuthorshipInventory(entries) {
  const observedClasses = [];
  for (const [file, source] of entries) {
    const rules = admitted.get(file) || [];
    const ruleCounts = new Array(rules.length).fill(0);
    for (const [lineIndex, line] of source.split('\n').entries()) {
      assert.doesNotMatch(
        line,
        /\b(?:Math|np|numpy|math)\s*\[|\bgetattr\s*\(\s*(?:np|numpy|math|Math)\s*,/,
        `${file}:${lineIndex + 1} has unresolved computed math authority: ${line.trim()}`,
      );
      const calls = explicitTrigAuthorities(line);
      if (!calls.length) continue;
      const matchingRuleIndexes = rules
        .map((rule, index) => rule.line.test(line) ? index : -1)
        .filter(index => index >= 0);
      assert.equal(
        matchingRuleIndexes.length,
        1,
        `${file}:${lineIndex + 1} has unclassified or ambiguously classified explicit periodic math: ${line.trim()}`,
      );
      const ruleIndex = matchingRuleIndexes[0];
      ruleCounts[ruleIndex] += calls.length;
      observedClasses.push(rules[ruleIndex].class);
    }
    for (const [ruleIndex, rule] of rules.entries()) {
      assert.equal(
        ruleCounts[ruleIndex],
        rule.calls,
        `${file} must retain exactly ${rule.calls} admitted ${rule.class} call(s), observed ${ruleCounts[ruleIndex]}`,
      );
    }
  }

  assert.deepEqual(
    [...new Set(observedClasses)].sort(),
    [
      'camera perspective projection geometry',
      'diagnostic camera holdout geometry',
      'diagnostic camera orbit geometry',
      'frozen-model static Fourier coordinate representation',
      'offline model-probe static Fourier coordinate representation',
      'offline trainer static Fourier x/y coordinate representation',
      'operator-authored wind angle to direction',
    ].sort(),
    'the remaining explicit trig inventory must contain only named geometry or static learned-coordinate classes',
  );
}

const sourceEntries = sourceFiles.map(file => [file, readFileSync(join(root, file), 'utf8')]);
assertPeriodicAuthorshipInventory(sourceEntries);

const aliasedTrigEntries = sourceEntries.map(([file, source]) => [
  file,
  file === 'volume-core.js'
    ? source
      .replace('function updateUniforms(now) {', 'const periodicWindGain = Math.sin;\n\nfunction updateUniforms(now) {')
      .replace(
        'normalizeWindAngle(controlsSnapshot.windAngle) * Math.PI / 180;',
        'normalizeWindAngle(controlsSnapshot.windAngle) * Math.PI / 180 + periodicWindGain(now * 0.001);',
      )
    : source,
]);
assert.throws(
  () => assertPeriodicAuthorshipInventory(aliasedTrigEntries),
  /unclassified or ambiguously classified explicit periodic math/,
  'the inventory rejects a direct alias of Math.sin used to animate a simulation uniform',
);

for (const [name, declaration, expectedFailure] of [
  ['computed Math property', "const periodicWindGain = Math['sin'];", /unresolved computed math authority/],
  ['destructured Math alias', 'const { sin: periodicWindGain } = Math;', /unclassified or ambiguously classified explicit periodic math/],
]) {
  const entries = sourceEntries.map(([file, source]) => [
    file,
    file === 'volume-core.js'
      ? source
        .replace('function updateUniforms(now) {', `${declaration}\n\nfunction updateUniforms(now) {`)
        .replace(
          'normalizeWindAngle(controlsSnapshot.windAngle) * Math.PI / 180;',
          'normalizeWindAngle(controlsSnapshot.windAngle) * Math.PI / 180 + periodicWindGain(now * 0.001);',
        )
      : source,
  ]);
  assert.throws(
    () => assertPeriodicAuthorshipInventory(entries),
    expectedFailure,
    `the inventory rejects ${name} used to animate a simulation uniform`,
  );
}

const acceptedCrossLanguageFalseClosures = [];
for (const candidate of ['volume-restored-painter.ts', 'volume-restored-painter.tsx']) {
  if (!isPeriodicInventorySource(candidate)) {
    acceptedCrossLanguageFalseClosures.push(`${candidate} omitted from top-level inventory`);
  }
}
for (const [name, injectedPython] of [
  [
    'Python imported callable alias',
    'from numpy import sin as periodic_gain\nanimated_wind = periodic_gain(now * 0.001)',
  ],
  [
    'Python direct callable alias',
    'periodic_gain = np.sin\nanimated_wind = periodic_gain(now * 0.001)',
  ],
  [
    'Python unqualified callable alias',
    'from numpy import sin\nperiodic_gain = sin\nanimated_wind = periodic_gain(now * 0.001)',
  ],
  [
    'Python computed callable acquisition',
    'periodic_gain = getattr(np, "sin")\nanimated_wind = periodic_gain(now * 0.001)',
  ],
]) {
  const entries = sourceEntries.map(([file, source]) => [
    file,
    file === 'volume-exact-basin-support-probe.py' ? `${source}\n${injectedPython}\n` : source,
  ]);
  try {
    assertPeriodicAuthorshipInventory(entries);
    acceptedCrossLanguageFalseClosures.push(name);
  } catch {
    // The cross-language callable-authority boundary must reject the mutation.
  }
}
assert.deepEqual(
  acceptedCrossLanguageFalseClosures,
  [],
  'the periodic-authorship inventory must own TypeScript entries and Python trig callable aliases',
);

console.log('volume periodic authorship inventory contracts passed');
