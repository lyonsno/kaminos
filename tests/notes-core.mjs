// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {NOTES_SCHEMA, normalizeName, parseAddressees, checkedAnchor, checkedPost, foldNotes, notesFor,
  parseRef, formatRef, noteLink, describeNote, mentionQueryAt, rankParticipants, completeMention, addresseesIn} from '../notes-core.mjs';

const at = seq => `2026-10-14T18:${String(seq).padStart(2, '0')}:00.000Z`;
const ev = (seq, fields) => ({schema: NOTES_SCHEMA, seq, at: at(seq), ...fields});
const ROOT_ID = 'kn-aaaaaaaaaaaa', REPLY_ID = 'kn-bbbbbbbbbbbb';
const source = {origin: 'http://127.0.0.1:8325', branch: 'cc/notes', commit: 'abc1234def5678abc1234def5678abc1234def56', dirty: true};
const conversation = () => [
  ev(1, {type: 'note', kind: 'note', id: ROOT_ID, thread: ROOT_ID, parent: null, author: 'noah', via: 'page', pageId: 'page-aaaaaaaa',
    text: 'why does the plume lean here?', to: ['sub-pilot'], recipients: ['sub-pilot'],
    anchor: {kind: 'object', id: 'flame-source', label: 'Flame source'},
    subject: {scene: 'kiln.kaminos.json', source},
    context: {view: {position: [0, 1, 3], target: [0, 1, 0], up: [0, 1, 0], fov: 45, near: 0.1, far: 100}, selection: {ids: ['flame-source'], activeId: 'flame-source'}},
    picture: {file: `pictures/${ROOT_ID}.png`, width: 1600, height: 1000, bytes: 1234, sha256: 'f'.repeat(64)}}),
  ev(2, {type: 'delivered', notes: [ROOT_ID], recipient: 'sub-pilot', route: 'wait', author: 'sub-pilot', via: 'cli'}),
  ev(3, {type: 'note', kind: 'note', id: REPLY_ID, thread: ROOT_ID, parent: ROOT_ID, author: 'sub-pilot', via: 'cli',
    text: 'the draft from the open side', to: [], recipients: ['noah'], anchor: null, subject: {scene: 'kiln.kaminos.json', source}}),
  ev(4, {type: 'seen', notes: [REPLY_ID], author: 'noah', via: 'page'}),
  ev(5, {type: 'resolved', notes: [ROOT_ID], author: 'noah', via: 'page'}),
];

test('names are lowercase handles: @ and case normalize, anything else is refused', () => {
  assert.equal(normalizeName('@Sub-Pilot'), 'sub-pilot');
  assert.equal(normalizeName('notes-agent'), 'notes-agent');
  assert.throws(() => normalizeName('rm -rf'), /name/i);
  assert.throws(() => normalizeName(''), /name/i);
  assert.deepEqual(parseAddressees('@sub-pilot, water-agent @Sub-Pilot'), ['sub-pilot', 'water-agent']);
  assert.deepEqual(parseAddressees(['noah', '@noah']), ['noah']);
  assert.deepEqual(parseAddressees(''), []);
});

test('an anchor is the scene or one scene object by id', () => {
  assert.deepEqual(checkedAnchor({kind: 'scene'}), {kind: 'scene'});
  assert.deepEqual(checkedAnchor({kind: 'object', id: 'flame-source', label: 'Flame source', stray: 1}),
    {kind: 'object', id: 'flame-source', label: 'Flame source'});
  assert.deepEqual(checkedAnchor({kind: 'object', id: 'cube'}), {kind: 'object', id: 'cube', label: 'cube'});
  assert.throws(() => checkedAnchor({kind: 'object'}), /object id/i);
  assert.throws(() => checkedAnchor({kind: 'planet'}), /anchor/i);
});

test('a post needs words or a picture, names a valid parent, and cannot claim its own provenance', () => {
  const post = checkedPost({kind: 'note', text: '  why does it lean? ', to: '@sub-pilot', anchor: {kind: 'object', id: 'a', label: 'A'}});
  assert.equal(post.text, 'why does it lean?');
  assert.deepEqual(post.to, ['sub-pilot']);
  assert.equal(post.parent, null);
  assert.equal(post.urgent, false);
  assert.throws(() => checkedPost({kind: 'note', text: '   ', anchor: {kind: 'scene'}}), /words or a picture/i);
  const pictured = checkedPost({kind: 'note', text: '', anchor: {kind: 'scene'}, picture: {dataUrl: 'data:image/png;base64,AAAA'}});
  assert.equal(pictured.picture.dataUrl, 'data:image/png;base64,AAAA');
  const reply = checkedPost({kind: 'note', text: 'leans from the draft', parent: ROOT_ID});
  assert.equal(reply.parent, ROOT_ID);
  assert.equal(reply.anchor, null, 'a reply inherits its thread anchor');
  assert.throws(() => checkedPost({kind: 'note', text: 'x', parent: 'not-an-id'}), /note id/i);
  assert.throws(() => checkedPost({kind: 'note', text: 'x'}), /anchor/i, 'a new thread needs an anchor');
  const ref = checkedPost({kind: 'ref', anchor: {kind: 'scene'}});
  assert.equal(ref.kind, 'ref');
  assert.equal(ref.text, '');
  for (const field of ['via', 'author', 'id', 'seq', 'recipients', 'thread']) {
    assert.throws(() => checkedPost({kind: 'note', text: 'x', anchor: {kind: 'scene'}, [field]: 'forged'}), new RegExp(field), `${field} is stamped by the server`);
  }
  assert.throws(() => checkedPost({kind: 'shout', text: 'x', anchor: {kind: 'scene'}}), /kind/i);
});

