import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.match(
  index,
  /id="crucible-bench-panel"/,
  'Generate tab must expose the Crucible Bench as the primary workspace shell, not only a SHARP route card',
);
assert.match(
  index,
  /data-crucible-bench="active"/,
  'Crucible Bench must carry a stable smoke selector for visual witnesses',
);
assert.match(
  index,
  /id="crucible-bench-name-input"/,
  'Crucible Bench must let the operator rename the current crucible without leaving the workspace',
);
assert.match(
  index,
  /id="crucible-bench-new-button"/,
  'Crucible Bench must let the operator enter a new unnamed crucible without a naming gate',
);
assert.match(
  index,
  /id="crucible-bench-switch-button"/,
  'Crucible Bench must expose an easy way out to the crucible switcher',
);
assert.match(
  index,
  /id="crucible-bench-switcher"/,
  'Crucible Bench must include a meta shelf for switching between remembered crucibles',
);

assert.match(
  index,
  /const CRUCIBLE_BENCH_PROXY_ZONES\s*=\s*\[/,
  'Crucible Bench must define proxy zones as data so proxy splats, geometry, and future assets share one bench contract',
);
for (const zone of [
  'source-plate',
  'armature-bay',
  'firing-station',
  'shard-tray',
  'cast-tray',
  'receipt-tag',
]) {
  assert.match(
    index,
    new RegExp(zone),
    `Crucible Bench must preserve the ${zone} proxy zone for smokeable workspace evidence`,
  );
}

assert.match(
  index,
  /function createDefaultCrucibleBenchState\(/,
  'Crucible Bench must have a default persistent state constructor',
);
assert.match(
  index,
  /kaminosCrucibleBenchState/,
  'Crucible Bench must persist local workspace state under an explicit storage key',
);
assert.match(
  index,
  /window\.__kaminosCrucibleBenchState/,
  'Crucible Bench must expose debug state for smokes to inspect crucible, firing, cast, and receipt truth',
);
assert.match(
  index,
  /function renderCrucibleBench\(/,
  'Crucible Bench must render from state instead of static placeholder markup',
);
assert.match(
  index,
  /function crucibleBenchRecordFiring\(/,
  'Live SHARP runs must enter the Crucible Bench as firings',
);
assert.match(
  index,
  /function crucibleBenchRecordCast\(/,
  'Successful SHARP outputs must enter the Crucible Bench as casts',
);
assert.match(
  index,
  /function crucibleBenchRecordReceipt\(/,
  'Failures and completions must leave a Crucible Bench receipt instead of disappearing into transient status text',
);
assert.match(
  index,
  /crucibleBenchRecordFiring\(\{\s*routeId:\s*route\.id,\s*profileId,\s*source/s,
  'Route execution must record the live source/profile as a crucible firing before the adapter runs',
);
assert.match(
  index,
  /crucibleBenchRecordCast\(\{\s*firingId:[^}]*run,[^}]*artifact,[^}]*record/s,
  'Loadable SHARP splats must be recorded as crucible casts with run artifact evidence',
);

assert.match(
  index,
  /This crucible is holding/,
  'Crucible Bench primary copy must explain the workspace in ordinary operator-facing language',
);
assert.match(
  index,
  /No armature pinned yet/,
  'Armature bay must read as workspace state, not a visible product-roadmap note',
);
assert.match(
  index,
  /Keep moving; unnamed crucibles stay here while you work/,
  'Unnamed crucibles must be tolerated without a modal naming gate',
);
assert.doesNotMatch(
  index,
  /Root Request|root request|Evidence Bundle|evidence bundle/,
  'Crucible Bench must not leak internal evidence ontology into primary operator copy',
);
