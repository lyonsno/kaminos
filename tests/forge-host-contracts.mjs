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
assert.equal(core.FORGE_HOST_LAYOUT_SCHEMA, 'kaminos.forge-host.layout.v0', 'forge-host layout contract has a stable schema id');
assert.equal(core.FORGE_HOST_FIXTURE_SOURCE_ID, 'fixture:kaminos-inhabited-agent-forge-2026-06-23/minion-spawnfucker-v0', 'forge-host fixture has a stable source id');
assert.match(index, /from '\.\/forge-host-core\.js'/, 'workbench imports the forge-host data contract');
assert.match(index, /forge_host_fixture/, 'URL route can seed the forge-host fixture actor set');
assert.match(index, /forge_host_registry_url/, 'URL route can ingest an explicit live Diaulos registry URL');
assert.match(index, /forge_host_layout_url/, 'URL route can ingest an explicit persisted Forge Host layout document');
assert.match(index, /id="forge-host-label-layer"/, 'viewport contains a Forge Host label layer for actor call signs');
assert.match(index, /id="forge-host-inspector"/, 'viewport contains a Forge Host inspector surface for selected actor metadata');
assert.match(index, /window\.kaminosForgeHostDebugState/, 'browser witnesses can inspect forge-host actor state without DOM inference');
assert.match(index, /window\.kaminosSelectForgeActor/, 'browser witnesses can select Forge Host actors without DOM inference');
assert.match(index, /fixture:kaminos-inhabited-agent-forge-2026-06-23\/minion-spawnfucker-v0/, 'workbench preserves forge-host fixture identity');
assert.match(index, /function spawnForgeHostActors\(/, 'forge-host route spawns visible actor world bodies');
assert.match(index, /function applyForgeHostLayout\(/, 'forge-host route applies static station-anchor layout before spawning actors');
assert.match(index, /function pickForgeHostActorFromViewportPointer\(/, 'viewport selection can hit Forge Host actors separately from authored scene objects');
assert.match(index, /new THREE\.SphereGeometry\(0\.16, 32, 16\)/, 'first visible actor body uses cheap stable sphere geometry');
assert.match(index, /forgeHostActorGroup/, 'forge-host actors live in a separate scene group, not the authored scene object registry');
assert.match(index, /kaminosForgeHostActor/, 'forge-host actor meshes preserve actor metadata on userData');
assert.match(index, /visibleActorCount/, 'forge-host debug state records visible actor count');
assert.match(index, /layoutAuthority/, 'forge-host debug state records static layout authority');
assert.match(index, /layoutSourceIdentity/, 'forge-host debug state records effective layout source identity');
assert.match(index, /authoredSceneObjectCount:\s*sceneObjects\.length/, 'forge-host debug state proves actor bodies are not authored scene objects');
assert.match(index, /data-forge-host-actor-label/, 'actor labels carry stable actor ids for browser witnesses');
assert.match(index, /Forge Host actor selected/, 'selecting an actor reports a visible status without claiming chat bridge implementation');

const registry = core.createForgeHostFixtureRegistry();
const layout = core.createForgeHostStaticLayoutFromRegistry(registry, {
  sourceKind: 'persisted-fixture',
  sourceId: 'fixtures/forge-host-static-layout.v0.json',
});

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
assert.equal(layout.schema, core.FORGE_HOST_LAYOUT_SCHEMA, 'static layout carries the layout schema');
assert.equal(layout.authority.kind, 'static-host-owned-station-anchors', 'static layout names host-owned station-anchor authority');
assert.equal(layout.authority.dynamicsAuthority, false, 'static layout does not claim Mushfinger dynamics authority');
assert.equal(layout.authority.motionAuthority, false, 'static layout does not claim motion grammar authority');
assert.equal(layout.source.kind, 'persisted-fixture', 'layout preserves explicit persisted source kind');
assert.equal(layout.source.id, 'fixtures/forge-host-static-layout.v0.json', 'layout preserves explicit persisted source identity');
assert.equal(layout.anchors.length, registry.actors.length, 'layout has one static anchor per actor');
assert.ok(layout.anchors.every(anchor => anchor.authority === 'static-host-owned-station-anchor'), 'every anchor names static host-owned authority');
assert.ok(layout.anchors.every(anchor => anchor.dynamic === false), 'every anchor rejects dynamic-anchor authority');
assert.ok(layout.anchors.every(anchor => anchor.motionState === null), 'layout anchors do not smuggle motion state');
assert.ok(layout.anchors.some(anchor => anchor.actorId === 'forge-actor:mushfinger-clayfucker' && anchor.stationId === 'worldbody-dynamics'), 'layout preserves Mushfinger station identity without taking motion custody');
const layoutSummary = core.buildForgeHostLayoutWitnessSummary(layout, { claimedAuthority: 'static-host-owned-station-anchors' });
assert.equal(layoutSummary.ok, true, 'layout witness summary accepts static host-owned anchors');
assert.equal(layoutSummary.anchorCount, registry.actors.length, 'layout witness summary records anchor count');
assert.equal(layoutSummary.motionAuthority, false, 'layout witness summary records lack of motion authority');
const roundTrippedLayout = core.validateForgeHostStaticLayout(JSON.parse(JSON.stringify(layout)), { claimedAuthority: 'static-host-owned-station-anchors' });
assert.deepEqual(roundTrippedLayout.anchors.map(anchor => anchor.position), layout.anchors.map(anchor => anchor.position), 'static layout round-trips anchor positions without loss');
assert.throws(
  () => core.validateForgeHostStaticLayout({
    ...layout,
    authority: { ...layout.authority, dynamicsAuthority: true },
  }, { claimedAuthority: 'static-host-owned-station-anchors' }),
  /Forge Host static layout cannot claim dynamics authority/,
  'layout validation fails loud if a document claims Mushfinger dynamics authority',
);
assert.throws(
  () => core.validateForgeHostStaticLayout({
    ...layout,
    source: { ...layout.source, kind: 'route-local-default', persisted: false },
  }, { claimedAuthority: 'persisted-static-layout' }),
  /route-local default layout cannot satisfy a persisted layout claim/,
  'route-local default layouts cannot masquerade as persisted layout data',
);

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
  assert.equal(actor.body.lodPlan.primary.kind, 'sphere-placeholder', 'actor body plan starts with a cheap sphere placeholder');
  assert.equal(actor.body.lodPlan.heroSplat.source, '/api/read?root=splat-inbox&path=evil_orb_final_composite.ply', 'actor body plan preserves the current hero orb splat source');
  assert.equal(actor.body.lodPlan.procedural.owner, 'lamellar-edgefucker', 'actor body plan leaves procedural lamellar grammar with Lamellar');
}

const sampleDiaulosRegistry = {
  diauloi: [
    {
      handle: 'mushfinger-clayfucker',
      id: 'dia-mushfinger-fixture',
      aliases: [],
      source_topoi: ['projects/kaminos/topoi/codex-mushfinger-clayfucker-0615.md'],
      status: 'active',
      updated_at: '2026-06-15T18:31:51Z',
    },
    {
      handle: 'pipeline-gutfucker',
      id: 'dia-pipeline-fixture',
      aliases: [],
      source_topoi: ['projects/kaminos/topoi/codex-pipeline-gutfucker-0623.md'],
      status: 'active',
      updated_at: '2026-06-23T06:48:04Z',
    },
    {
      handle: 'unrelated-registry-lane',
      id: 'dia-unrelated-fixture',
      aliases: [],
      source_topoi: ['projects/elsewhere/topoi/unrelated.md'],
      status: 'active',
      updated_at: '2026-06-01T00:00:00Z',
    },
  ],
};
const liveRegistry = core.createForgeHostRegistryFromDiaulosRegistry(sampleDiaulosRegistry, {
  sourceKind: 'live',
  sourceId: 'file:///tmp/diauloi.json',
});
assert.equal(liveRegistry.source.kind, 'live', 'registry ingestion preserves live source kind');
assert.equal(liveRegistry.source.registryAuthority, 'identity-binding-not-runtime-presence', 'registry ingestion does not impersonate runtime/currentness truth');
assert.equal(liveRegistry.actors.length, 2, 'live registry ingestion filters to Kaminos/requested actors instead of rendering the whole registry');
assert.ok(liveRegistry.actors.every(actor => actor.provenance.sourceActorRecord.registryId), 'live registry actors preserve Diaulos registry ids');
assert.ok(liveRegistry.actors.some(actor => actor.diaulosId === 'mushfinger-clayfucker' && actor.registryId === 'dia-mushfinger-fixture'), 'Mushfinger registry id is attached to the actor');
assert.ok(liveRegistry.actors.some(actor => actor.diaulosId === 'pipeline-gutfucker' && actor.sets.includes('promoted')), 'Pipeline registry row receives the promoted actor set');
assert.ok(liveRegistry.filteredDiauloi.some(entry => entry.diaulosId === 'unrelated-registry-lane' && entry.reason === 'outside-forge-focus-filter'), 'unrelated registry rows are recorded as filtered');
assert.ok(liveRegistry.missingRequestedDiauloi.some(entry => entry.diaulosId === 'minion-spawnfucker' && entry.reason === 'missing-from-diaulos-registry'), 'missing promoted/current rows stay visible instead of being fabricated as live');
const liveSummary = core.buildForgeHostWitnessSummary(liveRegistry, { claimedSourceKind: 'live' });
assert.equal(liveSummary.ok, true, 'live registry witness succeeds when claimed as live');
assert.equal(liveSummary.counts.registryBacked, 2, 'live summary reports registry-backed actor count');
assert.equal(liveSummary.missingRequestedDiauloi.length, 4, 'live summary preserves missing requested actor rows');

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
assert.match(witness, /--registry-json/, 'witness can ingest a Diaulos registry JSON file');
assert.match(witness, /--layout-json/, 'witness can ingest a persisted Forge Host layout JSON file');
assert.match(witness, /readFileSync\(registryJsonPath/, 'witness reads a registry JSON file directly instead of asking the human to paste it');
assert.match(witness, /readFileSync\(layoutJsonPath/, 'witness reads a layout JSON file directly instead of asking the human to paste it');
assert.match(witness, /claimed live data but effective source is fixture/, 'witness preserves the fixture-vs-live false-claim failure');
assert.match(witness, /Forge Host static layout cannot claim dynamics authority/, 'witness preserves static-layout false-authority failures');
assert.match(witness, /demo fallback data cannot satisfy a seeded or live forge-host witness/, 'witness rejects demo fallback masquerading as seeded/live data');
assert.match(witness, /sourceIdentity/, 'witness report records source identity');
assert.match(witness, /layoutSourceIdentity/, 'witness report records static layout source identity');
assert.match(witness, /registry\?\.source\?\.id/, 'witness failure reports preserve the effective source identity');
assert.match(witness, /actorBuckets/, 'witness report records promoted/current/recent/filtered buckets');
assert.match(witness, /selectedActor/, 'witness report records default selected actor metadata');
assert.match(witness, /writeFileSync\(reportPath/, 'witness writes a durable JSON report');
