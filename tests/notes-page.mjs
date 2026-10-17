// kaminos-test: node
// The page's notes session without a browser: what a note anchors to, who it
// reaches, what it carries, and what the person is told when an answer comes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createNotesSession, mentionsIn} from '../notes-panel.mjs';
import {NOTES_SCHEMA} from '../notes-core.mjs';

const VIEW = {position: [0, 1, 4], target: [0, 1, 0], up: [0, 1, 0], fov: 50, near: 0.1, far: 1000};

function fakePage({selected = {ids: [], memberIds: [], activeId: null}, capture, avatarOf, ownView} = {}) {
  // Like the page, every selection change is a new selection object.
  const app = {
    posted: [], receipts: [], view: structuredClone(VIEW), writes: [], selections: [], scene: 'bench.kaminos.json',
    entries: [{id: 'cube', label: 'Cube', type: 'procedural-mesh'}, {id: 'lamp', label: 'Lamp', type: 'light'},
      {id: 'vantage-sub-pilot', label: 'Sub', type: 'camera'}, {id: 'ship', label: 'Ship', type: 'camera'}],
    selected, seq: 0,
  };
  const stamp = (body, extra) => ({schema: NOTES_SCHEMA, seq: ++app.seq, at: `2026-10-14T19:00:0${app.seq}.000Z`, author: 'noah', via: 'page', ...body, ...extra});
  const transport = {
    async post(body) {
      app.posted.push(body);
      const id = `kn-${String(app.seq + 1).padStart(12, '0')}`;
      return stamp(body, {type: 'note', id, thread: body.parent ?? id, recipients: body.to,
        picture: body.picture ? {file: `pictures/${id}.png`, width: 4, height: 3} : null});
    },
    async receipt(body) { app.receipts.push(body); return stamp(body, {}); },
  };
  const session = createNotesSession({
    transport,
    selection: () => structuredClone(app.selected),
    entries: () => app.entries,
    readView: () => structuredClone(app.view),
    writeView: view => { app.writes.push(view); app.view = structuredClone(view); },
    select: id => app.selections.push(id),
    sceneFile: () => app.scene,
    capture: capture ?? (async () => ({image: 'data:image/png;base64,iVBORw0KGgo=', width: 4, height: 3})),
    href: () => 'http://127.0.0.1:8325/index.html',
    title: () => 'Kaminos',
    avatarOf,
    ...(ownView ? {ownView: () => ownView(app)} : {}),
    selectionToken: () => app.selected,
    sceneId: () => app.sceneId ?? null,
  });
  return {app, session};
}

const note = (seq, fields) => ({schema: NOTES_SCHEMA, seq, type: 'note', kind: 'note', at: `2026-10-14T19:00:${String(seq).padStart(2, '0')}.000Z`,
  id: `kn-${String(seq).padStart(12, '0')}`, parent: null, to: [], recipients: [], via: 'cli', subject: {scene: 'bench.kaminos.json'}, ...fields});

test('mentions in the text address the note too', () => {
  assert.deepEqual(mentionsIn('@sub-pilot can you and @Water-Agent look? mail me at a@b.c'), ['sub-pilot', 'water-agent']);
  assert.deepEqual(mentionsIn('no one'), []);
});

test('a note goes on the selected object and carries what the person saw', async () => {
  const {app, session} = fakePage({selected: {ids: ['cube'], memberIds: ['cube'], activeId: 'cube'}});
  session.hello({author: 'noah', lastSeq: 0});
  session.setParticipants([{name: 'water-agent', listening: false}]);
  const posted = await session.post({text: 'why is the rim clipped? @water-agent', to: '@sub-pilot'});
  const body = app.posted[0];
  assert.deepEqual(body.anchor, {kind: 'object', id: 'cube', label: 'Cube'});
  assert.deepEqual(body.to, ['sub-pilot', 'water-agent']);
  assert.deepEqual(body.subject, {scene: 'bench.kaminos.json'});
  assert.deepEqual(body.context.view, VIEW);
  assert.deepEqual(body.context.selection, {ids: ['cube'], activeId: 'cube'});
  assert.equal(body.context.page.href, 'http://127.0.0.1:8325/index.html');
  assert.equal(body.picture.dataUrl, 'data:image/png;base64,iVBORw0KGgo=');
  assert.equal(posted.id, 'kn-000000000001');
  assert.ok(!('author' in body) && !('via' in body), 'the page never claims its own provenance');
});

