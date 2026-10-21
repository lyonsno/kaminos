// kaminos-test: node
// How a page's notes reach it: through the browser's shared hub when there is
// one, otherwise its own stream; and its posting token from its own hello.
import test from 'node:test';
import assert from 'node:assert/strict';
import {connectNotesLink, sendWithPageToken} from '../notes-panel.mjs';

function fakeWindow({helloToken = 'tok-1', helloOk = true, shared = true} = {}) {
  const sources = [], fetches = [];
  class EventSource {
    constructor(url) { this.url = url; this.readyState = 0; this.listeners = {}; sources.push(this); }
    addEventListener(name, fn) { (this.listeners[name] ??= []).push(fn); }
    emit(name, data) { for (const fn of this.listeners[name] ?? []) fn({data: JSON.stringify(data)}); }
    close() { this.readyState = 2; }
  }
  const window = {
    EventSource, ...(shared ? {SharedWorker: class {}} : {}),
    async fetch(url, options = {}) {
      fetches.push({url, options});
      if (url.endsWith('/hello')) {
        return {ok: helloOk, status: helloOk ? 200 : 404, json: async () => (helloOk ? {token: helloToken, author: 'noah', lastSeq: 7} : {error: 'no'})};
      }
      return {ok: true, status: 200, json: async () => ({})};
    },
  };
  return {window, sources, fetches};
}

function recorder() {
  const seen = {hello: [], events: [], presence: [], lost: 0};
  return {seen, handlers: {onHello: hello => seen.hello.push(hello), onEvents: events => seen.events.push(...events),
    onPresence: presence => seen.presence.push(presence), onLost: () => { seen.lost++; }}};
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test('with a hub, the page says hello for its token, then subscribes, and opens no stream of its own', async () => {
  const {window, sources, fetches} = fakeWindow();
  const {seen, handlers} = recorder();
  let subscribed = null;
  const subscribe = options => { subscribed = options; return {close() {}}; };
  connectNotesLink({window, endpoint: '/api/notes', pageId: 'page-aaaaaaaa', subscribe, ...handlers});
  await settle();
  assert.deepEqual(fetches.map(item => item.url), ['/api/notes/hello']);
  assert.deepEqual(JSON.parse(fetches[0].options.body), {page: 'page-aaaaaaaa'});
  assert.equal(seen.hello[0].token, 'tok-1');
  assert.ok(subscribed, 'it subscribed through the hub');
  assert.equal(subscribed.channel, 'notes');
  assert.equal(subscribed.page, 'page-aaaaaaaa');
  assert.equal(subscribed.after, 0, 'from the start, as the page stream does, so history fills in');
  assert.equal(sources.length, 0, 'no EventSource of its own');
  subscribed.onEvent('events', {events: [{seq: 1}, {seq: 2}]});
  subscribed.onEvent('presence', {pages: []});
  assert.deepEqual(seen.events.map(item => item.seq), [1, 2]);
  assert.deepEqual(seen.presence, [{pages: []}]);
});

test('without a hub (no SharedWorker), the page opens its own stream as before', async () => {
  const {window, sources, fetches} = fakeWindow({shared: false});
  const {seen, handlers} = recorder();
  connectNotesLink({window, endpoint: '/api/notes', pageId: 'page-aaaaaaaa', subscribe: () => assert.fail('no hub without SharedWorker'), ...handlers});
  await settle();
  assert.equal(sources.length, 1);
  assert.equal(sources[0].url, '/api/notes/stream?page=page-aaaaaaaa&after=0');
  assert.deepEqual(fetches, [], 'the stream says hello itself');
  sources[0].emit('hello', {token: 'tok-s', lastSeq: 3});
  sources[0].emit('events', {events: [{seq: 4}]});
  assert.equal(seen.hello[0].token, 'tok-s');
  assert.deepEqual(seen.events.map(item => item.seq), [4]);
});

test('a server without a hub stream sends the page back to its own stream', async () => {
  const {window, sources} = fakeWindow();
  const {handlers} = recorder();
  let subscribed = null, closed = 0;
  connectNotesLink({window, endpoint: '/api/notes', pageId: 'page-aaaaaaaa', subscribe: options => { subscribed = options; return {close() { closed++; }}; }, ...handlers});
  await settle();
  subscribed.onFallback();
  assert.equal(sources.length, 1, 'its own stream');
  assert.equal(closed, 1, 'and lets go of the hub link');
});

test('a server that cannot say hello leaves the page on its own stream', async () => {
  const {window, sources} = fakeWindow({helloOk: false});
  const {handlers} = recorder();
  let subscribed = null;
  connectNotesLink({window, endpoint: '/api/notes', pageId: 'page-aaaaaaaa', subscribe: options => { subscribed = options; return {close() {}}; }, ...handlers});
  await settle();
  assert.equal(subscribed, null);
  assert.equal(sources.length, 1);
});

test('a lapsed token is renewed by a fresh hello, and the post is sent once more', async () => {
  const calls = [];
  let token = 'old';
  const answers = [{ok: false, status: 403, body: {ok: false, phase: 'page-token', error: 'lapsed'}}, {ok: true, status: 200, body: {id: 'kn-1'}}];
  const window = {async fetch(url, options) {
    calls.push({url, token: options.headers['X-Kaminos-Notes-Token']});
    const answer = answers.shift();
    return {ok: answer.ok, status: answer.status, json: async () => answer.body};
  }};
  const posted = await sendWithPageToken({window, pageId: 'page-aaaaaaaa', token: () => token, renew: async () => { token = 'new'; }}, '/api/notes', {text: 'hi'});
  assert.deepEqual(posted, {id: 'kn-1'});
  assert.deepEqual(calls.map(item => item.token), ['old', 'new']);
  // Any other refusal is not retried.
  const refused = [{ok: false, status: 400, body: {phase: 'request', error: 'bad'}}];
  const other = {async fetch() { const answer = refused.shift(); return {ok: false, status: answer.status, json: async () => answer.body}; }};
  await assert.rejects(sendWithPageToken({window: other, pageId: 'page-aaaaaaaa', token: () => 'x', renew: async () => assert.fail('renewed')}, '/api/notes', {}), /bad/);
});
