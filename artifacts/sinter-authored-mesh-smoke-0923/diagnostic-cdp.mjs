export const CDP_REQUEST_TIMEOUT_MS = 180_000;

export function cdpRequest(ws, method, params = {}, timeoutMs = CDP_REQUEST_TIMEOUT_MS) {
  const id = ws.nextId = (ws.nextId || 0) + 1;
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
      ws.removeEventListener('error', onError);
      ws.removeEventListener('close', onClose);
    };
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(value);
    };
    const onMessage = event => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch (error) {
        finish(new Error(`${method}: invalid DevTools reply: ${error.message}`));
        return;
      }
      if (message.id !== id) return;
      if (message.error) finish(new Error(`${method}: ${message.error.message}`));
      else finish(null, message.result);
    };
    const onError = event => finish(new Error(`${method}: DevTools socket error${event?.message ? `: ${event.message}` : ''}`));
    const onClose = event => finish(new Error(`${method}: DevTools socket closed before a reply${event?.code ? ` (code ${event.code})` : ''}`));
    timer = setTimeout(() => finish(new Error(`${method}: DevTools reply timed out after ${timeoutMs}ms`)), timeoutMs);
    ws.addEventListener('message', onMessage);
    ws.addEventListener('error', onError, { once: true });
    ws.addEventListener('close', onClose, { once: true });
    try {
      ws.send(JSON.stringify({ id, method, params }));
    } catch (error) {
      finish(new Error(`${method}: failed to send DevTools request: ${error.message}`));
    }
  });
}
