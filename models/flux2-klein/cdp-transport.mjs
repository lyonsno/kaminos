// Shared CDP request/event transport. It owns no browser or request timeout.
export function createCdpTransport(socket, onEvent = () => {}) {
  let id = 0, failure; const pending = new Map();
  const fail = error => { failure ??= error; for (const call of pending.values()) call.reject(failure); pending.clear(); };
  socket.addEventListener('close', event => fail(new Error(`CDP WebSocket closed: ${event.code ?? 'unknown'}`)));
  socket.addEventListener('error', () => fail(new Error('CDP WebSocket error')));
  socket.addEventListener('message', event => {
    let message;
    try { message = JSON.parse(event.data); } catch (error) { fail(new Error('invalid CDP JSON: ' + error.message)); return; }
    if (message.id && pending.has(message.id)) {
      const call = pending.get(message.id); pending.delete(message.id);
      if (message.error) call.reject(new Error(`CDP ${call.method}: ${message.error.message ?? JSON.stringify(message.error)}`));
      else call.resolve(message);
    }
    else onEvent(message);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    if (failure) { reject(failure); return; }
    const n = ++id; pending.set(n, { resolve, reject, method });
    try { socket.send(JSON.stringify({ id: n, method, params })); } catch (error) { pending.delete(n); reject(error); }
  });
  return { send };
}