test('folding the log builds threads, receipts and resolution', () => {
  const events = conversation();
  const state = foldNotes(events);
  assert.equal(state.lastSeq, 5);
  assert.deepEqual(state.issues, []);
  const root = state.notes.get(ROOT_ID);
  assert.deepEqual(root.replies.map(note => note.id), [REPLY_ID]);
  assert.equal(root.receipts.delivered['sub-pilot'].route, 'wait');
  assert.equal(root.receipts.delivered['sub-pilot'].at, at(2));
  assert.equal(root.resolved, true);
  const reply = state.notes.get(REPLY_ID);
  assert.equal(reply.receipts.seen.noah.at, at(4));
  assert.deepEqual(reply.anchor, root.anchor, 'a reply carries its thread anchor');
  assert.deepEqual(state.threads.map(note => note.id), [ROOT_ID]);
  assert.deepEqual(notesFor(state, 'sub-pilot').map(note => note.id), [ROOT_ID]);
  assert.deepEqual(notesFor(state, 'noah').map(note => note.id), [REPLY_ID]);
  assert.deepEqual(notesFor(state, 'noah', {unseen: true}).map(note => note.id), [], 'seen notes leave the unseen list');
  const reopened = foldNotes([...events, ev(6, {type: 'reopened', notes: [ROOT_ID], author: 'noah', via: 'page'})]);
  assert.equal(reopened.notes.get(ROOT_ID).resolved, false);
});

test('folding reports a malformed event and keeps going', () => {
  const state = foldNotes([ev(1, {type: 'mystery'}), ...conversation().map(event => ({...event, seq: event.seq + 1})),
    ev(7, {type: 'seen', notes: ['kn-zzzzzzzzzzzz'], author: 'noah', via: 'page'})]);
  assert.equal(state.notes.size, 2);
  assert.equal(state.lastSeq, 7);
  assert.equal(state.issues.length, 2, JSON.stringify(state.issues));
  assert.match(state.issues[0].problem, /type/i);
  assert.match(state.issues[1].problem, /unknown note/i);
});

test('a ref resolves from an id, the copied text or a link, and its text says how to resolve it', () => {
  assert.equal(parseRef(ROOT_ID), ROOT_ID);
  assert.equal(parseRef(`Kaminos note ${ROOT_ID} on "Flame source"`), ROOT_ID);
  assert.equal(parseRef(`http://127.0.0.1:8325/index.html?note=${ROOT_ID}#scene=kiln.kaminos.json`), ROOT_ID);
  assert.throws(() => parseRef('nothing to see'), /note/i);
  const note = foldNotes(conversation()).notes.get(ROOT_ID);
  assert.equal(noteLink(note), `http://127.0.0.1:8325/index.html#scene=kiln.kaminos.json&note=${ROOT_ID}`);
  assert.equal(noteLink({id: ROOT_ID, subject: {scene: null, source}}), `http://127.0.0.1:8325/index.html#note=${ROOT_ID}`);
  const text = formatRef(note);
  assert.match(text, new RegExp(ROOT_ID));
  assert.match(text, /Flame source/);
  assert.match(text, new RegExp(`node tools/notes\\.mjs show ${ROOT_ID}`));
  assert.match(text, new RegExp(`index\\.html#scene=kiln\\.kaminos\\.json&note=${ROOT_ID}`));
});

test('the agent-facing description carries everything needed to act without asking', () => {
  const state = foldNotes(conversation());
  const text = describeNote(state, ROOT_ID, {root: '/tmp/kaminos-notes'});
  assert.match(text, /from noah \(page\)/);
  assert.match(text, /object "Flame source" \(flame-source\)/);
  assert.match(text, /scene kiln\.kaminos\.json/);
  assert.match(text, /cc\/notes@abc1234 \(uncommitted changes\)/);
  assert.match(text, /camera: position \[0, 1, 3\] target \[0, 1, 0\] fov 45/);
  assert.match(text, /selection: flame-source/);
  assert.match(text, /picture: \/tmp\/kaminos-notes\/pictures\/kn-aaaaaaaaaaaa\.png \(1600x1000\)/);
  assert.match(text, /> why does the plume lean here\?/);
  assert.match(text, /sub-pilot: the draft from the open side/, 'the thread is included');
  assert.match(text, /resolved/);
  assert.match(text, new RegExp(`reply: node tools/notes\\.mjs reply ${ROOT_ID} `));
  assert.throws(() => describeNote(state, 'kn-cccccccccccc', {root: '/tmp'}), /no note kn-cccccccccccc/i);
});

