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
  // The harness module loads as soon as node:test is imported, even by a
  // file that then fails to load or only uses mocks. The reporter utilities
  // load only when the harness starts running tests, which is what decides
  // whether structured events were ever due.
  const imported = process.moduleLoadList.includes('NativeModule internal/test_runner/harness');
  const started = process.moduleLoadList.includes('NativeModule internal/test_runner/reporter/utils');
  // The leading newline keeps the marker on its own line even after
  // unterminated output such as a progress line.
  try { writeSync(1, `\nkaminos-test-exit pid=${process.pid} tid=${threadId} framework=${imported ? 'yes' : 'no'} tests=${started ? 'started' : 'not-started'} code=${code}\n`); } catch {}
});