test('with nothing selected a note goes on the scene; a failed or blank picture is said, not faked', async () => {
  const failing = fakePage({capture: async () => { throw new Error('Host canvas has no visible area'); }});
  await failing.session.post({text: 'the whole thing is too dark'});
  assert.deepEqual(failing.app.posted[0].anchor, {kind: 'scene'});
  assert.equal(failing.app.posted[0].picture, null);
  assert.match(failing.app.posted[0].context.pictureIssue, /no visible area/);
  const blank = fakePage({capture: async () => ({image: 'data:image/png;base64,iVBORw0KGgo=', blank: true})});
  await blank.session.post({text: 'is anything drawn?'});
  assert.equal(blank.app.posted[0].picture, null);
  assert.match(blank.app.posted[0].context.pictureIssue, /one flat color/);
  const words = fakePage();
  await assert.rejects(words.session.post({text: '   ', attachPicture: false}), /words or a picture/, 'an empty note with no picture is refused');
  await words.session.post({text: ''});
  assert.ok(words.app.posted[0].picture, 'a picture on its own is a note: look at this');
});

test('a reply keeps its thread anchor and only attaches a picture when asked', async () => {
  const {app, session} = fakePage({selected: {ids: ['lamp'], memberIds: ['lamp'], activeId: 'lamp'}});
  await session.post({text: 'yes, from the left', parent: 'kn-000000000009'});
  assert.equal(app.posted[0].parent, 'kn-000000000009');
  assert.equal(app.posted[0].anchor, null);
  assert.equal(app.posted[0].picture, null);
  await session.post({text: 'like this', parent: 'kn-000000000009', attachPicture: true});
  assert.equal(app.posted[1].picture.dataUrl, 'data:image/png;base64,iVBORw0KGgo=');
});

test('copying a ref records the view and returns text an agent can resolve', async () => {
  const {app, session} = fakePage({selected: {ids: ['cube'], memberIds: ['cube'], activeId: 'cube'}});
  const {note: ref, text} = await session.copyRef();
  assert.equal(app.posted[0].kind, 'ref');
  assert.equal(app.posted[0].text, '');
  assert.ok(app.posted[0].picture, 'the ref keeps the picture of what was seen');
  assert.match(text, new RegExp(`node tools/notes\\.mjs show ${ref.id}`));
  assert.match(text, /"Cube"/);
});

test('answers that arrive while the page is open are announced; the backlog and your own notes are not', () => {
  const {session} = fakePage();
  session.hello({author: 'noah', lastSeq: 2});
  const backlog = [note(1, {author: 'noah', via: 'page', text: 'why?', to: ['sub-pilot'], recipients: ['sub-pilot'], anchor: {kind: 'object', id: 'cube', label: 'Cube'}}),
    note(2, {author: 'sub-pilot', text: 'old answer', parent: 'kn-000000000001', thread: 'kn-000000000001', recipients: ['noah']})];
  backlog[0].thread = backlog[0].id;
  assert.deepEqual(session.receive(backlog), [], 'nothing from before the page connected is announced');
  const live = [note(3, {author: 'sub-pilot', text: 'the near plane', parent: 'kn-000000000001', thread: 'kn-000000000001', recipients: ['noah']}),
    note(4, {author: 'noah', via: 'page', text: 'thanks', parent: 'kn-000000000003', thread: 'kn-000000000001', recipients: ['sub-pilot']})];
  const announced = session.receive(live);
  assert.deepEqual(announced.map(item => item.id), ['kn-000000000003']);
  assert.equal(announced[0].anchor.label, 'Cube', 'the announcement can say what it is about');
  assert.deepEqual(session.receive(live), [], 'a repeated batch is not announced twice');
  assert.deepEqual(session.unread().map(item => item.id), ['kn-000000000002'], 'answering a note counts as reading it');
});

test('opening a thread marks what was for you as seen; resolving says so in the log', async () => {
  const {app, session} = fakePage();
  session.hello({author: 'noah', lastSeq: 0});
  const root = note(1, {author: 'noah', via: 'page', text: 'why?', to: ['sub-pilot'], recipients: ['sub-pilot'], anchor: {kind: 'scene'}});
  root.thread = root.id;
  session.receive([root, note(2, {author: 'sub-pilot', text: 'because', parent: root.id, thread: root.id, recipients: ['noah']})]);
  await session.markSeen(root.id);
  assert.deepEqual(app.receipts, [{type: 'seen', notes: ['kn-000000000002']}]);
  session.receive([{schema: NOTES_SCHEMA, seq: 3, type: 'seen', notes: ['kn-000000000002'], author: 'noah', via: 'page'}]);
  assert.equal(await session.markSeen(root.id), null, 'nothing left to mark');
  await session.setResolved(root.id, true);
  assert.deepEqual(app.receipts.at(-1), {type: 'resolved', notes: [root.id]});
});

