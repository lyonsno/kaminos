// Independent headless Chrome for Testing with a minimal CDP client. Refuses
// the GUI Google Chrome app bundle so witnesses never hijack the operator's browser.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

export async function connectCdp(url) {
  const ws = new WebSocket(url), pending = new Map();
  let next = 0, failure = null;
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('CDP connection error')), { once: true });
  });
  const fail = message => {
    failure ??= new Error(message);
    for (const entry of pending.values()) entry.reject(failure);
    pending.clear();
  };
  ws.addEventListener('message', event => {
    const row = JSON.parse(event.data);
    if (!row.id) return;
    const entry = pending.get(row.id);
    pending.delete(row.id);
    if (row.error) entry?.reject(new Error(JSON.stringify(row.error))); else entry?.resolve(row.result);
  });
  ws.addEventListener('close', () => fail('CDP connection closed'));
  return {
    call(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => {
        if (failure) { reject(failure); return; }
        const id = ++next;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    },
    close() { try { ws.close(); } catch {} },
  };
}

export async function launchChrome({ chrome, windowSize = '1400,1000', onExit } = {}) {
  const executable = await fs.realpath(chrome);
  if (/\/Applications\/Google Chrome\.app\//.test(executable)) {
    throw new Error('GUI Google Chrome is not an isolated headless executable');
  }
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'supermat-chrome-'));
  const child = spawn(executable, ['--headless=new', '--enable-unsafe-webgpu', '--remote-debugging-port=0',
    '--use-mock-keychain', '--password-store=basic', '--no-first-run', `--window-size=${windowSize}`,
    `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  child.once('exit', (code, signal) => onExit?.({ code, signal, at: new Date().toISOString() }));
  const close = async () => {
    cdp?.close();
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise(resolve => setTimeout(resolve, 500));
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    await fs.rm(profile, { recursive: true, force: true });
  };
  let cdp = null;
  try {
    const wsUrl = await new Promise((resolve, reject) => {
      let stderr = '';
      child.stderr.on('data', bytes => {
        stderr += bytes.toString();
        const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
        if (match) resolve(match[1]);
      });
      child.once('error', reject);
      child.once('exit', (code, signal) => reject(new Error(`browser exited before CDP: ${code}/${signal}`)));
    });
    cdp = await connectCdp(wsUrl);
    const version = await cdp.call('Browser.getVersion');
    return { cdp, child, executable, version, close };
  } catch (error) {
    await close();
    throw error;
  }
}

// Open a page target and wait until it reports the requested URL as loaded.
export async function openPage(cdp, url, { attempts = 400 } = {}) {
  const { targetId } = await cdp.call('Target.createTarget', { url });
  const { sessionId } = await cdp.call('Target.attachToTarget', { targetId, flatten: true });
  for (let attempt = 0; ; attempt++) {
    const state = await cdp.call('Runtime.evaluate', { expression: '[location.href, document.readyState]', returnByValue: true }, sessionId);
    const [href, readyState] = state.result.value ?? [];
    if (href === url && readyState === 'complete') return sessionId;
    if (attempt > attempts) throw new Error(`page did not load: ${href} ${readyState}`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}