test("a reply is described with its own view; the thread's opening view is kept apart", () => {
  const reply = {type: 'note', kind: 'note', id: 'kn-cccccccccccc', thread: ROOT_ID, parent: REPLY_ID, author: 'noah', via: 'page',
    text: 'look from here instead', to: [], recipients: ['sub-pilot'], anchor: null,
    subject: {scene: 'kiln.kaminos.json', source: {origin: 'http://127.0.0.1:8325', branch: 'cc/new', commit: 'b'.repeat(40), dirty: false}},
    context: {view: {position: [9, 8, 7], target: [0, 0, 0], up: [0, 1, 0], fov: 30, near: 0.1, far: 100}, selection: {ids: ['new-object'], activeId: 'new-object'}},
    picture: {file: 'pictures/kn-cccccccccccc.png', width: 640, height: 480, bytes: 10, sha256: 'e'.repeat(64)}};
  const state = foldNotes([...conversation(), ev(6, reply)]);
  const text = describeNote(state, 'kn-cccccccccccc', {root: '/tmp/n'});
  const [own, opening] = text.split('thread opened');
  assert.ok(opening, `the thread's opening view is labeled apart:\n${text}`);
  assert.match(own, /served by cc\/new@bbbbbbb at/);
  assert.match(own, /camera: position \[9, 8, 7\] target \[0, 0, 0\] fov 30/);
  assert.match(own, /selection: new-object/);
  assert.match(own, /picture: \/tmp\/n\/pictures\/kn-cccccccccccc\.png \(640x480\)/);
  assert.doesNotMatch(own, /flame-source\b(?!\))/, "the opening note's selection is not presented as the reply's");
  assert.match(opening, /camera: position \[0, 1, 3\]/);
  const bare = describeNote(state, REPLY_ID, {root: '/tmp/n'});
  assert.match(bare, /no view was recorded with this note/);
});

test('an @ being typed is found at the caret, and only there', () => {
  assert.deepEqual(mentionQueryAt('hey @kom', 8), {start: 4, end: 8, query: 'kom'});
  assert.deepEqual(mentionQueryAt('@', 1), {start: 0, end: 1, query: ''});
  assert.deepEqual(mentionQueryAt('(@Pilot', 7), {start: 1, end: 7, query: 'pilot'});
  assert.equal(mentionQueryAt('mail a@b.c', 10), null, 'an @ inside a word is not a mention');
  assert.equal(mentionQueryAt('hey @kom done', 13), null, 'a finished word is not being typed');
  assert.equal(mentionQueryAt('hey @kom', 3), null, 'the caret must be at the end of the @word');
});

test('suggestions put names that start with what was typed first, and listening agents first within each group', () => {
  const people = [{name: 'kiln-notes-agent', listening: false}, {name: 'sub-pilot', listening: true},
    {name: 'notes-helper', listening: true}, {name: 'other', listening: false}];
  assert.deepEqual(rankParticipants(people, 'no').map(person => person.name), ['notes-helper', 'kiln-notes-agent']);
  assert.deepEqual(rankParticipants(people, '').map(person => person.name), ['notes-helper', 'sub-pilot', 'kiln-notes-agent', 'other']);
  assert.deepEqual(rankParticipants(people, 'zz'), []);
});

test('completing a mention replaces what was typed and leaves the caret after it', () => {
  assert.deepEqual(completeMention('hey @not', 8, 'notes-agent'), {text: 'hey @notes-agent ', caret: 17});
  assert.deepEqual(completeMention('hey @not there', 8, 'notes-agent'), {text: 'hey @notes-agent there', caret: 16});
  assert.equal(completeMention('no mention here', 4, 'x'), null);
});

test('only known names in the text address anyone; other @words stay text', () => {
  assert.deepEqual(addresseesIn('@notes-agent can we add @mentions here? @Notes-Agent', ['notes-agent', 'noah']),
    {recognized: ['notes-agent'], unknown: ['mentions']});
  assert.deepEqual(addresseesIn('no one at all', ['noah']), {recognized: [], unknown: []});
});

test("given who is reading and through which server, the reply line is a command to run as is", () => {
  const state = foldNotes(conversation());
  const text = describeNote(state, ROOT_ID, {root: '/tmp/n', as: 'water-agent', server: 'http://127.0.0.1:8090'});
  assert.match(text, new RegExp(`reply: node tools/notes\\.mjs --server http://127\\.0\\.0\\.1:8090 reply ${ROOT_ID} "<your reply>" --as water-agent`));
  assert.doesNotMatch(text, /<your name>/);
  const bare = describeNote(state, ROOT_ID, {root: '/tmp/n'});
  assert.match(bare, /--as <your name>/, 'without a reader the line still says what to fill in');
});