test('going to a note restores its view and selects its object only if it is still there', () => {
  const {app, session} = fakePage();
  const view = {...VIEW, position: [3, 2, 1]};
  const onCube = note(1, {author: 'sub-pilot', text: 'here', anchor: {kind: 'object', id: 'cube', label: 'Cube'}, context: {view}});
  onCube.thread = onCube.id;
  const onGone = note(2, {author: 'sub-pilot', text: 'there', anchor: {kind: 'object', id: 'removed', label: 'Old'}, context: {view}});
  onGone.thread = onGone.id;
  session.receive([onCube, onGone]);
  assert.deepEqual(session.goTo(onCube.id), {found: true, viewRestored: true, object: 'cube', present: true});
  assert.deepEqual(app.writes.at(-1), view);
  assert.deepEqual(app.selections, ['cube']);
  assert.deepEqual(session.goTo(onGone.id), {found: true, viewRestored: true, object: 'removed', present: false});
  assert.deepEqual(app.selections, ['cube'], 'a missing object is not selected');
  assert.deepEqual(session.goTo('kn-zzzzzzzzzzzz'), {found: false});
});

test('the thread list shows this scene and anything involving you, open first', () => {
  const {app, session} = fakePage();
  session.hello({author: 'noah', lastSeq: 0});
  const here = note(1, {author: 'sub-pilot', text: 'here', anchor: {kind: 'scene'}});
  const elsewhere = note(2, {author: 'sub-pilot', text: 'other scene', anchor: {kind: 'scene'}, subject: {scene: 'kiln.kaminos.json'}});
  const forYou = note(3, {author: 'sub-pilot', text: 'for you', anchor: {kind: 'scene'}, subject: {scene: 'kiln.kaminos.json'}, to: ['noah'], recipients: ['noah']});
  const ref = note(4, {kind: 'ref', author: 'noah', via: 'page', text: '', anchor: {kind: 'scene'}});
  for (const item of [here, elsewhere, forYou, ref]) item.thread = item.id;
  session.receive([here, elsewhere, forYou, ref, {schema: NOTES_SCHEMA, seq: 5, type: 'resolved', notes: [forYou.id], author: 'noah', via: 'page'}]);
  assert.deepEqual(session.threads().map(item => item.id), [here.id, forYou.id]);
  app.scene = 'kiln.kaminos.json';
  assert.deepEqual(session.threads().map(item => item.id), [elsewhere.id, forYou.id]);
});

test('a mention of someone unknown stays text; the preview says who a note will reach', async () => {
  const {app, session} = fakePage();
  session.hello({author: 'noah', lastSeq: 0});
  session.setParticipants([{name: 'notes-agent', listening: true}, {name: 'noah', kind: 'person'}, {name: 'idle-agent', listening: false}]);
  assert.deepEqual(session.preview({text: '@notes-agent can we add @mentions? @idle-agent', to: ''}),
    {recipients: ['notes-agent', 'idle-agent'], listening: ['notes-agent'], notified: [], unknown: ['mentions']});
  await session.post({text: '@notes-agent can we add @mentions?', attachPicture: false});
  assert.deepEqual(app.posted[0].to, ['notes-agent']);
  await session.post({text: 'for you', to: 'brand-new-agent', attachPicture: false});
  assert.deepEqual(app.posted[1].to, ['brand-new-agent'], 'the To field addresses any name on purpose');
  assert.deepEqual(session.suggestions('not').map(person => person.name), ['notes-agent']);
  assert.ok(!session.suggestions('').some(person => person.name === 'noah'), 'you are not suggested to yourself');
});

test('threads read like a chat: oldest first, and resolving one does not move it', () => {
  const {session} = fakePage();
  session.hello({author: 'noah', lastSeq: 0});
  const first = note(1, {author: 'sub-pilot', text: 'first', anchor: {kind: 'scene'}});
  const second = note(2, {author: 'sub-pilot', text: 'second', anchor: {kind: 'scene'}});
  const third = note(3, {author: 'sub-pilot', text: 'third', anchor: {kind: 'scene'}});
  for (const item of [first, second, third]) item.thread = item.id;
  const lateReply = note(4, {author: 'noah', via: 'page', text: 'back to the first', parent: first.id, thread: first.id, recipients: ['sub-pilot']});
  session.receive([first, second, third, lateReply, {schema: NOTES_SCHEMA, seq: 5, type: 'resolved', notes: [second.id], author: 'noah', via: 'page'}]);
  assert.deepEqual(session.threads().map(item => item.id), [first.id, second.id, third.id]);
});

