import assert from 'node:assert/strict';
import fs from 'node:fs';

const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

for (const [objectId, label] of [
  ['stone-receiver', 'View receiver'],
  ['specimen-tray', 'View tray'],
  ['titan-hammer', 'View Titan Hammer'],
]) {
  assert.match(
    index,
    new RegExp(`data-crucible-bench-object-id="${objectId}"[^>]*>${label}<`),
    `${label} must remain a direct promoted-bench command`,
  );
}

assert.match(
  index,
  /function focusKaminosCrucibleCompositionObject\(objectId\)[\s\S]*?new THREE\.Box3\(\)\.setFromObject\(record\.object\)[\s\S]*?controls\.target\.copy\(center\)/,
  'Promoted-bench commands must select and frame the real registered object',
);
assert.match(
  index,
  /loadKaminosCrucibleComposition\(CRUCIBLE_PROMOTED_BENCH_ID, \{ activateTab: false \}\)/,
  'Staging from Crucible must preserve the operational Generate surface',
);
assert.match(
  index,
  /data-crucible-console-state="tucked"\] \.crucible-worktable-stage \{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/,
  'The tucked caddy must replace the full-bench grid with one explicit vertical flow',
);
assert.match(
  index,
  /data-crucible-console-state="tucked"\] \.crucible-viewport-heading \{[^}]*flex-direction:\s*column;[^}]*align-items:\s*stretch;/,
  'The tucked heading must reserve full width for the object tool rail',
);
assert.match(index, /workspace\.dataset\.crucibleHasCast\s*=\s*String\(Boolean\(lastCast\)\)/);
assert.match(index, /workspace\.dataset\.crucibleHasShards\s*=\s*String\(crucible\.shards\.length > 0\)/);
assert.match(
  index,
  /data-crucible-composition-status="loaded"\]\[data-crucible-console-state="tucked"\]\[data-crucible-has-cast="false"\][\s\S]*?\.crucible-viewport-cast-tray[\s\S]*?display:\s*none;/,
  'An empty cast tray must not consume operational caddy height',
);
assert.match(
  index,
  /data-crucible-composition-status="loaded"\]\[data-crucible-console-state="tucked"\]\[data-crucible-has-shards="false"\][\s\S]*?\.crucible-viewport-shard-rack[\s\S]*?display:\s*none;/,
  'An empty shard rack must not consume operational caddy height',
);
assert.match(
  index,
  /params\.get\('crucible_workspace'\)\s*===\s*'operational'/,
  'The landing capsule must have a direct operational Crucible route',
);
assert.match(
  index,
  /loadKaminosCrucibleComposition\(compositionId, \{ activateTab: !openOperationalCrucible \}\)[\s\S]*?if \(openOperationalCrucible\) setActiveTab\('generate'\)/,
  'The direct route must load the composition before revealing the operational Generate surface',
);

console.log('crucible operational composition contracts: ok');
