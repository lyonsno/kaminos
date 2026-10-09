import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogEntry, entryMatchesFilter, entryMeta, sortEntries } from '../scene-load-picker.mjs';

const group = (extra) => ({ identity: 'i', label: '', timestamp: '', image: null, local: [], foreign: [], copies: 0, ...extra });

test('a catalog group opens from its copy here and names other servers only as mesh sources', () => {
  const entry = catalogEntry(group({ identity: 'k', label: 'Kiln', local: ['kiln.kaminos.json', 'kiln_copy.kaminos.json'],
    foreign: [{ store: 's1', storeLabel: 'beaming', name: 'k.kaminos.json' }], copies: 2, image: { store: '', name: 'kiln.kaminos.json' } }));
  assert.equal(entry.name, 'kiln.kaminos.json');
  assert.equal(entry.here, true);
  assert.equal(entry.image, '/api/scene-image?store=&name=kiln.kaminos.json');
  assert.match(entryMeta(entry), /^meshes from beaming · \+2 identical copies · kiln$/);
});

test('a scene only on another server opens from there', () => {
  const entry = catalogEntry(group({ identity: 't', label: 'Tuned', foreign: [{ store: 's1', storeLabel: 'beaming', name: 'tuned.kaminos.json' }] }));
  assert.equal(entry.here, false);
  assert.equal(entry.name, 'tuned.kaminos.json');
  assert.match(entryMeta(entry), /^from beaming · tuned$/);
  assert.equal(entryMatchesFilter(entry, 'beaming tuned'), true);
  assert.equal(entryMatchesFilter(entry, 'kiln'), false);
});

test('scenes with a copy here list first, then newest first', () => {
  const entries = sortEntries([
    catalogEntry(group({ identity: 'a', timestamp: '2026-10-08T12:00:00Z', foreign: [{ store: 's', storeLabel: 'x', name: 'a.kaminos.json' }] })),
    catalogEntry(group({ identity: 'b', timestamp: '2026-10-01T00:00:00Z', local: ['b.kaminos.json'] })),
    catalogEntry(group({ identity: 'c', timestamp: '2026-10-07T00:00:00Z', local: ['c.kaminos.json'] })),
  ]);
  assert.deepEqual(entries.map(entry => entry.group.identity), ['c', 'b', 'a']);
});
