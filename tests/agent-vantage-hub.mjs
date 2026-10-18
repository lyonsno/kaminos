// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';

// The hub runs in a shared worker; here it gets a fake environment: one
// EventSource it may open, fetch, timers and a clock the test drives.
async function hubHarness({pages = {ok: true, hub: true}, pagesStatus = 200, pagesBody = null, joinStatus = () => 200, pagesAnswers = null, joinAnswer = null} = {}) {
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
      if (String(url).endsWith('/pages')) {
        const next = pagesAnswers?.shift();
        if (next) return {status: next.status, ok: next.status === 200, json: next.unreadable ? async () => { throw new SyntaxError('not JSON'); } : async () => next.body};
        return {status: pagesStatus, ok: pagesStatus === 200, json: pagesBody ?? (async () => pages)};
      }
      if (String(url).endsWith('/join') && joinAnswer) return joinAnswer();
      if (String(url).endsWith('/join')) {
        const status = joinStatus();
        if (status === 'reject') throw new Error('network');
        return {status, ok: status === 200, json: async () => ({ok: status === 200})};
      }
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
  assert.ok(h.posts.some(post => post.url === '/api/vantage/reply' && post.body.page === 'page-gone' && post.body.id === 'c2' && post.body.ok === false && post.body.phase === 'disconnected'),
    'a command for a tab the hub no longer has fails, saying so');
  assert.ok(!h.posts.some(post => post.url === '/api/vantage/leave' && post.body.page === 'page-gone'), 'without a leave that could remove a newer membership of that page');
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

test('tabs joining while the server is still being asked share the one stream that results', async () => {
  const waiting = [], release = () => waiting.splice(0).forEach(resolve => resolve({ok: true, hub: true}));
  const h = await hubHarness({pagesBody: () => new Promise(resolve => waiting.push(resolve))});
  const a = h.port(), b = h.port();
  a.say({type: 'join', endpoint: '/api/vantage', page: 'page-a', facts: facts('page-a')}); await h.settle();
  b.say({type: 'join', endpoint: '/api/vantage', page: 'page-b', facts: facts('page-b')}); await h.settle();
  release(); await h.settle();
  assert.equal(h.sources.length, 1, 'one stream, never two for the same hub');
});

test('a join the server did not accept is retried, and the tab is told it is linked only once it is', async () => {
  const answers = ['reject', 503, 200];
  const h = await hubHarness({joinStatus: () => answers.shift() ?? 200}), a = h.port();
  a.say({type: 'join', endpoint: '/api/vantage', page: 'page-a', facts: facts('page-a')}); await h.settle();
  h.sources[0].emit('open'); await h.settle();
  assert.ok(!a.sent.some(message => message.type === 'status' && message.state === 'linked'), 'not linked while the server has not got it');
  const check = h.intervals.find(item => item.ms <= 10000);
  for (let i = 0; i < 2; i++) { h.advance(10000); check.fn(); await h.settle(); a.say({type: 'pong', page: 'page-a'}); }
  assert.equal(h.posts.filter(post => post.url === '/api/vantage/join').length, 3, 'the hub keeps trying while the tab is with it');
  assert.deepEqual(a.sent.filter(message => message.type === 'status').at(-1), {type: 'status', state: 'linked', via: 'hub'});
});

test('a tab dropped after a long pause rejoins as soon as it is heard from again', async () => {
  const h = await hubHarness(), a = h.port();
  a.say({type: 'join', endpoint: '/api/vantage', page: 'page-a', facts: facts('page-a')}); await h.settle();
  h.sources[0].emit('open'); await h.settle();
  const check = h.intervals.find(item => item.ms <= 10000);
  h.advance(10000); check.fn(); a.say({type: 'pong', page: 'page-a'});
  a.sent.length = 0;
  h.advance(70000); check.fn(); await h.settle();
  assert.ok(h.posts.some(post => post.url === '/api/vantage/leave' && post.body.page === 'page-a'), 'silent past the limit: it leaves');
  assert.deepEqual(a.sent.at(-1), {type: 'ping'}, 'but the hub still asks it, so a paused tab can answer');
  h.posts.length = 0;
  a.say({type: 'pong', page: 'page-a', facts: facts('page-a')}); await h.settle();
  assert.deepEqual(h.posts.filter(post => post.url === '/api/vantage/join').map(post => post.body.page), ['page-a'], 'and its answer joins it again');
});

test('each membership is numbered, so a late leave cannot remove a page that joined again', async () => {
  const h = await hubHarness(), a = h.port();
  a.say({type: 'join', endpoint: '/api/vantage', page: 'page-a', facts: facts('page-a')}); await h.settle();
  h.sources[0].emit('open'); await h.settle();
  a.say({type: 'leave', page: 'page-a'}); await h.settle();
  a.say({type: 'join', endpoint: '/api/vantage', page: 'page-a', facts: facts('page-a')}); await h.settle();
  const joins = h.posts.filter(post => post.url === '/api/vantage/join').map(post => post.body.member);
  const leaves = h.posts.filter(post => post.url === '/api/vantage/leave').map(post => post.body.member);
  assert.equal(leaves.length, 1);
  assert.ok(Number.isInteger(joins[0]) && joins[1] > joins[0], 'a rejoin is a newer membership');
  assert.equal(leaves[0], joins[0], 'the leave names the membership it ends');
});

test('a join answered after the stream dropped does not report the tab linked', async () => {
  for (const terminal of [false, true]) {
    let release;
    const h = await hubHarness({joinAnswer: () => new Promise(resolve => { release = () => resolve({status: 200, ok: true, json: async () => ({ok: true})}); })});
    const a = h.port();
    a.say({type: 'join', endpoint: '/api/vantage', page: 'page-a', facts: facts('page-a')}); await h.settle();
    h.sources[0].emit('open'); await h.settle();
    if (terminal) h.sources[0].readyState = 2;
    h.sources[0].emit('error'); await h.settle();
    release(); await h.settle();
    const statuses = a.sent.filter(message => message.type === 'status').map(message => message.state);
    assert.equal(statuses.at(-1), terminal ? 'offline' : 'reconnecting', `the acknowledgement belonged to the lost connection (${terminal ? 'closed' : 'reconnecting'})`);
  }
});

test('a capability probe that failed is retried, and only a readable answer without the hub means an older server', async () => {
  for (const failed of [{status: 503, body: {error: 'temporary'}}, {status: 200, unreadable: true}]) {
    const h = await hubHarness({pagesAnswers: [failed, {status: 200, body: {hub: true, pages: []}}]}), a = h.port();
    a.say({type: 'join', endpoint: '/api/vantage', page: 'page-a', facts: facts('page-a')}); await h.settle();
    assert.ok(!a.sent.some(message => message.type === 'fallback'), `${failed.status} ${failed.unreadable ? 'unreadable' : ''}: not taken for an older server`);
    assert.equal(h.sources.length, 0);
    assert.ok(h.timeouts.length >= 1, 'the probe is retried');
    h.timeouts.at(-1).fn(); await h.settle();
    assert.equal(h.sources.length, 1, 'and the hub links once the server answers');
  }
});