test("a name leads to that agent's avatar: registered, then the vantage, then the sub named after it", () => {
  const {app, session} = fakePage({avatarOf: name => (name === 'pilot-by-api' ? 'ship' : null)});
  session.setParticipants([{name: 'registered-agent', avatar: 'lamp'}, {name: 'stale-agent', avatar: 'gone-object'},
    {name: 'pilot-by-api'}, {name: 'sub-pilot'}, {name: 'no-avatar'}]);
  assert.equal(session.avatarFor('registered-agent'), 'lamp');
  assert.equal(session.avatarFor('pilot-by-api'), 'ship');
  assert.equal(session.avatarFor('sub-pilot'), 'vantage-sub-pilot');
  assert.equal(session.avatarFor('stale-agent'), null, 'an avatar that is no longer in the scene is not selected');
  assert.equal(session.avatarFor('no-avatar'), null);
  assert.deepEqual(session.selectAvatar('sub-pilot'), {name: 'sub-pilot', object: 'vantage-sub-pilot'});
  assert.deepEqual(app.selections, ['vantage-sub-pilot']);
  assert.deepEqual(session.selectAvatar('no-avatar'), {name: 'no-avatar', object: null});
  assert.deepEqual(app.selections, ['vantage-sub-pilot'], 'nothing is selected when there is no avatar');
});

test("a note's anchor, scene, selection, view and picture describe one moment", async () => {
  // The picture is taken over several frames; the person selects something
  // else, opens another scene and moves the camera before it comes back.
  let release, calls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const {app, session} = fakePage({selected: {ids: ['cube'], memberIds: ['cube'], activeId: 'cube'},
    capture: async () => { calls++; await gate; return {image: 'data:image/png;base64,iVBORw0KGgo=', width: 4, height: 3}; }});
  session.hello({author: 'noah', lastSeq: 0});
  const posting = session.post({text: 'what is this?'});
  await new Promise(resolve => setTimeout(resolve, 0));
  app.selected = {ids: ['lamp'], memberIds: ['lamp'], activeId: 'lamp'};
  app.scene = 'second.kaminos.json';
  app.view = {...structuredClone(VIEW), position: [3, 2, 1]};
  release();
  await posting;
  const body = app.posted[0];
  assert.equal(body.anchor.id, body.context.selection.activeId, 'the note is on the object its selection names');
  assert.deepEqual(body.anchor, {kind: 'object', id: 'lamp', label: 'Lamp'});
  assert.deepEqual(body.subject, {scene: 'second.kaminos.json'});
  assert.deepEqual(body.context.view.position, [3, 2, 1]);
  assert.ok(calls >= 2, 'the picture was taken again after the change, so it shows what the note records');
});

test('a view that keeps moving while the picture is taken is refused, not mixed', async () => {
  const {app, session} = fakePage({selected: {ids: ['cube'], memberIds: ['cube'], activeId: 'cube'},
    capture: async () => {
      app.view = {...app.view, position: [app.view.position[0] + 1, 1, 4]};
      return {image: 'data:image/png;base64,iVBORw0KGgo=', width: 4, height: 3};
    }});
  session.hello({author: 'noah', lastSeq: 0});
  await assert.rejects(session.post({text: 'look at this'}), /changing while the picture was taken/);
  assert.equal(app.posted.length, 0, 'nothing is posted when the picture cannot match the recorded view');
});

test("while something else has the viewport camera, a note waits for the person's own view", async () => {
  // A sub's picture borrows the viewport camera; the page says when it is back.
  const SUB = {...structuredClone(VIEW), position: [9, 9, 9]};
  const own = fakePage({ownView: async app => { app.view = structuredClone(VIEW); return true; }});
  own.app.view = structuredClone(SUB);
  own.session.hello({author: 'noah', lastSeq: 0});
  await own.session.post({text: 'the rim'});
  assert.deepEqual(own.app.posted[0].context.view, VIEW, "the note records the person's view, not the borrowed one");
  const kept = fakePage({ownView: async () => false});
  kept.app.view = structuredClone(SUB);
  kept.session.hello({author: 'noah', lastSeq: 0});
  await kept.session.post({text: 'the rim'});
  const body = kept.app.posted[0];
  assert.ok(!('view' in body.context), 'no view is recorded while it is not the person\'s');
  assert.equal(body.picture, null);
  assert.match(body.context.pictureIssue, /kept the viewport camera/);
});

