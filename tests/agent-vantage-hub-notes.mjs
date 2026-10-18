// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';

// The hub's notes channel: one notes stream per server for every subscribed
// tab, in a fake shared-worker environment the test drives.
async function notesHub({probe = () => ({status: 200, body: {ok: true, hub: true, lastSeq: 40}}), presenceStatus = () => 200} = {}) {
  const {createVantageHub} = await import('../agent-vantage-hub.mjs');
  const sources = [], requests = [], intervals = [], timeouts = [];
  let t = 0;
  class FakeEventSource {
    static CLOSED = 2;
    constructor(url) { this.url = String(url); this.readyState = 0; this.handlers = {}; sources.push(this); }
    addEventListener(type, fn) { (this.handlers[type] ??= []).push(fn); }
    close() { this.readyState = 2; }
    emit(type, event = {}) { if (type === 'open') this.readyState = 1; for (const fn of this.handlers[type] ?? []) fn(event); }
  }
  const fetch = async (url, init) => {
    url = String(url);
    requests.push({url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : null});
    if (url.startsWith('/api/notes?after=')) { const answer = probe(); return {status: answer.status, ok: answer.status === 200, json: async () => answer.body}; }
    if (url === '/api/notes/presence') { const status = presenceStatus(); return {status, ok: status === 200, json: async () => ({ok: status === 200})}; }
    return {status: 200, ok: true, json: async () => ({ok: true, hub: true})};
  };
  const hub = createVantageHub({EventSource: FakeEventSource, fetch, now: () => t, hubId: 'hub-test0001',
    setInterval: (fn, ms) => intervals.push({fn, ms}), setTimeout: (fn, ms) => timeouts.push({fn, ms})});
  const port = () => {
    const sent = [];
    const p = {sent, onmessage: null, start() {}, postMessage(message) { sent.push(message); }, say(message) { p.onmessage?.({data: message}); }};
    hub.connect(p);
    return p;
  };
  const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  const notesStreams = () => sources.filter(source => source.url.startsWith('/api/notes/stream'));
  const presencePosts = () => requests.filter(request => request.url === '/api/notes/presence' && request.method === 'POST').map(request => request.body);
  const check = () => intervals.find(item => item.ms <= 10000).fn();
  return {hub, port, sources, requests, timeouts, settle, notesStreams, presencePosts, check, advance: ms => { t += ms; }};
}
const subscribe = (port, page, after = 0) => port.say({type: 'subscribe', channel: 'notes', endpoint: '/api/notes', page, after});
const channelMessages = port => port.sent.filter(message => message.channel === 'notes');

test('every subscribed tab shares one notes stream, opened where the server is now, and hears every event', async () => {
  const h = await notesHub(), a = h.port(), b = h.port();
  subscribe(a, 'page-a', 12); subscribe(b, 'page-b', 40);
  await h.settle();
  assert.ok(h.requests.some(request => request.url.startsWith('/api/notes?after=')), 'the hub asks whether the server streams notes to a hub');
  assert.equal(h.notesStreams().length, 1, 'one notes stream for all tabs');
  assert.equal(h.notesStreams()[0].url, '/api/notes/stream?hub=hub-test0001&after=40', 'from where the server is, not from the start of the log');
  h.notesStreams()[0].emit('open'); await h.settle();
  h.notesStreams()[0].emit('events', {lastEventId: '41', data: JSON.stringify({events: [{seq: 41, type: 'note'}]})});
  h.notesStreams()[0].emit('presence', {data: JSON.stringify({pages: [{id: 'page-a'}]})});
  for (const p of [a, b]) {
    assert.deepEqual(channelMessages(p).filter(message => message.type === 'channel'),
      [{type: 'channel', channel: 'notes', event: 'events', data: {events: [{seq: 41, type: 'note'}]}},
        {type: 'channel', channel: 'notes', event: 'presence', data: {pages: [{id: 'page-a'}]}}]);
  }
  assert.ok(!h.requests.some(request => request.url.startsWith('/api/vantage')), 'a notes tab is not a vantage tab: nothing joins or probes the vantage hub');
});

test('a notes tab\'s heartbeat never makes it a vantage tab', async () => {
  const h = await notesHub(), a = h.port();
  subscribe(a, 'page-a'); await h.settle();
  h.notesStreams()[0].emit('open'); await h.settle();
  a.say({type: 'pong', channel: 'notes', page: 'page-a'}); await h.settle();
  h.check(); await h.settle();
  assert.ok(!h.requests.some(request => request.url.startsWith('/api/vantage')));
  assert.deepEqual(h.hub.state().pages, [], 'the vantage hub has no pages');
});

