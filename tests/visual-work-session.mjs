// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { withVisualWorkSession } from '../visual-work-session.mjs';

async function fixture(t, overrides = {}) {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'visual-session-'));
  t.after(() => fs.rm(out, { recursive: true, force: true }));
  const state = { launches: [], closes: 0 };
  const page = { url: () => 'about:blank' };
  const context = {
    pages: () => [page],
    browser: () => ({ version: () => 'test-double' }),
    close: async () => { state.closes++; },
  };
  const options = { out, repoRoot: process.cwd(), origin: 'http://borrowed.invalid',
    executablePath: process.execPath, contextOptions: { viewport: { width: 1400, height: 1000 } },
    chromium: { launchPersistentContext: async (...args) => {
      state.launches.push(args); return context;
    } }, ...overrides };
  const receipt = async () => JSON.parse(await fs.readFile(path.join(out, 'session.json')));
  return { options, state, context, page, receipt };
}

test('legacy owner gets an unopened page and retains its viewport and result', async t => {
  const f = await fixture(t);
  const value = await withVisualWorkSession(f.options, async ({ page, origin }) => {
    assert.equal(page, f.page);
    assert.equal(page.url(), 'about:blank');
    assert.equal(origin, f.options.origin);
    return { feature: 'held-water', passed: true };
  });
  assert.deepEqual(value, { feature: 'held-water', passed: true });
  assert.equal(f.state.closes, 1);
  const [profile, launch] = f.state.launches[0];
  assert.ok(profile.startsWith(f.options.out + path.sep));
  assert.deepEqual(launch.viewport, { width: 1400, height: 1000 });
  assert.ok(launch.args.includes('--use-mock-keychain'));
  assert.ok(launch.args.includes('--password-store=basic'));
  const receipt = await f.receipt();
  assert.equal(receipt.status, 'completed');
  assert.equal(receipt.browserClosed, true);
  assert.equal(receipt.server.owned, false);
});

test('owner failure closes only owned browser and preserves exact failure phase', async t => {
  const f = await fixture(t);
  const failure = new Error('held step changed');
  await assert.rejects(withVisualWorkSession(f.options, async () => { throw failure; }), e => e === failure);
  assert.equal(f.state.closes, 1);
  const receipt = await f.receipt();
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.phase, 'exercise');
  assert.match(receipt.failure, /held step changed/);
});

for (const value of [null, undefined, false, 0, '']) {
  test(`falsy owner exception ${JSON.stringify(value)} still rejects after cleanup`, async t => {
    const f = await fixture(t);
    await assert.rejects(withVisualWorkSession(f.options, async () => { throw value; }), e => e === value);
    assert.equal(f.state.closes, 1);
    const receipt = await f.receipt();
    assert.equal(receipt.status, 'failed');
    assert.equal(receipt.failure, String(value));
  });
}

for (const reason of [null, false, 0, '']) {
  test(`falsy cancellation ${JSON.stringify(reason)} cannot return success`, async t => {
    const controller = new AbortController();
    const f = await fixture(t, { signal: controller.signal });
    await assert.rejects(withVisualWorkSession(f.options, async () => {
      controller.abort(reason);
      return 'late success';
    }), e => e === reason);
    assert.equal(f.state.closes, 1);
    const receipt = await f.receipt();
    assert.equal(receipt.status, 'cancelled');
    assert.equal(receipt.failure, String(reason));
  });
}

test('cleanup failure preserves a falsy original exception', async t => {
  const f = await fixture(t);
  f.context.close = async () => { f.state.closes++; throw new Error('browser close failed'); };
  await assert.rejects(withVisualWorkSession(f.options, async () => { throw null; }), e => e === null);
  assert.equal(f.state.closes, 1);
  const receipt = await f.receipt();
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.failure, 'null');
  assert.match(receipt.cleanupErrors.join(' '), /browser close failed/);
});

test('cancelled callback cannot become completed even when it returns normally', async t => {
  const controller = new AbortController();
  const f = await fixture(t, { signal: controller.signal });
  await assert.rejects(withVisualWorkSession(f.options, async () => {
    controller.abort(new Error('operator cancelled'));
    return 'late success';
  }), /operator cancelled/);
  assert.equal(f.state.closes, 1);
  assert.equal((await f.receipt()).status, 'cancelled');
});

test('already cancelled work never launches a browser', async t => {
  const f = await fixture(t, { signal: AbortSignal.abort(new Error('cancelled before launch')) });
  await assert.rejects(withVisualWorkSession(f.options, async () => assert.fail('must not exercise')),
    /cancelled before launch/);
  assert.equal(f.state.launches.length, 0);
  assert.equal((await f.receipt()).status, 'cancelled');
});

test('cleanup failure is retained and fails an otherwise completed callback', async t => {
  const f = await fixture(t);
  f.context.close = async () => { throw new Error('browser close failed'); };
  await assert.rejects(withVisualWorkSession(f.options, async () => 'done'), /browser close failed/);
  const receipt = await f.receipt();
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.browserClosed, false);
  assert.match(receipt.cleanupErrors.join(' '), /browser close failed/);
});

test('owned server startup failure leaves a terminal receipt before browser launch', async t => {
  const f = await fixture(t, { origin: undefined });
  f.options.sceneStore = path.join(f.options.out, 'scenes');
  f.options.python = path.join(f.options.out, 'absent-python');
  await assert.rejects(withVisualWorkSession(f.options, async () => assert.fail('must not exercise')), /ENOENT/);
  const receipt = await f.receipt();
  assert.equal(receipt.phase, 'server-start');
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.server.closed, true);
  assert.equal(f.state.launches.length, 0);
});
