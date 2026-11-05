// kaminos-test: node
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCdpTransport } from '../models/flux2-klein/cdp-transport.mjs';
class Socket extends EventTarget {
  requests = [];
  send(text) { this.requests.push(JSON.parse(text)); }
  message(data) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) })); }
}
test('CDP forwards protocol events and resolves the matching request', async () => {
  const socket = new Socket(), events = [], { send } = createCdpTransport(socket, value => events.push(value));
  const request = send('Runtime.evaluate', { expression: '1' });
  socket.message({ method: 'Runtime.consoleAPICalled', params: {} }); socket.message({ id: socket.requests[0].id, result: { value: 1 } });
  assert.deepEqual((await request).result, { value: 1 }); assert.equal(events.length, 1);
});
test('observed CDP close/error events reject parked calls instead of stranding the runner', async () => {
  for (const event of ['close', 'error']) {
    const socket = new Socket(), { send } = createCdpTransport(socket); let outcome = 'parked';
    const request = send('Runtime.evaluate').then(() => { outcome = 'resolved'; }, () => { outcome = 'rejected'; });
    socket.dispatchEvent(new Event(event)); await new Promise(setImmediate); assert.equal(outcome, 'rejected');
    await request; await assert.rejects(send('Runtime.evaluate'), /CDP/);
  }
});
test('CDP protocol errors remain explicit errors rather than undefined results', async () => {
  const socket = new Socket(), { send } = createCdpTransport(socket), request = send('Runtime.evaluate');
  socket.message({ id: socket.requests[0].id, error: { code: -32000, message: 'context destroyed' } });
  await assert.rejects(request, /context destroyed/);
});
