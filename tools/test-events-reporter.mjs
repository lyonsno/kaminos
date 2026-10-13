// A node:test reporter that writes one JSON object per line with the facts
// tools/test-runner.mjs signs failures by: the failing test's suite path, how
// it failed, and the thrown error's own name and message. Node passes this
// module the raw event stream when a test file runs with
//   --test-reporter=./tools/test-events-reporter.mjs
//   --test-reporter-destination=<file>
// The suite path comes from test:start events, which arrive parent first;
// completion events arrive child first, so nesting alone is not enough.

export default async function* reporter(source) {
  const stack = [];
  for await (const event of source) {
    const data = event.data || {};
    if (event.type === 'test:start') {
      stack.length = data.nesting;
      stack[data.nesting] = data.name;
      continue;
    }
    if (event.type === 'test:fail') {
      const error = data.details?.error;
      const cause = error?.cause ?? error;
      yield `${JSON.stringify({
        kind: 'fail',
        path: pathOf(stack, data.nesting, data.name),
        failureType: error?.failureType || null,
        wrapper: error?.message || null,
        error: cause ? { name: cause.name || null, message: String(cause.message ?? cause) } : null,
        line: data.line ?? null,
      })}\n`;
      continue;
    }
    if (event.type === 'test:diagnostic' && /^Error\b/.test(String(data.message || ''))) {
      yield `${JSON.stringify({ kind: 'uncaught', message: String(data.message) })}\n`;
      continue;
    }
    if (event.type === 'test:diagnostic' && /^(tests|fail|pass|cancelled) \d+$/.test(String(data.message || ''))) {
      yield `${JSON.stringify({ kind: 'summary', message: String(data.message) })}\n`;
    }
  }
}

function pathOf(stack, nesting, name) {
  const parents = stack.slice(0, nesting).filter(Boolean);
  return [...parents, name].join(' › ');
}
