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

import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { inspect } from 'node:util';
import { threadId } from 'node:worker_threads';

// Loading this module is the sign that the harness started running tests
// in this process: Node imports reporters when the first test is registered,
// and only then. The preloaded exit hook reads this mark, so the signal does
// not depend on which other reporters run alongside.
globalThis[Symbol.for('kaminos.test-events-reporter')] = true;

const stamp = { pid: process.pid, tid: threadId };
const ROOT = process.env.KAMINOS_TEST_RUNNER_ROOT || process.cwd();
const ROOT_REAL = (() => { try { return realpathSync(ROOT); } catch { return ROOT; } })();
const TEST_FILE = process.env.KAMINOS_TEST_RUNNER_TEST || null;

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
// and the distinguishing fact is the assertion: its operator; the values it
// compared, shown bounded and followed by a hash of the values rendered to a
// much larger bound, so two that differ past the display still differ; or,
// for assert.ok, the asserted expression, with the assertion's location when
// the expression spans lines and Node keeps only its opening. Values are
// rendered by util.inspect as they are, whatever realm or class they come
// from; stack frames are removed from the rendering, so Error values read as
// name and message wherever they sit, and machine-local paths are normalized
// before the display is cut, so the detail reads the same on every machine.
function assertionDetail(cause) {
  if (cause.code !== 'ERR_ASSERTION' || !cause.generatedMessage) return null;
  const operator = String(cause.operator || 'assert');
  const message = String(cause.message || '');
  if (/^The expression evaluated to a falsy value/.test(message)) {
    const expression = message.split('\n').map(l => l.trim()).filter(Boolean)[1] || '';
    const location = /\($/.test(expression) || !expression ? ` at ${assertionLocation(cause)}` : '';
    return `${operator} ${expression}${location}`.trim();
  }
  if (operator === 'match' || operator === 'doesNotMatch') return `${operator} expected=${short(cause.expected)} #${digest(cause.expected)}`;
  return `${operator} actual=${short(cause.actual)} expected=${short(cause.expected)} #${digest(cause.actual, cause.expected)}`;
}

// The first stack frame inside the test file, relative to the root.
function assertionLocation(cause) {
  const frames = String(cause.stack || '').split('\n').map(l => l.trim()).filter(l => l.startsWith('at '));
  const own = frames.map(f => normalizePaths(f)).find(f => TEST_FILE ? f.includes(TEST_FILE) : f.includes('<root>'));
  const m = own && own.match(/(<root>\/[^:)\s]+:\d+:\d+)/);
  return m ? m[1] : 'unknown location';
}

function short(value) {
  const text = render(value, { depth: 1, breakLength: Infinity, compact: true, maxStringLength: 20000, maxArrayLength: 4, sorted: true });
  return text.length > 100 ? `${text.slice(0, 97)}...` : text;
}

function digest(...values) {
  const text = values.map(v => render(v, { depth: 6, breakLength: Infinity, compact: true, maxStringLength: 20000, maxArrayLength: 10000, sorted: true })).join('\u0000');
  return createHash('sha1').update(text).digest('hex').slice(0, 8);
}

// A stack frame as util.inspect prints it inside an Error's stack: on its own
// line, `at ` and either a name with a parenthesized location or a bare one.
// The match stops at the location so that whatever inspect printed after the
// last frame, such as the closing bracket of an enclosing object, survives.
const STACK_FRAME = /\n\s+at (?:[^\n(]*?\((?:[^()\n]|\([^()\n]*\))*\)|[^\s,)\]}]+)/g;

function render(value, options) {
  return normalizePaths(safeInspect(value, options).replace(STACK_FRAME, ''));
}

function normalizePaths(text) {
  let out = String(text).split(/\s*\n\s*/).join(' ');
  if (ROOT_REAL !== ROOT) out = out.split(ROOT_REAL).join('<root>');
  out = out.split(ROOT).join('<root>');
  return out.split(homedir()).join('~');
}

function safeString(value) {
  try { return String(value); } catch { return safeInspect(value); }
}

function safeInspect(value, options = { depth: 1, breakLength: Infinity, compact: true, maxStringLength: 60 }) {
  try { return inspect(value, options); } catch { return '[uninspectable]'; }
}