test('a sub that takes the camera during the picture and keeps it never becomes the recorded view', async () => {
  const SUB = {...structuredClone(VIEW), position: [9, 9, 9]};
  let held = false;
  const {app, session} = fakePage({
    ownView: async () => !held,
    capture: async () => { held = true; app.view = structuredClone(SUB); throw new Error('a sub kept the viewport camera'); },
  });
  session.hello({author: 'noah', lastSeq: 0});
  await session.post({text: 'look at this'});
  const body = app.posted[0];
  assert.ok(!('view' in body.context), 'the borrowed view is not recorded as the person\'s');
  assert.equal(body.picture, null);
  assert.match(body.context.pictureIssue, /kept the viewport camera/);
});

test('when the server notifies people who are not listening, the preview says who will be notified', () => {
  const {session} = fakePage();
  session.hello({author: 'noah', lastSeq: 0});
  session.setParticipants([{name: 'near-agent', listening: true}, {name: 'far-agent', listening: false}], {notifies: true});
  assert.deepEqual(session.preview({text: '@near-agent @far-agent look'}),
    {recipients: ['near-agent', 'far-agent'], listening: ['near-agent'], notified: ['far-agent'], unknown: []});
  session.setParticipants([{name: 'near-agent', listening: true}, {name: 'far-agent', listening: false}]);
  assert.deepEqual(session.preview({text: '@far-agent'}).notified, [], 'without a notify command nobody is notified');
});

test('a picked point anchors the note while its object stays selected', async () => {
  const {app, session} = fakePage({selected: {ids: ['cube'], memberIds: ['cube'], activeId: 'cube'}});
  session.hello({author: 'noah', lastSeq: 0});
  const point = {kind: 'point', id: 'cube', label: 'Cube', local: [0.1, 0.2, 0.3], point: [1, 2, 3], authority: 'exact', at: [0.5, 0.5]};
  session.setPoint(point);
  assert.deepEqual(session.anchorFromSelection(), point);
  await session.post({text: 'right here', attachPicture: false});
  assert.deepEqual(app.posted[0].anchor, point);
  app.selected = {ids: ['lamp'], memberIds: ['lamp'], activeId: 'lamp'};
  assert.deepEqual(session.anchorFromSelection(), {kind: 'object', id: 'lamp', label: 'Lamp'}, 'another object drops the point');
  app.selected = {ids: ['cube'], memberIds: ['cube'], activeId: 'cube'};
  assert.deepEqual(session.anchorFromSelection(), {kind: 'object', id: 'cube', label: 'Cube'}, 'and it does not come back');
});

test('going to a point note selects the object the point is on', () => {
  const {app, session} = fakePage();
  session.hello({author: 'noah', lastSeq: 0});
  session.receive([note(1, {anchor: {kind: 'point', id: 'cube', label: 'Cube', local: [0, 0, 0], point: [1, 2, 3]}, context: {view: VIEW}})]);
  const result = session.goTo('kn-000000000001');
  assert.deepEqual(app.selections, ['cube']);
  assert.equal(result.object, 'cube');
  assert.equal(result.present, true);
});

test('leaving the object and coming back drops a picked point, even unseen', async () => {
  const {app, session} = fakePage({selected: {ids: ['cube'], memberIds: ['cube'], activeId: 'cube'}});
  session.hello({author: 'noah', lastSeq: 0});
  session.setPoint({kind: 'point', id: 'cube', label: 'Cube', local: [0, 0, 0], point: [1, 2, 3]});
  app.selected = {ids: ['lamp'], memberIds: ['lamp'], activeId: 'lamp'};
  app.selected = {ids: ['cube'], memberIds: ['cube'], activeId: 'cube'};
  await session.post({text: 'later', attachPicture: false});
  assert.deepEqual(app.posted[0].anchor, {kind: 'object', id: 'cube', label: 'Cube'});
});

test('a note records the id of the scene it was written in, and none while a scene is loading', async () => {
  const {app, session} = fakePage();
  app.sceneId = 'scene-aaaaaaaaaaaaaaaa';
  session.hello({author: 'noah', lastSeq: 0});
  await session.post({text: 'here', attachPicture: false});
  assert.equal(app.posted[0].subject.sceneId, 'scene-aaaaaaaaaaaaaaaa');
  assert.equal(app.posted[0].context.sceneInstance, undefined, 'the page-and-load guess is gone');
  app.sceneId = null;
  await session.post({text: 'mid-load', attachPicture: false});
  assert.equal(app.posted[1].subject.sceneId ?? null, null, 'a note written mid-load names no scene');
});
