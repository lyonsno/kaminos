import fs from 'node:fs/promises';
import path from 'node:path';
import { visualWorkServer } from './visual-work-server.mjs';

// Own process lifetime while leaving page setup, navigation and evidence to the caller.
export async function withVisualWorkSession(options, exercise) {
  const { repoRoot, chromium, executablePath, contextOptions = {} } = options;
  if (!options.out) throw new Error('out is required for the session receipt');
  const out = path.resolve(options.out);
  await fs.mkdir(out, { recursive: true });
  const receipt = { status: 'running', phase: 'arguments', startedAt: new Date().toISOString(),
    requested: { repoRoot, origin: options.origin, executablePath, contextOptions },
    browserClosed: false, cleanupErrors: [] };
  const write = () => fs.writeFile(path.join(out, 'session.json'), JSON.stringify(receipt, null, 2));
  await write();
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
  const interrupted = name => {
    receipt.signal = name;
    controller.abort(new Error(`Visual work cancelled by ${name}`));
  };
  const onTerm = () => interrupted('SIGTERM'), onInt = () => interrupted('SIGINT');
  process.on('SIGTERM', onTerm);
  process.on('SIGINT', onInt);
  let context, server, closing, result, failure;
  const close = () => closing ??= (async () => {
    try {
      if (context) { await context.close(); receipt.browserClosed = true; }
    } catch (error) { receipt.cleanupErrors.push(String(error)); }
    try { await server?.close(); }
    catch (error) { receipt.cleanupErrors.push(String(error)); }
  })();
  const onAbort = () => {
    // Startup is awaited below before cleanup, so late-created children stay owned.
    if (receipt.phase === 'exercise') void close();
  };
  signal.addEventListener('abort', onAbort);
  try {
    if (!repoRoot) throw new Error('repoRoot is required');
    if (typeof exercise !== 'function') throw new Error('exercise callback is required');
    signal.throwIfAborted();
    let origin = options.origin;
    if (origin) {
      if (options.python || options.assets || options.generatedMeshes) {
        throw new Error('Configure borrowed host mounts at its source');
      }
      receipt.server = { owned: false, origin };
    } else {
      if (!options.sceneStore) throw new Error('sceneStore is required for an owned server');
      server = visualWorkServer({ ...options, out, signal });
      receipt.server = server.receipt;
      receipt.phase = 'server-start';
      await write();
      origin = await server.start();
    }
    signal.throwIfAborted();
    receipt.phase = 'browser-start';
    receipt.executable = await fs.realpath(executablePath);
    if (/Google Chrome\.app\//.test(receipt.executable)) {
      throw new Error('Use independent Chrome for Testing or Chromium');
    }
    receipt.profile = await fs.mkdtemp(path.join(out, 'browser-profile-'));
    const args = [...(contextOptions.args || []),
      '--use-mock-keychain', '--password-store=basic', '--enable-unsafe-webgpu', '--use-angle=metal'];
    receipt.contextOptions = { ...contextOptions, headless: true, executablePath: receipt.executable, args };
    await write();
    context = await chromium.launchPersistentContext(receipt.profile, receipt.contextOptions);
    receipt.browserVersion = context.browser()?.version();
    signal.throwIfAborted();
    receipt.phase = 'exercise';
    await write();
    signal.throwIfAborted();
    result = await exercise({ context, page: context.pages()[0] || await context.newPage(),
      origin, signal, receipt });
    signal.throwIfAborted();
    receipt.status = 'completed';
  } catch (error) {
    failure = signal.aborted ? signal.reason : error;
    receipt.status = signal.aborted ? 'cancelled' : 'failed';
    receipt.failure = failure?.stack || String(failure);
  } finally {
    await close();
    process.off('SIGTERM', onTerm);
    process.off('SIGINT', onInt);
    signal.removeEventListener('abort', onAbort);
    if (signal.aborted && !failure) {
      failure = signal.reason;
      receipt.status = 'cancelled';
      receipt.failure = failure?.stack || String(failure);
    }
    if (receipt.cleanupErrors.length) {
      receipt.status = 'failed';
      failure ||= new Error(receipt.cleanupErrors.join('; '));
    }
    receipt.finishedAt = new Date().toISOString();
    await write();
  }
  if (failure) throw failure;
  return result;
}
