import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const witness = readFileSync(new URL('../pipeline-ui-witness.mjs', import.meta.url), 'utf8');

assert.match(index, /id="specimen-packet-cockpit-panel"/, 'Tray must expose a visible specimen packet cockpit panel');
assert.match(index, /kaminos\.kiln\.specimen-packet-cockpit\.v0/, 'Browser cockpit must preserve packet schema identity');
assert.match(index, /function buildBrowserSpecimenPacketCockpit/, 'Browser must aggregate existing specimen/checkpoint/request/tray state into one packet');
assert.match(index, /function tagBrowserSpecimenPacketFailure/, 'Browser must support failure tags on the current specimen packet');
assert.match(index, /function buildBrowserNextSpecimenPacketRouteRequest/, 'Browser must build a next request from packet failure law');
assert.match(index, /negativeLawPatch/, 'Packet cockpit must expose next-pass negative law patch');
assert.match(index, /one specimen gets smarter after a bad route pass/, 'Packet cockpit must carry the durable North Star');
assert.match(index, /data-specimen-packet-cockpit/, 'Packet cockpit DOM must be directly witnessable');
assert.match(index, /data-specimen-failure-tag="added_face"/, 'Packet cockpit must expose an added-face failure tag action');
assert.match(index, /window\.kaminosLoadFixtureSpecimenPacketCockpit/, 'Browser witness must be able to load the fixture packet cockpit');
assert.match(index, /window\.kaminosSpecimenPacketCockpitWitness/, 'Browser witness must expose packet cockpit evidence');

assert.match(witness, /scenario === 'specimen-packet-cockpit'/, 'Pipeline UI witness must include a specimen-packet-cockpit scenario');
assert.match(witness, /kaminosLoadFixtureSpecimenPacketCockpit/, 'Witness must load the packet through the browser API');
assert.match(witness, /kaminosSpecimenPacketCockpitWitness/, 'Witness must inspect packet cockpit source truth');
assert.match(witness, /nextRequestCarriesFailureLaw/, 'Witness must prove failure tags strengthen the next request');
assert.match(witness, /data-specimen-packet-cockpit/, 'Witness must inspect the visible packet cockpit DOM');
