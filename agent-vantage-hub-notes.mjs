// The notes channel of the shared vantage hub (agent-vantage-hub.mjs): one notes
// stream per browser and Kaminos server, shared by every tab that shows notes,
// instead of a stream per tab. A browser keeps few connections to one host (six
// over HTTP/1.1), so a stream per tab lets open tabs stop the next page loading.
//
// Tabs speak to the hub over the same shared worker as the vantage link:
//   tab -> hub  {type: 'subscribe', channel: 'notes', endpoint, page, after}
//               {type: 'unsubscribe', channel: 'notes', page}  {type: 'pong', channel: 'notes', page}
//   hub -> tab  {type: 'subscribed', channel: 'notes', from}       the live feed begins after `from`: catch up to it
//               {type: 'channel', channel: 'notes', event, data}   the notes stream's events, parsed
//               {type: 'resync', channel: 'notes', from}           events may have been missed: catch up
//               {type: 'fallback', channel: 'notes'}               the server has no hub stream: use your own
//               {type: 'status', channel: 'notes', state}          'unavailable': this server has no notes
//               {type: 'ping'}
// The hub keeps no backlog: a tab catches up itself with GET <endpoint>?after=<seq>.
//
// Server side (the notes owner's): GET <endpoint>?after=<n> answers `hub: true`
// and `lastSeq` when the server streams notes to a hub at
// <endpoint>/stream?hub=<id>&after=<seq>; POST <endpoint>/presence {hub, rev, pages}
// says which pages the hub carries, on every change and every check, one report at
// a time with `rev` rising (a server ignores a lower rev than it has from that hub);
// the empty set is sent when the last page leaves, until the server accepts it.

export const HUB_CHANNEL_EVENTS = Object.freeze(['events', 'presence']);
const RETRY_MS = 5000;
const PROBE_AFTER = Number.MAX_SAFE_INTEGER;

// Worker side: the notes channel inside the hub.
export function createHubNotesChannel({EventSource, fetch, now, hubId, setTimeout, silenceMs, tell}) {
  const subscribers = new Map();   // port -> {page, seen, acknowledged}
  let endpoint = null, source = null, probing = false, mode = null, highest = null;
  const say = (port, message) => tell(port, {...message, channel: 'notes'});
  const sayAll = message => { for (const port of subscribers.keys()) say(port, message); };
  const linked = () => source?.readyState === 1;
  const pages = () => [...new Set([...subscribers.values()].map(item => item.page))].sort();

  // Presence: one report in flight at a time, each numbered higher than the last, so an older
  // set never lands after a newer one. The newest set is what is sent next; a failed report is
  // sent again. When the last page leaves, the empty set is reported until the server hears it.
  let rev = 0, sending = false, wanted = null, heard = null, retryTimer = false;
  function report(again = false) {
    const set = JSON.stringify(pages());
    if (!again && set === heard && !sending) return;
    if (!subscribers.size && heard === set) return;
    wanted = set;
    flush();
  }
  function flush() {
    if (sending || wanted === null || !endpoint) return;
    if (!linked() && wanted !== '[]') return;
    const set = wanted;
    wanted = null;
    sending = true;
    fetch(endpoint + '/presence', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({hub: hubId, rev: ++rev, pages: JSON.parse(set)})}).catch(() => null).then(response => {
      sending = false;
      if (response?.ok) heard = set;
      else if (wanted === null) {
        wanted = set;
        if (!retryTimer) { retryTimer = true; setTimeout(() => { retryTimer = false; flush(); }, RETRY_MS); }
        return;
      }
      flush();
    });
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
      // Start where the server is now; each tab catches up to here itself.
      highest ??= Number.isInteger(body.lastSeq) && body.lastSeq >= 0 ? body.lastSeq : 0;
      open();
    }).catch(() => setTimeout(probe, RETRY_MS)).finally(() => { probing = false; });
  }

  // A subscriber is told where the live feed begins (`from`, the highest event the hub has
  // relayed or started after) only once the stream is open; every later event reaches it live.
  // It catches up from its own position to at least `from`, so no event falls between the two.
  function acknowledge(port) {
    const subscriber = subscribers.get(port);
    if (!subscriber || subscriber.acknowledged || !linked()) return;
    subscriber.acknowledged = true;
    say(port, {type: 'subscribed', from: highest});
  }

  function open() {
    if (source || !subscribers.size) return;
    source = new EventSource(`${endpoint}/stream?hub=${encodeURIComponent(hubId)}&after=${highest}`);
    source.addEventListener('open', () => {
      mode = 'hub';
      for (const port of subscribers.keys()) acknowledge(port);
      report(true);
    });
    for (const event of HUB_CHANNEL_EVENTS) {
      source.addEventListener(event, message => {
        let data;
        try { data = JSON.parse(message.data); } catch { return; }
        if (event === 'events') {
          const seq = Number(message.lastEventId) || Math.max(0, ...(data?.events ?? []).map(item => Number(item?.seq) || 0));
          if (seq > highest) highest = seq;
        }
        for (const [port, subscriber] of subscribers) if (subscriber.acknowledged) say(port, {type: 'channel', event, data});
      });
    }
    source.addEventListener('error', () => {
      if (source.readyState !== EventSource.CLOSED) return;
      // The stream resumes after the highest event relayed, so acknowledged subscribers miss nothing.
      source = null;
      setTimeout(probe, RETRY_MS);
    });
  }

  function close() {
    source?.close();
    source = null;
  }

  function join(port, page, returning) {
    subscribers.set(port, {page, seen: now(), acknowledged: false});
    if (mode === 'fallback') return say(port, {type: 'fallback'});
    if (mode === 'unavailable') return say(port, {type: 'status', state: 'unavailable'});
    if (returning && linked()) {
      // A tab the hub dropped for silence may have missed events: it catches up to here.
      subscribers.get(port).acknowledged = true;
      say(port, {type: 'resync', from: highest});
    } else acknowledge(port);
    if (source) report();
    else probe();
  }

  function leave() {
    if (subscribers.size) return report();
    close();
    report();
  }

  return {
    receive(port, data) {
      if (typeof data.page !== 'string') return;
      if (data.type === 'subscribe') {
        endpoint ??= typeof data.endpoint === 'string' ? data.endpoint : null;
        join(port, data.page, false);
      } else if (data.type === 'pong') {
        const subscriber = subscribers.get(port);
        if (!subscriber) { if (endpoint && mode !== 'fallback' && mode !== 'unavailable') join(port, data.page, true); return; }
        subscriber.seen = now();
      } else if (data.type === 'unsubscribe') {
        if (subscribers.delete(port)) leave();
      }
    },
    check() {
      let dropped = false;
      for (const [port, subscriber] of [...subscribers]) {
        if (now() - subscriber.seen > silenceMs) { subscribers.delete(port); dropped = true; }
        tell(port, {type: 'ping'});
      }
      if (dropped) leave();
      else if (subscribers.size) report(true);
    },
    state: () => ({mode, linked: linked(), seq: highest, pages: pages()}),
  };
}

