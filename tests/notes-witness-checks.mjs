// kaminos-test: node
// The witness counts follow-ups as delivered by the note ids actually handed
// to the agent and receipted in the log, not by text that appears somewhere in
// a printed thread (review F5).
import test from 'node:test';
import assert from 'node:assert/strict';
import {followUpsDelivered} from '../notes-witness-checks.mjs';
import {NOTES_SCHEMA, describeNote, foldNotes} from '../notes-core.mjs';

const AGENT = 'notes-witness-agent';
const ROOT = 'kn-000000000000', ANSWER = 'kn-0000000000aa', FIRST = 'kn-111111111111', SECOND = 'kn-222222222222';
const note = (seq, id, fields) => ({schema: NOTES_SCHEMA, seq, type: 'note', kind: 'note', id, at: '2026-10-14T20:00:00.000Z',
  via: 'page', subject: {scene: null}, anchor: null, to: [], thread: ROOT, ...fields});
const thread = ({secondRecipients}) => [
  note(1, ROOT, {author: 'noah', text: 'why?', to: [AGENT], recipients: [AGENT], parent: null, anchor: {kind: 'scene'}}),
  note(2, ANSWER, {author: AGENT, via: 'cli', text: 'the light', recipients: ['noah'], parent: ROOT}),
  note(3, FIRST, {author: 'noah', text: 'which light did you mean?', recipients: [AGENT], parent: ANSWER}),
  note(4, SECOND, {author: 'noah', text: 'the rim one, I mean', recipients: secondRecipients, parent: FIRST}),
];
const delivered = (seq, ids) => ({schema: NOTES_SCHEMA, seq, type: 'delivered', notes: ids, recipient: AGENT, route: 'wait',
  author: AGENT, via: 'cli', at: '2026-10-14T20:00:05.000Z'});

test('both follow-ups count only when both ids were handed over and receipted', () => {
  const events = [...thread({secondRecipients: [AGENT]}), delivered(5, [FIRST, SECOND])];
  const result = followUpsDelivered({waitResult: {notes: [{id: FIRST}, {id: SECOND}]}, events, agent: AGENT, ids: [FIRST, SECOND]});
  assert.equal(result.ok, true);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.unreceipted, []);
});

test('a second follow-up that is printed in the thread but was never handed over fails the check', () => {
  // The failure the original witness assertion could not see: the clarification
  // had no recipient, so only the first follow-up was claimed.
  const events = [...thread({secondRecipients: []}), delivered(5, [FIRST])];
  const printed = describeNote(foldNotes(events), FIRST, {root: '/tmp/notes'});
  assert.ok(printed.includes('which light did you mean?') && printed.includes('the rim one, I mean'),
    'both texts appear in what the agent was shown');
  const result = followUpsDelivered({waitResult: {notes: [{id: FIRST}]}, events, agent: AGENT, ids: [FIRST, SECOND]});
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, [SECOND]);
});

test('a note returned by wait without its delivery receipt in the log does not count', () => {
  const events = [...thread({secondRecipients: [AGENT]}), delivered(5, [FIRST])];
  const result = followUpsDelivered({waitResult: {notes: [{id: FIRST}, {id: SECOND}]}, events, agent: AGENT, ids: [FIRST, SECOND]});
  assert.equal(result.ok, false);
  assert.deepEqual(result.unreceipted, [SECOND]);
});

test('a receipt for someone else does not count for this agent', () => {
  const events = [...thread({secondRecipients: [AGENT]}), {...delivered(5, [FIRST, SECOND]), recipient: 'other-agent'}];
  const result = followUpsDelivered({waitResult: {notes: [{id: FIRST}, {id: SECOND}]}, events, agent: AGENT, ids: [FIRST, SECOND]});
  assert.equal(result.ok, false);
  assert.deepEqual(result.unreceipted, [FIRST, SECOND]);
});
