// The vantage hub: one stream to the server for every Kaminos tab of a
// browser on that server, held by a shared worker (agent-vantage-hub-worker.mjs).
// A browser keeps few connections to one host (six over HTTP/1.1); a stream
// per tab would let open tabs stop the next page from loading. Tabs stay
// linked whether shown or hidden.
//
// Tabs speak to the hub over MessagePorts:
//   tab -> hub  {type: 'join', endpoint, page, facts}  {type: 'leave', page}  {type: 'pong', page, facts?}
//   hub -> tab  {type: 'command', page, message}  {type: 'status', state, via}  {type: 'fallback'}  {type: 'ping'}
// Commands arrive on the hub stream naming their page and go to that tab only.
// Tabs answer the server themselves (POST /reply).
//
// Each join is a numbered membership: the server keeps a page's newest, so a
// late leave or older join cannot undo it. A tab counts as joined only once the
// server accepted it; until then the hub retries on every check. A tab dropped
// for silence is still asked, and its answer, or its own heartbeat pong, joins
// it again.

// A tab that has not answered the hub for this long has gone (closed without
// saying so, or frozen); its page leaves, and it joins again if it answers later.
// Messages reach hidden tabs unthrottled, so a live tab answers well within it.
export const HUB_SILENCE_MS = 60000;
export const HUB_CHECK_MS = 10000;
const RETRY_MS = 5000;

export function createVantageHub({EventSource, fetch, now, hubId, setInterval, setTimeout}) {
  const tabs = new Map();   // port -> {page, facts, seen, member, joined}
  let endpoint = null, source = null, probing = false, mode = null;   // mode: null | 'hub' | 'fallback' | 'unavailable'
  let generation = 0, members = 0;   // generation: which stream connection; members: membership numbers
  const post = (path, body) => fetch(endpoint + path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)}).catch(() => null);
  const tell = (port, message) => { try { port.postMessage(message); } catch { /* the tab is gone */ } };
  const tellAll = message => { for (const port of tabs.keys()) tell(port, message); };
  const linked = () => source?.readyState === 1;
  const leave = (page, member = null) => post('/leave', {hub: hubId, page, member});
  async function join(port, tab) {
    const stream = generation, member = tab.member;
    const response = await post('/join', {hub: hubId, ...tab.facts, page: tab.page, member});
    const accepted = !!response?.ok && (await response.json().catch(() => null))?.ok === true;
    // Left, joined again, or the stream dropped or reconnected meanwhile: this answer is about an older membership.
    if (tabs.get(port) !== tab || tab.member !== member || stream !== generation || !linked()) return;
    tab.joined = accepted;
    if (accepted) tell(port, {type: 'status', state: 'linked', via: 'hub'});
  }
  function register(port, data) {
    const tab = {page: data.page, facts: data.facts ?? {page: data.page}, seen: now(), member: ++members, joined: false};
    tabs.set(port, tab);
    return tab;
  }
  const portOf = page => [...tabs].find(([, tab]) => tab.page === page)?.[0];

  // One probe at a time, held until the stream is installed or the probe failed.
  function probe() {
    if (probing || source || !endpoint || mode === 'fallback' || mode === 'unavailable') return;
    probing = true;
    fetch(`${endpoint}/pages`).then(async response => {
      // A server without the vantage bridge: nothing to link to.
      if (response.status === 404) { mode = 'unavailable'; tellAll({type: 'status', state: 'unavailable', via: 'hub'}); return; }
      // Any other failure, or an unreadable answer, says nothing about the server: ask again.
      if (!response.ok) throw new Error(`vantage pages answered ${response.status}`);
      const body = await response.json();
      if (!body || typeof body !== 'object') throw new Error('vantage pages answered without an object');
      // A readable answer without the hub: an older server, where each tab links on its own.
      if (body.hub !== true) { mode = 'fallback'; tellAll({type: 'fallback'}); return; }
      open();
    }).catch(() => setTimeout(probe, RETRY_MS)).finally(() => { probing = false; });
  }

  function open() {
    if (source) return;
    source = new EventSource(`${endpoint}/hub?hub=${encodeURIComponent(hubId)}`);
    // On every (re)connection the server's hub starts empty: every tab joins again.
    source.addEventListener('open', () => {
      mode = 'hub';
      generation++;
      for (const [port, tab] of tabs) { tab.joined = false; join(port, tab); }
    });
    source.addEventListener('command', event => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      const port = portOf(message.page);
      if (port) return tell(port, {type: 'command', page: message.page, message});
      // The tab has gone from this hub: fail just this command. A leave here could remove a newer membership of the page.
      post('/reply', {page: message.page, id: message.id, ok: false, phase: 'disconnected', error: 'The Kaminos tab was no longer with its browser\'s hub, so the command did not run'});
    });
    source.addEventListener('error', () => {
      // Whatever was acknowledged on the lost connection no longer counts.
      generation++;
      for (const tab of tabs.values()) tab.joined = false;
      if (source.readyState !== EventSource.CLOSED) { tellAll({type: 'status', state: 'reconnecting', via: 'hub'}); return; }
      source = null;
      tellAll({type: 'status', state: 'offline', via: 'hub'});
      setTimeout(probe, RETRY_MS);
    });
  }

  function receive(port, data) {
    if (!data || typeof data !== 'object') return;
    // A join, or an answer from a tab the hub dropped, (re)joins it as a new membership.
    if (data.type === 'join' || (data.type === 'pong' && !tabs.has(port))) {
      if (typeof data.page !== 'string') return;
      endpoint ??= data.endpoint ?? null;
      const tab = register(port, data);
      if (mode === 'fallback') return tell(port, {type: 'fallback'});
      if (mode === 'unavailable') return tell(port, {type: 'status', state: 'unavailable', via: 'hub'});
      if (linked()) join(port, tab);
      else probe();
    } else if (data.type === 'pong') {
      const tab = tabs.get(port);
      tab.seen = now();
      if (data.facts) tab.facts = data.facts;
    } else if (data.type === 'leave') {
      const tab = tabs.get(port);
      if (!tab) return;
      tabs.delete(port);
      if (linked()) leave(tab.page, tab.member);
    }
  }

  setInterval(() => {
    for (const [port, tab] of [...tabs]) {
      if (now() - tab.seen > HUB_SILENCE_MS) {
        tabs.delete(port);
        if (linked()) leave(tab.page, tab.member);
      } else if (linked() && !tab.joined) join(port, tab);
      // Asked even when dropped: a tab that was only paused answers, and joins again.
      tell(port, {type: 'ping'});
    }
  }, HUB_CHECK_MS);

  return {
    connect(port) {
      port.onmessage = event => receive(port, event.data);
      port.start?.();
    },
    state: () => ({hubId, mode, linked: linked(), pages: [...tabs.values()].map(tab => tab.page)}),
  };
}