test('the hub tells the server which pages it carries, on every change and every check', async () => {
  const h = await notesHub(), a = h.port(), b = h.port();
  subscribe(a, 'page-a'); subscribe(b, 'page-b'); await h.settle();
  h.notesStreams()[0].emit('open'); await h.settle();
  assert.deepEqual(h.presencePosts().at(-1), {hub: 'hub-test0001', pages: ['page-a', 'page-b']});
  b.say({type: 'unsubscribe', channel: 'notes', page: 'page-b'}); await h.settle();
  assert.deepEqual(h.presencePosts().at(-1), {hub: 'hub-test0001', pages: ['page-a']}, 'a tab that leaves is no longer reported');
  const before = h.presencePosts().length;
  h.check(); await h.settle();
  assert.equal(h.presencePosts().length, before + 1, 'and the set is repeated on every check, as a heartbeat');
});

test('a tab silent past the hub\'s patience is dropped from the set, and told to catch up when it speaks again', async () => {
  const h = await notesHub(), a = h.port(), b = h.port();
  subscribe(a, 'page-a'); subscribe(b, 'page-b'); await h.settle();
  h.notesStreams()[0].emit('open'); await h.settle();
  for (let i = 0; i < 7; i++) { h.advance(10000); a.say({type: 'pong', channel: 'notes', page: 'page-a'}); h.check(); await h.settle(); }
  assert.deepEqual(h.presencePosts().at(-1), {hub: 'hub-test0001', pages: ['page-a']}, 'page b was silent for 70 s');
  b.say({type: 'pong', channel: 'notes', page: 'page-b'}); await h.settle();
  assert.deepEqual(channelMessages(b).at(-1), {type: 'resync', channel: 'notes'}, 'it may have missed events while dropped');
  assert.deepEqual(h.presencePosts().at(-1), {hub: 'hub-test0001', pages: ['page-a', 'page-b']});
});

test('a dropped notes stream comes back from the last event the hub saw', async () => {
  const h = await notesHub(), a = h.port();
  subscribe(a, 'page-a'); await h.settle();
  const first = h.notesStreams()[0];
  first.emit('open'); await h.settle();
  first.emit('events', {lastEventId: '45', data: JSON.stringify({events: [{seq: 44}, {seq: 45}]})});
  first.readyState = 2; first.emit('error'); await h.settle();
  h.timeouts.at(-1).fn(); await h.settle();
  assert.equal(h.notesStreams().length, 2);
  assert.equal(h.notesStreams()[1].url, '/api/notes/stream?hub=hub-test0001&after=45');
});

test('a server that does not stream notes to a hub sends each tab back to its own stream', async () => {
  const older = await notesHub({probe: () => ({status: 200, body: {ok: true, lastSeq: 40}})}), a = older.port();
  subscribe(a, 'page-a'); await older.settle();
  assert.equal(older.notesStreams().length, 0);
  assert.deepEqual(channelMessages(a).at(-1), {type: 'fallback', channel: 'notes'});
  const none = await notesHub({probe: () => ({status: 404, body: {ok: false}})}), b = none.port();
  subscribe(b, 'page-b'); await none.settle();
  assert.deepEqual(channelMessages(b).at(-1), {type: 'status', channel: 'notes', state: 'unavailable'});
  const flaky = await notesHub({probe: (() => { let n = 0; return () => (++n === 1 ? {status: 503, body: {}} : {status: 200, body: {ok: true, hub: true, lastSeq: 7}}); })()}), c = flaky.port();
  subscribe(c, 'page-c'); await flaky.settle();
  assert.equal(flaky.notesStreams().length, 0, 'a failed probe says nothing about the server');
  flaky.timeouts.at(-1).fn(); await flaky.settle();
  assert.equal(flaky.notesStreams()[0].url, '/api/notes/stream?hub=hub-test0001&after=7', 'it asks again');
});

test('the last tab leaving closes the notes stream', async () => {
  const h = await notesHub(), a = h.port();
  subscribe(a, 'page-a'); await h.settle();
  h.notesStreams()[0].emit('open'); await h.settle();
  a.say({type: 'unsubscribe', channel: 'notes', page: 'page-a'}); await h.settle();
  assert.equal(h.notesStreams()[0].readyState, 2);
});

// --- the page side: subscribeHubChannel --------------------------------------------------------

