import assert from 'node:assert/strict';
import {
  closeCdpBrowser,
  requestCdp,
} from '../motion-ready-719024-cdp.js';

class FakeWebSocket extends EventTarget {
  sent = [];
  closed = false;

  send(payload) {
    this.sent.push(JSON.parse(payload));
  }

  close() {
    this.closed = true;
  }
}

const requestSocket = new FakeWebSocket();
const pendingRequest = requestCdp(requestSocket, 'Browser.close');
requestSocket.dispatchEvent(new Event('close'));
await assert.rejects(
  pendingRequest,
  /WebSocket closed before Browser\.close responded/,
  'a socket close before the CDP response must settle the pending request',
);

const closeSocket = new FakeWebSocket();
closeSocket.send = function sendAndClose(payload) {
  this.sent.push(JSON.parse(payload));
  queueMicrotask(() => this.dispatchEvent(new Event('close')));
};
const fakeChrome = {
  exitCode: null,
  signalCode: null,
  killedWith: null,
  kill(signal) { this.killedWith = signal; },
};
await closeCdpBrowser(closeSocket, fakeChrome, async () => {});
assert.equal(closeSocket.sent[0]?.method, 'Browser.close');
assert.equal(closeSocket.closed, true, 'teardown closes the local socket after the browser-side close');
assert.equal(fakeChrome.killedWith, 'SIGTERM', 'teardown terminates a browser process that has not reported exit');

const hangingSocket = new FakeWebSocket();
const hangingChrome = {
  exitCode: null,
  signalCode: null,
  killedWith: null,
  kill(signal) { this.killedWith = signal; },
};
const closeResult = await Promise.race([
  closeCdpBrowser(hangingSocket, hangingChrome, async () => {}, 25).then(() => 'closed'),
  new Promise(resolveTimeout => setTimeout(() => resolveTimeout('timed-out'), 100)),
]);
assert.equal(closeResult, 'closed', 'teardown must not wait forever for a silent Browser.close request');
assert.equal(hangingSocket.closed, true, 'bounded teardown still closes the local socket');
assert.equal(hangingChrome.killedWith, 'SIGTERM', 'bounded teardown terminates the browser process');

console.log('motion-ready-719024 CDP lifecycle contracts passed');
