import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const corePath = join(root, 'forge-host-core.js');
const witnessPath = join(root, 'forge-host-witness.mjs');
const index = readFileSync(join(root, 'index.html'), 'utf8');

assert.ok(existsSync(corePath), 'forge-host-core.js must define the inhabited-agent forge host data contract');
assert.ok(existsSync(witnessPath), 'forge-host-witness.mjs must expose fixture-shaped inhabited agents with route/source identity');

const core = await import(corePath);
const witness = readFileSync(witnessPath, 'utf8');

assert.equal(core.FORGE_HOST_ACTOR_SCHEMA, 'kaminos.forge-host.actors.v0', 'forge-host actor contract has a stable schema id');
assert.equal(core.FORGE_HOST_FIXTURE_SOURCE_ID, 'fixture:kaminos-inhabited-agent-forge-2026-06-23/minion-spawnfucker-v0', 'forge-host fixture has a stable source id');
assert.match(index, /from '\.\/forge-host-core\.js'/, 'workbench imports the forge-host data contract');
assert.match(index, /forge_host_fixture/, 'URL route can seed the forge-host fixture actor set');
assert.match(index, /window\.kaminosForgeHostDebugState/, 'browser witnesses can inspect forge-host actor state without DOM inference');
assert.match(index, /fixture:kaminos-inhabited-agent-forge-2026-06-23\/minion-spawnfucker-v0/, 'workbench preserves forge-host fixture identity');

const registry = core.createForgeHostFixtureRegistry();

assert.equal(registry.schema, core.FORGE_HOST_ACTOR_SCHEMA, 'fixture registry carries the actor schema');
assert.equal(registry.source.kind, 'fixture', 'default forge-host source is explicitly fixture data');
assert.equal(registry.source.id, core.FORGE_HOST_FIXTURE_SOURCE_ID, 'fixture registry carries stable source identity');
assert.equal(registry.source.claimedLive, false, 'fixture registry must not claim live Epistaxis data');
assert.equal(registry.source.fallback, false, 'fixture registry must not be a silent demo fallback');
assert.equal(registry.truthLevel, 'peripheral-hud-not-ground-truth', 'forge-host actor registry names its visual truth boundary');
assert.ok(registry.provenance.refs.includes('metadosis/kaminos-inhabited-agent-forge-lane-allocation_2026-06-23.md'), 'registry points at the lane allocation source');

const actors = registry.actors;
assert.ok(actors.length >= 5, 'fixture includes enough actors to exercise promoted/current/recent filtering');
assert.ok(actors.some(actor => actor.diaulosId === 'minion-spawnfucker' && actor.sets.includes('promoted') && actor.sets.includes('current')), 'fixture promotes Minion Spawnfucker as a current forge-host actor');
assert.ok(actors.some(actor => actor.diaulosId === 'mushfinger-clayfucker' && actor.sets.includes('current')), 'fixture includes Mushfinger as current worldbody dynamics actor');
assert.ok(actors.some(actor => actor.diaulosId === 'pipeline-gutfucker' && actor.sets.includes('promoted')), 'fixture includes Pipeline Gutfucker as promoted pipeline actor');
assert.ok(actors.some(actor => actor.sets.includes('recent')), 'fixture includes recent actors without promoting every diaulos');
assert.ok(registry.filteredDiauloi.some(entry => entry.reason === 'not-promoted-current-or-recent'), 'fixture records filtered diauloi instead of rendering every historical lane');

for (const actor of actors) {
  assert.match(actor.actorId, /^forge-actor:/, 'actor ids are stable forge actor ids');
  assert.ok(actor.diaulosId, 'actor carries diaulos identity');
  assert.ok(actor.callSign, 'actor carries a human-facing call sign');
  assert.ok(['idle', 'listening', 'working', 'awaiting-input', 'reporting', 'blocked', 'complete', 'stale', 're-inhabited'].includes(actor.status.state), 'actor status uses forge-host state vocabulary');
  assert.match(actor.status.color, /^#[0-9a-f]{6}$/i, 'actor status carries a concrete status color');
  assert.ok(Array.isArray(actor.spatial.position) && actor.spatial.position.length === 3, 'actor has a 3D spatial anchor');
  assert.ok(actor.station.id && actor.station.custodyScope, 'actor has a station and custody scope');
  assert.equal(actor.selection.selectable, true, 'actor selection affordance is explicit');
  assert.equal(actor.selection.bridge.kind, 'chat-terminal-placeholder', 'actor exposes the future chat/terminal bridge placeholder');
  assert.equal(actor.selection.bridge.implemented, false, 'bridge placeholder must not impersonate a live chat bridge');
  assert.ok(actor.provenance.sourceActorRecord, 'actor preserves fixture/source provenance');
}

const summary = core.buildForgeHostWitnessSummary(registry, { claimedSourceKind: 'fixture' });
assert.equal(summary.ok, true, 'fixture witness summary succeeds when claimed as fixture');
assert.equal(summary.source.id, core.FORGE_HOST_FIXTURE_SOURCE_ID, 'witness summary records source identity');
assert.equal(summary.counts.promoted >= 3, true, 'witness summary reports promoted actor count');
assert.equal(summary.defaultSelection.actorId, 'forge-actor:minion-spawnfucker', 'default selection targets the forge-host owner');

assert.throws(
  () => core.buildForgeHostWitnessSummary(registry, { claimedSourceKind: 'live' }),
  /claimed live data but effective source is fixture/,
  'fixture data fails loud when a witness claims live source truth',
);

const fallbackRegistry = core.createForgeHostFixtureRegistry({
  sourceKind: 'demo-fallback',
  sourceId: 'demo:fallback/unowned-forge-actors',
  fallback: true,
});
assert.throws(
  () => core.buildForgeHostWitnessSummary(fallbackRegistry, { claimedSourceKind: 'seeded' }),
  /demo fallback data cannot satisfy a seeded or live forge-host witness/,
  'demo fallback data must not satisfy seeded/live witness claims',
);

assert.match(witness, /--claim-source-kind/, 'witness accepts an explicit source claim instead of inferring authority');
assert.match(witness, /claimed live data but effective source is fixture/, 'witness preserves the fixture-vs-live false-claim failure');
assert.match(witness, /demo fallback data cannot satisfy a seeded or live forge-host witness/, 'witness rejects demo fallback masquerading as seeded/live data');
assert.match(witness, /sourceIdentity/, 'witness report records source identity');
assert.match(witness, /registry\?\.source\?\.id/, 'witness failure reports preserve the effective source identity');
assert.match(witness, /actorBuckets/, 'witness report records promoted/current/recent/filtered buckets');
assert.match(witness, /selectedActor/, 'witness report records default selected actor metadata');
assert.match(witness, /writeFileSync\(reportPath/, 'witness writes a durable JSON report');
