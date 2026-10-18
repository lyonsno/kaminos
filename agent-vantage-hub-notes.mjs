// The notes channel of the shared vantage hub (agent-vantage-hub.mjs): one notes
// stream per browser and Kaminos server, shared by every tab that shows notes,
// instead of a stream per tab. A browser keeps few connections to one host (six
// over HTTP/1.1), so a stream per tab lets open tabs stop the next page loading.
//
// Tabs speak to the hub over the same shared worker as the vantage link:
//   tab -> hub  {type: 'subscribe', channel: 'notes', endpoint, page, after}
//               {type: 'unsubscribe', channel: 'notes', page}  {type: 'pong', channel: 'notes', page}
//   hub -> tab  {type: 'channel', channel: 'notes', event, data}   the notes stream's events, parsed
//               {type: 'resync', channel: 'notes'}                 events may have been missed: catch up
//               {type: 'fallback', channel: 'notes'}               the server has no hub stream: use your own
//               {type: 'status', channel: 'notes', state}          'unavailable': this server has no notes
//               {type: 'ping'}
// The hub keeps no backlog: a tab catches up itself with GET <endpoint>?after=<seq>.
//
// Server side (the notes owner's): GET <endpoint>?after=<n> answers `hub: true`
// and `lastSeq` when the server streams notes to a hub at
// <endpoint>/stream?hub=<id>&after=<seq>; POST <endpoint>/presence {hub, pages}
// says which pages the hub carries, on every change and every check.

export const HUB_CHANNEL_EVENTS = Object.freeze(['events', 'presence']);
const RETRY_MS = 5000;
const PROBE_AFTER = Number.MAX_SAFE_INTEGER;

// Worker side: the notes channel inside the hub.
export function createHubNotesChannel({EventSource, fetch, now, hubId, setTimeout, silenceMs, tell}) {
  const subscribers = new Map();   // port -> {page, seen}
  let endpoint = null, source = null, probing = false, mode = null, highest = null, reported = null;
  const post = (path, body) => fetch(endpoint + path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)}).catch(() => null);
  const say = (port, message) => tell(port, {...message, channel: 'notes'});
  const sayAll = message => { for (const port of subscribers.keys()) say(port, message); };
  const linked = () => source?.readyState === 1;
  const pages = () => [...new Set([...subscribers.values()].map(item => item.page))].sort();

  // The set of pages this hub carries, sent when it changes; `again` repeats it as a heartbeat.
  function report(again = false) {
    if (!linked()) return;
    const set = pages(), key = JSON.stringify(set);
    if (!again && key === reported) return;
    reported = key;
    post('/presence', {hub: hubId, pages: set}).then(response => { if (!response?.ok && reported === key) reported = null; });
  }

  function probe() {
    if (probing || source || !endpoint || mode === 'fallback' || mode === 'unavailable' || !subscribers.size) return;
    probing = true;
    fetch(`${endpoint}?after=${PROBE_AFTER}`).then(async response => {
      if (response.status === 404) { mode = 'unavailable'; sayAll({type: 'status', state: 'unavailable'}); return; }
      if (!response.ok) throw new Error(`notes answered ${response.status}`);
      const body = await response.json();
      if (!body || typeof body !== 'object') throw new Error('notes answered without an object');
      // An older server: each tab keeps its own stream.
      if (body.hub !== true) { mode = 'fallback'; sayAll({type: 'fallback'}); return; }
      // Start where the server is now; tabs catch up from their own position.
      highest ??= Number.isInteger(body.lastSeq) && body.lastSeq >= 0 ? body.lastSeq : 0;
      open();
    }).catch(() => setTimeout(probe, RETRY_MS)).finally(() => { probing = false; });
  }

  function open() {
    if (source || !subscribers.size) return;
    source = new EventSource(`${endpoint}/stream?hub=${encodeURIComponent(hubId)}&after=${highest}`);
    source.addEventListener('open', () => { mode = 'hub'; reported = null; report(); });
    for (const event of HUB_CHANNEL_EVENTS) {
      source.addEventListener(event, message => {
        let data;
        try { data = JSON.parse(message.data); } catch { return; }
        if (event === 'events') {
          const seq = Number(message.lastEventId) || Math.max(0, ...(data?.events ?? []).map(item => Number(item?.seq) || 0));
          if (seq > highest) highest = seq;
        }
        sayAll({type: 'channel', event, data});
      });
    }
    source.addEventListener('error', () => {
      if (source.readyState !== EventSource.CLOSED) return;
      source = null;
      setTimeout(probe, RETRY_MS);
    });
  }

  function close() {
    source?.close();
    source = null;
    reported = null;
  }

  function join(port, page, catchUp) {
    subscribers.set(port, {page, seen: now()});
    if (mode === 'fallback') return say(port, {type: 'fallback'});
    if (mode === 'unavailable') return say(port, {type: 'status', state: 'unavailable'});
    if (catchUp) say(port, {type: 'resync'});
    if (source) report();
    else probe();
  }

  return {
    receive(port, data) {
      if (typeof data.page !== 'string') return;
      if (data.type === 'subscribe') {
        endpoint ??= typeof data.endpoint === 'string' ? data.endpoint : null;
        join(port, data.page, false);
      } else if (data.type === 'pong') {
        const subscriber = subscribers.get(port);
        // A tab the hub dropped for silence: carried again, and told it may have missed events.
        if (!subscriber) { if (endpoint) join(port, data.page, true); return; }
        subscriber.seen = now();
      } else if (data.type === 'unsubscribe') {
        if (!subscribers.delete(port)) return;
        if (!subscribers.size) close();
        else report();
      }
    },
    check() {
      let changed = false;
      for (const [port, subscriber] of [...subscribers]) {
        if (now() - subscriber.seen > silenceMs) { subscribers.delete(port); changed = true; }
        tell(port, {type: 'ping'});
      }
      if (changed && !subscribers.size) close();
      else report(true);
    },
    state: () => ({mode, linked: linked(), seq: highest, pages: pages()}),
  };
}

