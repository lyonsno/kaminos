export function requestCdp(ws, method, params = {}) {
  const id = ws._nextId = (ws._nextId || 0) + 1;
  return new Promise((resolveRequest, rejectRequest) => {
    const cleanup = () => {
      ws.removeEventListener('message', onMessage);
      ws.removeEventListener('close', onClose);
      ws.removeEventListener('error', onError);
    };
    const settleError = message => {
      cleanup();
      rejectRequest(new Error(message));
    };
    const onMessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      cleanup();
      if (message.error) rejectRequest(new Error(`${method}: ${message.error.message}`));
      else resolveRequest(message.result);
    };
    const onClose = () => settleError(`WebSocket closed before ${method} responded`);
    const onError = () => settleError(`WebSocket failed before ${method} responded`);
    ws.addEventListener('message', onMessage);
    ws.addEventListener('close', onClose);
    ws.addEventListener('error', onError);
    try {
      ws.send(JSON.stringify({ id, method, params }));
    } catch (error) {
      cleanup();
      rejectRequest(error);
    }
  });
}

export async function closeCdpBrowser(ws, chromeProcess, delay) {
  try {
    await requestCdp(ws, 'Browser.close');
  } catch {
    // Browser.close commonly closes the transport before sending its response.
  }
  try { ws.close(); } catch {}
  await delay(250);
  if (chromeProcess?.exitCode == null && chromeProcess?.signalCode == null) chromeProcess.kill('SIGTERM');
}
