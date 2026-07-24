import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(
  new URL('../lirm-stationary-hill-contact-inspector.html', import.meta.url),
  'utf8',
);

for (const contract of [
  'evaluatePublishedStationaryContactPhase',
  'STATIONARY_HILL_PUBLISHED_CONTACT_ROUTE',
  'STATIONARY_CONTACT_RECEIPT_SHA256',
  'STATIONARY_CONTACT_CONSTRAINTS_SHA256',
  'verifyPublishedStationaryContactArtifacts',
  'loadExactJson',
  'REGISTRATION_SHA256',
  'CONTACT_ATLAS_SHA256',
  'PHASE_REPORT_SHA256',
  'HANDSHAKE_SHA256',
  'AXIAL_REGISTRATION_SHA256',
  'HILL_PACKET_SHA256',
  'HILL_DATA_SHA256',
  'createHillSampledSupportSurface',
  'motion-affordance-data.json',
  'motion-affordance-packet.json',
  '__LIRM_HILL_CONTACT_STATE__',
  '__setLirmHillContactPhase',
  '__setLirmHillContactView',
  '__LIRM_HILL_CONTACT_EVENT_PHASE__',
  '__lirmHillContactScreenProbe',
  'Play',
  'Contact field',
  'smooth station field',
]) {
  assert.match(source, new RegExp(contract), `stationary Hill inspector is missing ${contract}`);
}
assert.doesNotMatch(source, /filmstrip|contact sheet|sparse witness/i);
for (const url of [
  'REGISTRATION_URL',
  'CONTACT_ATLAS_URL',
  'PHASE_REPORT_URL',
  'HANDSHAKE_URL',
  'AXIAL_REGISTRATION_URL',
  'HILL_PACKET_URL',
  'HILL_DATA_URL',
]) {
  assert.match(
    source,
    new RegExp(`loadExactJson\\(${url},`),
    `${url} must be loaded through exact byte verification`,
  );
}

process.stdout.write('lirm stationary Hill contact inspector contracts passed\n');
