// Preloaded into every Node test the runner spawns (--import). At exit it
// writes one synchronous line to the test's output saying which process is
// exiting, with what code, and whether the node:test framework was loaded.
// The runner uses that line to tell a framework file from a plain script,
// which the reporter cannot do: a file that calls process.exit before the
// reporter pipeline starts leaves no events and no reporter output at all.
// Forked children and workers inherit this preload and write their own line
// with their own process id; the runner matches the id it spawned.

import { writeSync } from 'node:fs';
import { threadId } from 'node:worker_threads';

process.on('exit', code => {
  const framework = process.moduleLoadList.includes('NativeModule internal/test_runner/harness');
  try { writeSync(1, `kaminos-test-exit pid=${process.pid} tid=${threadId} framework=${framework ? 'yes' : 'no'} code=${code}\n`); } catch {}
});