async function pageHarness({catchUp = after => ({events: [], lastSeq: after}), sharedWorker = true} = {}) {
  const {subscribeHubChannel} = await import('../agent-vantage-hub-notes.mjs');
  const ports = [], fetches = [], listeners = {}, intervals = [];
  class FakeSharedWorker {
    constructor(url, options) {
      const port = {url: String(url), options, sent: [], onmessage: null, start() {}, postMessage(message) { port.sent.push(message); },
        say(message) { port.onmessage?.({data: message}); }};
      this.port = port; ports.push(port);
    }
  }
  const window = {
    ...(sharedWorker ? {SharedWorker: FakeSharedWorker} : {}),
    fetch: async url => { fetches.push(String(url)); const after = Number(new URL(String(url), 'http://x').searchParams.get('after')); return {ok: true, status: 200, json: async () => catchUp(after)}; },
    addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); }, removeEventListener: (type, fn) => { listeners[type] = (listeners[type] ?? []).filter(item => item !== fn); },
    setInterval: (fn, ms) => intervals.push({fn, ms}) - 1, clearInterval() {},
  };
  const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  const fire = type => { for (const fn of listeners[type] ?? []) fn(); };
  return {subscribeHubChannel, window, ports, fetches, intervals, settle, fire};
}

test('a page subscribes through the vantage hub\'s own worker, catches up itself, and hears each event once, in order', async () => {
  const p = await pageHarness({catchUp: after => ({events: [{seq: 11}, {seq: 12}, {seq: 13}].filter(event => event.seq > after), lastSeq: 13})});
  const heard = [];
  const link = p.subscribeHubChannel({window: p.window, channel: 'notes', endpoint: '/api/notes', page: 'page-a', after: 10,
    hubUrl: 'http://127.0.0.1:8484/agent-vantage-hub-worker.mjs', onEvent: (event, data) => heard.push([event, data])});
  assert.ok(link);
  const port = p.ports[0];
  assert.equal(port.options.name, 'kaminos-vantage-hub', 'the same shared worker as the vantage link');
  assert.equal(port.options.type, 'module');
  assert.deepEqual(port.sent[0], {type: 'subscribe', channel: 'notes', endpoint: '/api/notes', page: 'page-a', after: 10});
  // A live event that arrives before the catch-up answers waits for it, and is not heard twice.
  port.say({type: 'channel', channel: 'notes', event: 'events', data: {events: [{seq: 13}, {seq: 14}]}});
  await p.settle();
  assert.deepEqual(p.fetches, ['/api/notes?after=10']);
  assert.deepEqual(heard.filter(([event]) => event === 'events').flatMap(([, data]) => data.events.map(item => item.seq)), [11, 12, 13, 14]);
  port.say({type: 'channel', channel: 'notes', event: 'presence', data: {pages: []}});
  assert.deepEqual(heard.at(-1), ['presence', {pages: []}]);
  port.say({type: 'channel', channel: 'other', event: 'events', data: {events: [{seq: 99}]}});
  assert.ok(!heard.some(([, data]) => data.events?.some(item => item.seq === 99)), 'another channel is not this one');
  assert.equal(link.lastSeq(), 14);
});

test('the page answers the hub, catches up when told to resync, and leaves and returns with the tab', async () => {
  const p = await pageHarness({catchUp: after => ({events: after < 20 ? [{seq: 20}] : [], lastSeq: 20})});
  const heard = [];
  p.subscribeHubChannel({window: p.window, channel: 'notes', endpoint: '/api/notes', page: 'page-a', after: 15, onEvent: (event, data) => heard.push(data)});
  const port = p.ports[0];
  await p.settle();
  port.say({type: 'ping'});
  assert.deepEqual(port.sent.at(-1), {type: 'pong', channel: 'notes', page: 'page-a'});
  port.say({type: 'resync', channel: 'notes'}); await p.settle();
  assert.deepEqual(p.fetches.at(-1), '/api/notes?after=20', 'from the last event it heard');
  p.fire('pagehide');
  assert.deepEqual(port.sent.at(-1), {type: 'unsubscribe', channel: 'notes', page: 'page-a'});
  p.fire('pageshow'); await p.settle();
  assert.deepEqual(port.sent.at(-1).type === 'subscribe' ? port.sent.at(-1) : port.sent.find(message => message.type === 'subscribe' && message.after === 20),
    {type: 'subscribe', channel: 'notes', endpoint: '/api/notes', page: 'page-a', after: 20});
  assert.ok(p.intervals.some(item => item.ms <= 15000), 'it also speaks to the hub unasked, so a hub that dropped it hears it again');
});

test('without shared workers, or when the hub sends the page back, the caller keeps its own stream', async () => {
  const none = await pageHarness({sharedWorker: false});
  assert.equal(none.subscribeHubChannel({window: none.window, channel: 'notes', endpoint: '/api/notes', page: 'page-a', after: 0, onEvent() {}}), null);
  const p = await pageHarness();
  let fellBack = 0;
  p.subscribeHubChannel({window: p.window, channel: 'notes', endpoint: '/api/notes', page: 'page-a', after: 0, onEvent() {}, onFallback: () => fellBack++});
  p.ports[0].say({type: 'fallback', channel: 'notes'});
  assert.equal(fellBack, 1);
  assert.deepEqual(p.ports[0].sent.at(-1), {type: 'unsubscribe', channel: 'notes', page: 'page-a'});
});