// Page side: subscribe to a hub channel. Returns null without shared workers, so
// the caller keeps its own stream; `onFallback` says the same later, when the
// hub finds the server has no hub stream. Events reach `onEvent(event, data)`
// once each and in order: the page catches up with GET <endpoint>?after=<seq>
// on subscribing and whenever the hub says it may have missed events.
export function subscribeHubChannel({window, channel, endpoint, page, after = 0, onEvent, onFallback = () => {}, onStatus = () => {},
  hubUrl = new URL('./agent-vantage-hub-worker.mjs', import.meta.url)}) {
  if (!window.SharedWorker || !hubUrl) return null;
  let port;
  try { port = new window.SharedWorker(hubUrl, {type: 'module', name: 'kaminos-vantage-hub'}).port; }
  catch { return null; }
  let last = Number.isInteger(after) && after >= 0 ? after : 0, catching = null, held = [], closed = false;
  const deliver = events => {
    const fresh = events.filter(item => Number(item?.seq) > last).sort((a, b) => a.seq - b.seq);
    if (!fresh.length) return;
    last = fresh.at(-1).seq;
    onEvent('events', {events: fresh});
  };
  // Live events wait while a catch-up is answering, then are delivered after it.
  function catchUp() {
    const from = last;
    catching = window.fetch(`${endpoint}?after=${from}`).then(response => (response.ok ? response.json() : null)).catch(() => null).then(body => {
      if (Array.isArray(body?.events)) deliver(body.events);
    }).finally(() => {
      catching = null;
      const waiting = held;
      held = [];
      deliver(waiting);
    });
  }
  const subscribe = () => { port.postMessage({type: 'subscribe', channel, endpoint, page, after: last}); catchUp(); };
  const unsubscribe = () => port.postMessage({type: 'unsubscribe', channel, page});
  port.onmessage = message => {
    const data = message.data ?? {};
    if (data.type === 'ping') return port.postMessage({type: 'pong', channel, page});
    if (data.channel !== channel || closed) return;
    if (data.type === 'channel') {
      if (data.event !== 'events') return onEvent(data.event, data.data);
      const events = Array.isArray(data.data?.events) ? data.data.events : [];
      if (catching) held.push(...events);
      else deliver(events);
    } else if (data.type === 'resync') catchUp();
    else if (data.type === 'fallback') { unsubscribe(); closed = true; onFallback(); }
    else if (data.type === 'status') onStatus({state: data.state, via: 'hub'});
  };
  port.start?.();
  window.addEventListener('pagehide', unsubscribe);
  window.addEventListener('pageshow', subscribe);
  // Spoken unasked as well, so a hub that dropped this tab after a pause hears it again.
  const heartbeat = window.setInterval(() => port.postMessage({type: 'pong', channel, page}), 15000);
  subscribe();
  return {
    lastSeq: () => last,
    close() {
      if (closed) return;
      closed = true;
      unsubscribe();
      window.removeEventListener('pagehide', unsubscribe);
      window.removeEventListener('pageshow', subscribe);
      window.clearInterval(heartbeat);
    },
  };
}
