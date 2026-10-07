import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

// Exercise the production client, including the observed closed-socket state,
// without starting a browser or importing the executable runner's main body.
const source = await fs.readFile(new URL('../run-sparse-prefix-witness.mjs', import.meta.url), 'utf8');
const definition = source.slice(source.indexOf('async function connect(url)'), source.indexOf('\ntry {'));
class Socket extends EventTarget {
  static OPEN = 1;
  static CLOSED = 3;
  static latest;
  constructor(url) {
    super(); this.url = url; this.readyState = Socket.OPEN; this.sent = []; Socket.latest = this;
    queueMicrotask(() => this.dispatchEvent(new Event('open')));
  }
  send(text) { if (this.readyState === Socket.OPEN) this.sent.push(JSON.parse(text)); }
  close() { this.readyState = Socket.CLOSED; this.dispatchEvent(new Event('close')); }
}
const connect = new Function('WebSocket', `${definition}\nreturn connect;`)(Socket);
const client = await connect('ws://owned-browser');
const inFlight = client.call('Runtime.evaluate').then(() => 'fulfilled', error => error.message);
Socket.latest.close();
assert.match(await inFlight, /closed/);
let afterClose;
client.call('Browser.close').then(() => { afterClose = 'fulfilled'; }, error => { afterClose = error.message; });
await Promise.resolve(); await Promise.resolve();
assert.match(afterClose || '', /closed/, 'A cleanup call on the observed CLOSED transport must reject rather than wait forever.');
assert.equal(Socket.latest.sent.length, 1, 'Closed transport must not accept another command.');
let lateEvent;
client.once('Page.loadEventFired').then(() => { lateEvent = 'fulfilled'; }, error => { lateEvent = error.message; });
await Promise.resolve(); await Promise.resolve();
assert.match(lateEvent || '', /closed/);

const active = await connect('ws://owned-browser-two');
const event = active.once('Page.loadEventFired').then(() => 'fulfilled', error => error.message);
Socket.latest.close();
assert.match(await event, /closed/, 'Event waiters must also settle on transport closure.');
const errored = await connect('ws://owned-browser-three');
const onError = errored.call('Runtime.evaluate').then(() => 'fulfilled', error => error.message);
Socket.latest.dispatchEvent(new Event('error'));
assert.match(await onError, /error/);
console.log('Observed closed CDP transport cannot strand commands, event waiters, or browser cleanup.');
