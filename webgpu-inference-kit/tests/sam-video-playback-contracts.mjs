// kaminos-test: node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as vm from 'node:vm';
if (!vm.SourceTextModule) {
  const run = spawnSync(process.execPath, ['--experimental-vm-modules', fileURLToPath(import.meta.url)], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  console.log(run.stdout.trim());
} else {
  const context = vm.createContext({ DOMException });
  const module = new vm.SourceTextModule(await readFile(new URL('../examples/sam-video.mjs', import.meta.url), 'utf8'), { context });
  const exports = ['createWebGpuInferenceSession', 'createWebGpuForegroundService', 'requestBrowserWebGpuDevice', 'createSam31VideoTracker', 'createSam31LiveLoop', 'createSamVideoPreview'];
  await module.link(() => new vm.SyntheticModule(exports, function () { for (const name of exports) this.setExport(name, () => {}); }, { context }));
  await module.evaluate();
  const advance = module.namespace.advanceSamVideoFrame;
  assert.equal(typeof advance, 'function', 'uploaded video needs completion-paced frame advancement');
  function video() {
    let next = 0;
    const callbacks = new Map(), listeners = new Map();
    return { paused: true, ended: false, currentTime: 0,
      async play() { this.paused = false; }, pause() { this.paused = true; },
      requestVideoFrameCallback(fn) { callbacks.set(++next, fn); return next; },
      cancelVideoFrameCallback(id) { callbacks.delete(id); },
      addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener(name) { listeners.delete(name); },
      frame(time) { this.currentTime = time; const pending = [...callbacks.values()]; callbacks.clear(); for (const fn of pending) fn(0, { mediaTime: time }); },
      end() { this.ended = true; listeners.get('ended')?.(); },
      get pending() { return callbacks.size + listeners.size; },
    };
  }
  const clip = video();
  let completed = false;
  const frame = advance(clip, { afterTime: 0 }).then(value => { completed = true; return value; });
  clip.frame(0); await Promise.resolve();
  assert.equal(completed, false, 'a callback for the seed frame is not a successor');
  clip.frame(1 / 30);
  assert.equal(await frame, true);
  assert.equal(clip.paused, true, 'clip cannot run ahead during inference or seed authoring');
  assert.equal(clip.pending, 0);
  const controller = new AbortController();
  const cancelled = advance(clip, { afterTime: 1 / 30, signal: controller.signal });
  controller.abort('stopped');
  await assert.rejects(cancelled, { name: 'AbortError' });
  assert.equal(clip.paused, true); assert.equal(clip.pending, 0);
  const ended = advance(clip, { afterTime: 1 / 30 }); clip.end();
  assert.equal(await ended, false, 'end of clip is normal completion, not a missing learned frame');
  assert.equal(clip.paused, true); assert.equal(clip.pending, 0);
  console.log('Uploaded video advances one distinct decoded frame, pauses during inference, and cleans up stop/end callbacks');
}
