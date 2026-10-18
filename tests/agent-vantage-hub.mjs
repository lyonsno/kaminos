// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';

// The hub runs in a shared worker; here it gets a fake environment: one
// EventSource it may open, fetch, timers and a clock the test drives.
async function hubHarness({pages = {ok: true, hub: true}, pagesStatus = 200} = {}) {
  const {createVantageHub} = await import('../agent-vantage-hub.mjs');
  const sources = [], posts = [], intervals = [], timeouts = [];
  let t = 0;
  class FakeEventSource {
    static CLOSED = 2;
    constructor(url) { this.url = String(url); this.readyState = 0; this.handlers = {}; sources.push(this); }
    addEventListener(type, fn) { (this.handlers[type] ??= []).push(fn); }
    close() { this.readyState = 2; }
    emit(type, event = {}) { if (type === 'open') this.readyState = 1; for (const fn of this.handlers[type] ?? []) fn(event); }
  }
  const env = {EventSource: FakeEventSource, now: () => t, hubId: 'hub-test0001',
    fetch: async (url, init) => {
      posts.push({url: String(url), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : null});
      if (String(url).endsWith('/pages')) return {status: pagesStatus, ok: pagesStatus === 200, json: async () => pages};
      return {status: 200, ok: true, json: async () => ({ok: true})};
    },
    setInterval: (fn, ms) => intervals.push({fn, ms}), setTimeout: (fn, ms) => timeouts.push({fn, ms})};
  const hub = createVantageHub(env);
  const port = () => {
    const sent = [];
    const p = {sent, onmessage: null, start() {}, postMessage(message) { sent.push(message); }, say(message) { p.onmessage?.({data: message}); }};
    hub.connect(p);
    return p;
  };
  const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  return {hub, port, sources, posts, intervals, timeouts, settle, advance: ms => { t += ms; }};
}
const facts = page => ({page, visible: false, focused: false, href: 'http://127.0.0.1:8484/index.html', title: 'Kaminos'});

test('every tab shares one hub stream, joins it, and receives only its own commands', async () => {
  const h = await hubHarness(), a = h.port(), b = h.port();
  a.say({type: 'join', endpoint: '/api/vantage', page: 'page-a', facts: facts('page-a')});
  b.say({type: 'join', endpoint: '/api/vantage', page: 'page-b', facts: facts('page-b')});
  await h.settle();
  assert.equal(h.sources.length, 1, 'one stream for all tabs');
  assert.equal(h.sources[0].url, '/api/vantage/hub?hub=hub-test0001');
  h.sources[0].emit('open'); await h.settle();
  const joins = h.posts.filter(post => post.url === '/api/vantage/join').map(post => post.body);
  assert.deepEqual(joins.map(body => [body.hub, body.page, body.visible]).sort(), [['hub-test0001', 'page-a', false], ['hub-test0001', 'page-b', false]]);
  assert.deepEqual(a.sent.at(-1), {type: 'status', state: 'linked', via: 'hub'});
  h.sources[0].emit('command', {data: JSON.stringify({id: 'c1', page: 'page-b', command: 'status', args: {}})});
  assert.deepEqual(b.sent.at(-1), {type: 'command', page: 'page-b', message: {id: 'c1', page: 'page-b', command: 'status', args: {}}});
  assert.ok(!a.sent.some(message => message.type === 'command'), 'page a gets nothing meant for b');
  h.sources[0].emit('command', {data: JSON.stringify({id: 'c2', page: 'page-gone', command: 'status', args: {}})});
  await h.settle();
  assert.ok(h.posts.some(post => post.url === '/api/vantage/leave' && post.body.page === 'page-gone'), 'a command for a tab the hub no longer has: that page leaves');
});

test('a tab that closes, or stops answering, leaves the hub; a reconnected stream joins every tab again', async () => {
  const h = await hubHarness(), a = h.port(), b = h.port();
  a.say({type: 'join', endpoint: '/api/vantage', page: 'page-a', facts: facts('page-a')});
  b.say({type: 'join', endpoint: '/api/vantage', page: 'page-b', facts: facts('page-b')});
  await h.settle(); h.sources[0].emit('open'); await h.settle();
  a.say({type: 'leave', page: 'page-a'}); await h.settle();
  assert.ok(h.posts.some(post => post.url === '/api/vantage/leave' && post.body.page === 'page-a'));
  const liveness = h.intervals.find(item => item.ms <= 10000);
  assert.ok(liveness, 'the hub checks on its tabs');
  h.advance(10000); liveness.fn();
  assert.deepEqual(b.sent.at(-1), {type: 'ping'});
  b.say({type: 'pong', page: 'page-b'});
  h.advance(40000); liveness.fn(); await h.settle();
  assert.ok(!h.posts.some(post => post.url === '/api/vantage/leave' && post.body.page === 'page-b'), 'a tab that answered recently stays, hidden or not');
  h.advance(40000); liveness.fn(); await h.settle();
  assert.ok(h.posts.some(post => post.url === '/api/vantage/leave' && post.body.page === 'page-b'), 'a tab silent for longer than the hub waits has gone');
  const c = h.port();
  c.say({type: 'join', endpoint: '/api/vantage', page: 'page-c', facts: facts('page-c')}); await h.settle();
  h.posts.length = 0;
  h.sources[0].emit('open'); await h.settle();
  assert.deepEqual(h.posts.filter(post => post.url === '/api/vantage/join').map(post => post.body.page), ['page-c'], 'after a reconnect every tab still with the hub joins again');
});

test('a server without the hub sends tabs back to their own streams, and a server without the vantage leaves them unlinked', async () => {
  const older = await hubHarness({pages: {pages: []}});
  const tab = older.port();
  tab.say({type: 'join', endpoint: '/api/vantage', page: 'page-a', facts: facts('page-a')}); await older.settle();
  assert.equal(older.sources.length, 0);
  assert.deepEqual(tab.sent.at(-1), {type: 'fallback'});
  const late = older.port();
  late.say({type: 'join', endpoint: '/api/vantage', page: 'page-b', facts: facts('page-b')}); await older.settle();
  assert.deepEqual(late.sent.at(-1), {type: 'fallback'}, 'later tabs too');
  const none = await hubHarness({pagesStatus: 404});
  const lone = none.port();
  lone.say({type: 'join', endpoint: '/api/vantage', page: 'page-a', facts: facts('page-a')}); await none.settle();
  assert.equal(none.sources.length, 0);
  assert.deepEqual(lone.sent.at(-1), {type: 'status', state: 'unavailable', via: 'hub'});
});

test('the witness credits only tabs linked by their own ids on one shared hub', async () => {
  const {sharedTabsVerdict} = await import('../agent-vantage-witness-checks.mjs');
  const on = (id, hub = 'hub-1') => ({id, connected: true, hub});
  assert.equal(sharedTabsVerdict({tabIds: ['p1', 'p2'], freshId: 'p3', pages: [on('p1'), on('p2'), on('p3'), on('main', null)]}).ok, true);
  assert.equal(sharedTabsVerdict({tabIds: ['p1', 'p2'], freshId: 'p3', pages: [on('p1'), on('p3'), on('other')]}).ok, false, 'another page cannot stand in for a tab');
  assert.equal(sharedTabsVerdict({tabIds: ['p1', 'p2'], freshId: 'p3', pages: [on('p1'), on('p2', null), on('p3')]}).ok, false, 'a tab on its own stream is not the hub');
  assert.equal(sharedTabsVerdict({tabIds: ['p1'], freshId: null, pages: [on('p1')]}).ok, false);
});