// Page side: subscribe to a hub channel. Returns null without shared workers, so
// the caller keeps its own stream; `onFallback` says the same later, when the hub
// finds the server has no hub stream. Events reach `onEvent(event, data)` once
// each and in order. The page catches up with GET <endpoint>?after=<seq> only
// after the hub has said where its live feed begins, one catch-up at a time,
// retrying a failed one; live events wait until the page has caught up.
export function subscribeHubChannel({window, channel, endpoint, page, after = 0, onEvent, onFallback = () => {}, onStatus = () => {},
  hubUrl = new URL('./agent-vantage-hub-worker.mjs', import.meta.url)}) {
  if (!window.SharedWorker || !hubUrl) return null;
  let port;
  try { port = new window.SharedWorker(hubUrl, {type: 'module', name: 'kaminos-vantage-hub'}).port; }
  catch { return null; }
  let last = Number.isInteger(after) && after >= 0 ? after : 0, closed = false;
  let catching = false, owed = false, synced = false, held = [], retry = null;
  const deliver = events => {
    const fresh = events.filter(item => Number(item?.seq) > last).sort((a, b) => a.seq - b.seq);
    if (!fresh.length || closed) return;
    last = fresh.at(-1).seq;
    onEvent('events', {events: fresh});
  };
  // One catch-up at a time. A catch-up asked for while one runs is owed and runs next; live
  // events are released only when none is running or owed. A failed one is retried.
  function catchUp() {
    if (closed) return;
    if (catching) { owed = true; return; }
    catching = true;
    synced = false;
    window.fetch(`${endpoint}?after=${last}`).then(response => (response.ok ? response.json() : Promise.reject(new Error(`notes answered ${response.status}`))))
      .then(body => {
        if (!Array.isArray(body?.events)) throw new Error('notes answered without events');
        deliver(body.events);
        return true;
      }, () => false)
      .catch(() => false)
      .then(ok => {
        catching = false;
        if (closed) return;
        if (!ok) { retry = window.setTimeout(catchUp, 2000); return; }
        if (owed) { owed = false; return catchUp(); }
        synced = true;
        const waiting = held;
        held = [];
        deliver(waiting);
      });
  }
  const subscribe = () => {
    if (closed) return;
    synced = false;
    port.postMessage({type: 'subscribe', channel, endpoint, page, after: last});
  };
  const unsubscribe = () => { if (!closed) port.postMessage({type: 'unsubscribe', channel, page}); };
  const heartbeat = window.setInterval(() => { if (!closed) port.postMessage({type: 'pong', channel, page}); }, 15000);
  // One way out, for close and fallback alike: nothing is sent, answered or delivered afterwards.
  function end() {
    if (closed) return;
    unsubscribe();
    closed = true;
    held = [];
    window.clearTimeout(retry);
    window.clearInterval(heartbeat);
    window.removeEventListener('pagehide', unsubscribe);
    window.removeEventListener('pageshow', subscribe);
    port.onmessage = null;
  }
  port.onmessage = message => {
    const data = message.data ?? {};
    if (closed) return;
    if (data.type === 'ping') return port.postMessage({type: 'pong', channel, page});
    if (data.channel !== channel) return;
    if (data.type === 'subscribed' || data.type === 'resync') catchUp();
    else if (data.type === 'channel') {
      if (data.event !== 'events') return onEvent(data.event, data.data);
      const events = Array.isArray(data.data?.events) ? data.data.events : [];
      if (synced) deliver(events);
      else held.push(...events);
    } else if (data.type === 'fallback') { end(); onFallback(); }
    else if (data.type === 'status') onStatus({state: data.state, via: 'hub'});
  };
  port.start?.();
  window.addEventListener('pagehide', unsubscribe);
  window.addEventListener('pageshow', subscribe);
  subscribe();
  return {lastSeq: () => last, close: end};
}
