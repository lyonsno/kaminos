// A node:test reporter that writes one JSON object per line with the facts
// tools/test-runner.mjs signs failures by: the failing test's suite path, how
// it failed, and the thrown error's own name, message and, for generated
// assertion messages, the assertion itself. Node passes this module the raw
// event stream when a test file runs with
//   --test-reporter=<this module>  --test-reporter-destination=<file>
//
// The first line is a header naming the writing process. Every line carries
// the same process id, and the last lines are the summary. The runner treats
// a file with any other shape as unsigned: a forked child or worker that
// inherits these flags reopens the same destination and clobbers it, and the
// runner must notice rather than trust what survives.
//
// The suite path comes from test:start events, which arrive parent first;
// completion events arrive child first, so nesting alone is not enough.

import { inspect } from 'node:util';
import { threadId } from 'node:worker_threads';

const stamp = { pid: process.pid, tid: threadId };

export default async function* reporter(source) {
  yield `${JSON.stringify({ kind: 'header', ...stamp, file: process.env.KAMINOS_TEST_RUNNER_TEST || null, argv1: process.argv[1] || null })}\n`;
  const stack = [];
  for await (const event of source) {
    const data = event.data || {};
    if (event.type === 'test:start') {
      stack.length = data.nesting;
      stack[data.nesting] = data.name;
      continue;
    }
    if (event.type === 'test:fail') {
      yield `${JSON.stringify({ kind: 'fail', ...stamp, ...describeFailure(data, stack) })}\n`;
      continue;
    }
    if (event.type === 'test:diagnostic' && /^Error\b/.test(String(data.message || ''))) {
      yield `${JSON.stringify({ kind: 'uncaught', ...stamp, message: String(data.message) })}\n`;
      continue;
    }
    if (event.type === 'test:diagnostic' && /^(tests|fail|pass|cancelled) \d+$/.test(String(data.message || ''))) {
      yield `${JSON.stringify({ kind: 'summary', ...stamp, message: String(data.message) })}\n`;
    }
  }
}

function describeFailure(data, stack) {
  const parents = stack.slice(0, data.nesting).filter(Boolean);
  const out = {
    path: [...parents, data.name].join(' › '),
    failureType: null,
    wrapper: null,
    error: null,
    todo: Boolean(data.todo),
    skip: Boolean(data.skip),
  };
  try {
    const wrapper = data.details?.error;
    out.failureType = wrapper?.failureType || null;
    out.wrapper = safeString(wrapper?.message);
    const cause = wrapper && 'cause' in wrapper ? wrapper.cause : wrapper;
    out.error = describeError(cause);
  } catch (error) {
    out.error = { name: 'reporter-error', message: safeString(error?.message || error), detail: null };
  }
  return out;
}

function describeError(cause) {
  if (cause === undefined) return null;
  if (cause === null || typeof cause !== 'object') return { name: 'non-error', message: safeString(cause), detail: null };
  const name = typeof cause.name === 'string' ? cause.name : 'non-error';
  const message = 'message' in cause ? safeString(cause.message) : safeInspect(cause);
  return { name, message, detail: assertionDetail(cause) };
}

// For an assertion whose message Node generated, the first line is generic
// and the distinguishing fact is the assertion: its operator and, bounded,
// the values it compared, or the asserted expression for assert.ok.
function assertionDetail(cause) {
  if (cause.code !== 'ERR_ASSERTION' || !cause.generatedMessage) return null;
  const operator = String(cause.operator || 'assert');
  if (operator === '==' || operator === 'ok') {
    const expression = String(cause.message || '').split('\n').map(l => l.trim()).filter(Boolean)[1];
    return expression ? `${operator} ${expression}` : operator;
  }
  if (operator === 'match' || operator === 'doesNotMatch') return `${operator} expected=${short(cause.expected)}`;
  return `${operator} actual=${short(cause.actual)} expected=${short(cause.expected)}`;
}

function short(value) {
  const text = safeInspect(value, { depth: 1, breakLength: Infinity, compact: true, maxStringLength: 60, maxArrayLength: 4, sorted: true });
  return text.length > 100 ? `${text.slice(0, 97)}...` : text;
}

function safeString(value) {
  try { return String(value); } catch { return safeInspect(value); }
}

function safeInspect(value, options = { depth: 1, breakLength: Infinity, compact: true, maxStringLength: 60 }) {
  try { return inspect(value, options); } catch { return '[uninspectable]'; }
}
