// The vantage hub: one stream to the server for every Kaminos tab of a
// browser on that server, held by a shared worker (agent-vantage-hub-worker.mjs).
// A browser keeps few connections to one host (six over HTTP/1.1); a stream
// per tab would let open tabs stop the next page from loading. Tabs stay
// linked whether shown or hidden.
//
// Tabs speak to the hub over MessagePorts:
//   tab -> hub  {type: 'join', endpoint, page, facts}  {type: 'leave', page}  {type: 'pong', page}
//   hub -> tab  {type: 'command', page, message}  {type: 'status', state, via}  {type: 'fallback'}  {type: 'ping'}
// Commands arrive on the hub stream naming their page and go to that tab only.
// Tabs answer the server themselves (POST /reply).

// A tab that has not answered the hub for this long has gone (closed without
// saying so, or frozen); its page leaves, and it joins again if it answers later.
// Messages reach hidden tabs unthrottled, so a live tab answers well within it.
export const HUB_SILENCE_MS = 60000;
export const HUB_CHECK_MS = 10000;
const RETRY_MS = 5000;

export function createVantageHub({EventSource, fetch, now, hubId, setInterval, setTimeout}) {
  const tabs = new Map();   // port -> {page, facts, seen}
  let endpoint = null, source = null, probing = false, mode = null;   // mode: null | 'hub' | 'fallback' | 'unavailable'
  const post = (path, body) => fetch(endpoint + path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)}).catch(() => null);
  const tell = (port, message) => { try { port.postMessage(message); } catch { /* the tab is gone */ } };
  const tellAll = message => { for (const port of tabs.keys()) tell(port, message); };
  const linked = () => source?.readyState === 1;
  const join = tab => post('/join', {hub: hubId, ...tab.facts, page: tab.page});
  const leave = page => post('/leave', {hub: hubId, page});
  const portOf = page => [...tabs].find(([, tab]) => tab.page === page)?.[0];

  function probe() {
    if (probing || source || !endpoint || mode === 'fallback' || mode === 'unavailable') return;
    probing = true;
    fetch(`${endpoint}/pages`).then(async response => {
      probing = false;
      // A server without the vantage bridge: nothing to link to.
      if (response.status === 404) { mode = 'unavailable'; tellAll({type: 'status', state: 'unavailable', via: 'hub'}); return; }
      const body = await response.json().catch(() => null);
      // An older server without the hub: each tab links on its own.
      if (body?.hub !== true) { mode = 'fallback'; tellAll({type: 'fallback'}); return; }
      open();
    }, () => { probing = false; setTimeout(probe, RETRY_MS); });
  }

  function open() {
    source = new EventSource(`${endpoint}/hub?hub=${encodeURIComponent(hubId)}`);
    // On every (re)connection the server's hub starts empty: every tab joins again.
    source.addEventListener('open', () => {
      mode = 'hub';
      for (const tab of tabs.values()) join(tab);
      tellAll({type: 'status', state: 'linked', via: 'hub'});
    });
    source.addEventListener('command', event => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      const port = portOf(message.page);
      if (port) tell(port, {type: 'command', page: message.page, message});
      else leave(message.page);
    });
    source.addEventListener('error', () => {
      if (source.readyState !== EventSource.CLOSED) { tellAll({type: 'status', state: 'reconnecting', via: 'hub'}); return; }
      source = null;
      tellAll({type: 'status', state: 'offline', via: 'hub'});
      setTimeout(probe, RETRY_MS);
    });
  }

  function receive(port, data) {
    if (!data || typeof data !== 'object') return;
    if (data.type === 'join' || (data.type === 'pong' && !tabs.has(port))) {
      if (typeof data.page !== 'string') return;
      endpoint ??= data.endpoint ?? null;
      const tab = {page: data.page, facts: data.facts ?? {page: data.page}, seen: now()};
      tabs.set(port, tab);
      if (mode === 'fallback') return tell(port, {type: 'fallback'});
      if (mode === 'unavailable') return tell(port, {type: 'status', state: 'unavailable', via: 'hub'});
      if (linked()) { join(tab); tell(port, {type: 'status', state: 'linked', via: 'hub'}); }
      else probe();
    } else if (data.type === 'pong') {
      tabs.get(port).seen = now();
    } else if (data.type === 'leave') {
      const tab = tabs.get(port);
      if (!tab) return;
      tabs.delete(port);
      if (linked()) leave(tab.page);
    }
  }

  setInterval(() => {
    for (const [port, tab] of [...tabs]) {
      if (now() - tab.seen > HUB_SILENCE_MS) {
        tabs.delete(port);
        if (linked()) leave(tab.page);
      } else tell(port, {type: 'ping'});
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
