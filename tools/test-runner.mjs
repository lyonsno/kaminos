#!/usr/bin/env node
// Kaminos test runner.
//
// Every top-level .mjs and .py file under tests/ must be classified, either by
// a first-line declaration in the file itself
//   // kaminos-test: node
//   // kaminos-test: browser — reason
//   # kaminos-test: manual — reason
// or by an entry in tests/suite.json. Kinds `node` and `python` execute;
// `browser` executes only when KAMINOS_BROWSER names an executable file and the
// test opts in to that route (`// kaminos-test: browser route — reason`, or
// "route": true in its manifest entry); it receives the browser's real path
// as KAMINOS_CHROME. `helper` and `manual` are counted with their reason and
// never run.
//
// A failure is known only when the file is quarantined and fails with exactly
// its recorded signature. Everything else fails the run: new failures, changed
// signatures, timeouts, tests that cannot start, unclassified files, invalid or
// orphaned entries, quarantined tests that now pass, selectors that match
// nothing, missing or mismatched npm dependencies, and test roots elsewhere in
// the repository that are neither covered nor excluded with a reason. A report
// is written for every invocation, including interrupted ones.
//
// Warnings never fail a run: what the Python dependency check finds, and any
// line a test writes beginning `kaminos-test-warning: `, are listed in the
// report and printed once in the summary. The command line, not runSuite,
// appends a start line and a finish line per run to a run ledger (see
// docs/testing.md), so a run that never finishes still shows.

import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { accessSync, constants as fsConstants, existsSync, lstatSync, mkdtempSync, readlinkSync, realpathSync, rmSync, statSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SUITE_MANIFEST_SCHEMA = 'kaminos.test-suite-manifest.v1';
export const QUARANTINE_SCHEMA = 'kaminos.test-quarantine.v1';
export const REPORT_SCHEMA = 'kaminos.test-run-report.v1';
export const KNOWN_KINDS = new Set(['node', 'python', 'browser', 'helper', 'manual']);
export const EXECUTED_KINDS = new Set(['node', 'python']);
export const QUARANTINE_CLASSES = new Set(['untriaged', 'regression', 'stale-pin', 'environment', 'harness-defect']);
export const BROWSER_OVERRIDES = ['KAMINOS_CHROME', 'CHROME_BIN', 'CHROME', 'KAMINOS_SHARP_WEBGPU_CHROME', 'KAMINOS_HEADLESS_BROWSER'];
// Tools that act on the operator's machine, which a test must never reach:
// in the sandbox each is a stub first on PATH that records the call and
// refuses it. KAMINOS_TEST_SANDBOX_STUBS adds more names (space-separated),
// for tools that only exist on some machines.
export const SANDBOX_SHIMS = Object.freeze(['gpu-greenroom', 'launchctl', 'wezterm', 'osascript', 'open', 'claude', 'codex', 'gemini', 'gh']);
// Variables an agent pane sets that point at live machine services.
// Variables an agent pane or a shell sets that point at live machine services,
// redirect startup files, or steer git away from the sandbox's config.
const SANDBOX_SCRUBBED = /(_PTY_BROKER_|^WEZTERM_|^CLAUDE_CODE_MESSAGING_|^SSH_AUTH_SOCK$|^GPU_GREENROOM_|^ZDOTDIR$|^BASH_ENV$|^ENV$|^GIT_DIR$|^GIT_WORK_TREE$|^GIT_INDEX_FILE$|^GIT_CONFIG$|^GIT_CONFIG_GLOBAL$|^GIT_CONFIG_SYSTEM$|^GIT_CONFIG_NOSYSTEM$|^GIT_CONFIG_COUNT$|^GIT_CONFIG_KEY_|^GIT_CONFIG_VALUE_|^GIT_CONFIG_PARAMETERS$)/;
// Inherited names the report lists so a reader can see what still reaches
// tests: store and service overrides, and sockets or tokens.
const SANDBOX_NOTED = /(^KAMINOS_(?!TEST_RUNNER_|PYTHON$|BROWSER$|RUN_LEDGER$|TEST_SANDBOX|LATE_LAUNCH_SETTLE_MS$)|SOCK|TOKEN)/;
const SANDBOX_OWNER_MARKER = '.kaminos-test-sandbox-owner';
const SANDBOX_STUB_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
const SANDBOX_GITCONFIG = '[user]\n\tname = Kaminos Test\n\temail = kaminos-test@example.invalid\n[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n[core]\n\thooksPath = /dev/null\n';
const MAX_TIMEOUT_MS = 2 ** 31 - 1;
const LATE_LAUNCH_SETTLE_MS = 2000;
const EXIT_MARKER = /\n?kaminos-test-exit pid=(\d+) tid=(\d+) framework=(yes|no) tests=(started|not-started) code=(-?\d+)\n?/g;
const ENTRY_SEPARATOR = ' | ';
// A line a test writes to stdout or stderr that begins with this prefix is a
// warning: collected with the test's file, printed in the summary, and kept
// out of the failure signature and the run's outcome. A carriage return
// starts a line too, as a terminal shows it after progress output.
export const TEST_WARNING_PREFIX = 'kaminos-test-warning: ';
const TEST_WARNING_LINE = /(^|[\r\n])kaminos-test-warning: ([^\r\n]*)/g;
export const RUN_LEDGER_SCHEMA = 'kaminos.test-run-ledger.v2';
// node:test files run with the spec reporter on stdout for the log and this
// module's reporter writing structured events beside it. Signatures for such
// files come from the events, never from the human-readable output.
export const EVENTS_REPORTER_PATH = fileURLToPath(new URL('./test-events-reporter.mjs', import.meta.url));
export const EXIT_MARKER_PATH = fileURLToPath(new URL('./test-exit-marker.mjs', import.meta.url));
export const DEFAULT_NODE_FLAGS = Object.freeze([`--import=${pathToFileURL(EXIT_MARKER_PATH).href}`, '--test-reporter=spec', '--test-reporter-destination=stdout', `--test-reporter=${pathToFileURL(EVENTS_REPORTER_PATH).href}`]);
const DEFAULT_TIMEOUT_MS = 600000;
const DECLARATION = /^\s*(?:\/\/|#)\s*kaminos-test:\s*([a-z]+)(?:\s+(route))?\s*(?:[—–-]+\s*(.+?))?\s*$/;
const SKIP_DIRS = new Set(['node_modules', '.git', 'artifacts', 'lib', 'scratch', 'scenes', 'fixtures']);

// The installed Google Chrome is an operator's browser; a headless run must
// never take it over.
const INSTALLED_CHROME = /\/Applications\/Google Chrome\.app\//;

const sha256 = text => crypto.createHash('sha256').update(text).digest('hex');
const posix = p => p.split(path.sep).join('/');

async function readJson(file, schema, phase) {
  let text;
  try { text = await fs.readFile(file, 'utf8'); } catch (error) { throw Object.assign(error, { phase }); }
  let document;
  try { document = JSON.parse(text); } catch (error) { throw Object.assign(new Error(`${file}: ${error.message}`), { phase }); }
  if (document?.schema !== schema) throw Object.assign(new Error(`${file}: schema must be ${schema}, got ${document?.schema}`), { phase });
  return { document, sha256: sha256(text) };
}

async function discover(root) {
  const entries = await fs.readdir(path.join(root, 'tests'), { withFileTypes: true });
  return entries.filter(e => e.isFile() && /\.(mjs|py)$/.test(e.name)).map(e => `tests/${e.name}`).sort();
}

// Test roots elsewhere in the repository: directories named tests or test, and
// *.test.{mjs,js} files outside such directories.
export async function discoverOtherTestRoots(root) {
  const found = [];
  async function walk(rel) {
    let entries;
    try { entries = await fs.readdir(path.join(root, rel), { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        if (entry.name === 'tests' || entry.name === 'test') { if (child !== 'tests') found.push(child); continue; }
        await walk(child);
      } else if (/\.test\.(mjs|js)$/.test(entry.name)) {
        found.push(child);
      }
    }
  }
  await walk('');
  return found.sort();
}

async function readDeclaration(root, file) {
  const handle = await fs.open(path.join(root, file), 'r');
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(512), 0, 512, 0);
    const firstLine = buffer.subarray(0, bytesRead).toString('utf8').split('\n')[0];
    const match = firstLine.match(DECLARATION);
    return match ? { kind: match[1], route: Boolean(match[2]), reason: match[3] || null, source: 'declaration' } : null;
  } finally { await handle.close(); }
}

function gitIdentity(root) {
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    const head = git(['rev-parse', 'HEAD']);
    const dirty = git(['status', '--porcelain']) !== '';
    let branch = null;
    try { branch = git(['symbolic-ref', '--quiet', '--short', 'HEAD']) || null; } catch { branch = null; }
    return { head, branch, dirty };
  } catch { return { head: null, branch: null, dirty: null }; }
}

function executableVersion(executable, args) {
  try { return execFileSync(executable, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch { return null; }
}

// Switches every launch of the route's browser carries: with them Chrome keeps
// its secrets in a mock keychain and a basic store, so macOS raises no
// Keychain dialog for a browser whose HOME has no default keychain.
export const BROWSER_SAFETY_SWITCHES = Object.freeze(['--use-mock-keychain', '--password-store=basic']);

// A browser's --version, bounded: a browser that never answers is recorded
// without a version instead of holding the run. It is asked with the safety
// switches and a private profile directory, removed afterwards, so even this
// launch touches neither the Keychain nor any profile of the operator's.
function browserVersion(executable, timeoutMs) {
  const profile = mkdtempSync(path.join(os.tmpdir(), 'kaminos-browser-version-'));
  try {
    return { version: execFileSync(executable, [...BROWSER_SAFETY_SWITCHES, `--user-data-dir=${profile}`, '--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs, killSignal: 'SIGKILL' }).trim().split('\n')[0] || null, error: null };
  } catch (error) {
    return { version: null, error: error.code === 'ETIMEDOUT' ? `--version timed out after ${timeoutMs} ms` : String(error.message || error).split('\n')[0] };
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
}

// A node_modules that links to another worktree's install is shared with every
// worktree that links to the same place, and npm ci run through the link
// empties it for all of them.
function nodeModulesLink(root) {
  const dir = path.join(root, 'node_modules');
  let stat;
  try { stat = lstatSync(dir); } catch { return { path: dir, linkTarget: null, dangling: false }; }
  if (!stat.isSymbolicLink()) return { path: dir, linkTarget: null, dangling: false, linkedFrom: linkedFrom(root, dir) };
  try { return { path: dir, linkTarget: realpathSync.native(dir), dangling: false }; }
  catch { return { path: dir, linkTarget: path.resolve(root, readlinkSync(dir)), dangling: true }; }
}

// Other worktrees of this repository whose node_modules links to this one's.
// A worktree they link to owns a shared install. A directory with no .git
// entry is not a repository and has none; null means git could not answer
// (missing, timed out, or a .git that git cannot read, such as a worktree
// whose admin directory was removed).
function linkedFrom(root, dir) {
  let listing;
  try { listing = execFileSync('git', ['-C', root, 'worktree', 'list', '--porcelain'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 }); }
  catch (error) { return typeof error.status === 'number' && !error.signal && !existsSync(path.join(root, '.git')) ? [] : null; }
  let own;
  try { own = realpathSync.native(dir); } catch { return []; }
  const self = (() => { try { return realpathSync.native(root); } catch { return root; } })();
  const found = [];
  for (const line of listing.split('\n')) {
    if (!line.startsWith('worktree ')) continue;
    let tree;
    try { tree = realpathSync.native(line.slice('worktree '.length)); } catch { continue; }
    if (tree === self) continue;
    const other = path.join(tree, 'node_modules');
    try { if (lstatSync(other).isSymbolicLink() && realpathSync.native(other) === own) found.push(tree); } catch {}
  }
  return found.sort();
}

// npm ci or npm install, run here or where the link points, rewrites the shared
// directory for every worktree linked to it; the only safe remedy is an install
// of this worktree's own. unlink removes the link and never what it points at.
function npmRemedy(link) {
  if (!link.linkTarget) {
    if (link.linkedFrom === null) return 'The runner could not check whether other worktrees link to node_modules here (git worktree list did not answer). If they do, npm ci or npm install here empties and rewrites it for them; check `git worktree list` before running npm ci.';
    const others = link.linkedFrom || [];
    if (!others.length) return 'Run npm ci.';
    const named = others.slice(0, 3).join(', ') + (others.length > 3 ? `, and ${others.length - 3} more` : '');
    return `node_modules here is used by ${others.length} other worktree${others.length === 1 ? '' : 's'} through a link (${named}); npm ci or npm install here empties and rewrites it for all of them, with this branch's lockfile. Before running it, make sure those worktrees can take that, or tell their owners.`;
  }
  if (link.dangling) return `node_modules here is a link to ${link.linkTarget}, which no longer exists. Install your own: unlink node_modules, then npm ci here.`;
  return `node_modules here is a link to a shared install at ${link.linkTarget} that other worktrees also use; npm ci or npm install, here or there, empties or changes it for all of them. Install your own instead: unlink node_modules (this removes only the link), then npm ci here.`;
}

async function checkDependencies(root) {
  const manifestPath = path.join(root, 'package.json');
  if (!existsSync(manifestPath)) return { declared: [], missing: [], mismatched: [], installed: {}, checked: 0, integrityVerified: false, lockfileSha256: null };
  const pkg = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const declared = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }).sort();
  const missing = declared.filter(name => !existsSync(path.join(root, 'node_modules', name, 'package.json')));
  const lockPath = path.join(root, 'package-lock.json');
  const lock = existsSync(lockPath) ? JSON.parse(await fs.readFile(lockPath, 'utf8')) : null;
  const hiddenPath = path.join(root, 'node_modules', '.package-lock.json');
  const hidden = existsSync(hiddenPath) ? JSON.parse(await fs.readFile(hiddenPath, 'utf8')) : null;
  const installed = {};
  const mismatched = [];
  let checked = 0;
  const entries = Object.entries(lock?.packages || {}).filter(([key]) => key.startsWith('node_modules/'));
  for (const [key, locked] of entries) {
    const name = key.replace(/^node_modules\//, '');
    const manifest = path.join(root, key, 'package.json');
    if (!existsSync(manifest)) { if (!missing.includes(name) && !locked.optional && !locked.dev) missing.push(name); continue; }
    checked += 1;
    const version = JSON.parse(await fs.readFile(manifest, 'utf8')).version;
    installed[name] = version;
    if (locked?.version && locked.version !== version) { mismatched.push({ name, locked: locked.version, installed: version }); continue; }
    const placed = hidden?.packages?.[key];
    for (const field of ['resolved', 'integrity']) {
      if (locked?.[field] && placed?.[field] && locked[field] !== placed[field]) mismatched.push({ name, field, locked: locked[field], installed: placed[field] });
    }
  }
  return { declared, missing: missing.sort(), mismatched, installed, checked, integrityVerified: Boolean(hidden),
    lockfileSha256: existsSync(lockPath) ? sha256(await fs.readFile(lockPath)) : null };
}

// Why a path is not an interpreter the runner can run, or null when it is an
// executable regular file once links are followed.
function unusableReason(file) {
  const explain = (error, missing) => (error?.code === 'ENOENT' ? missing
    : error?.code === 'ELOOP' ? 'is a symlink loop'
    : `cannot be used (${error?.code || error})`);
  try { lstatSync(file); } catch (error) { return explain(error, 'does not exist'); }
  try {
    if (!statSync(file).isFile()) return 'does not resolve to a file';
    accessSync(file, fsConstants.X_OK);
    return null;
  } catch (error) {
    return error?.code === 'EACCES' ? 'is not executable' : explain(error, 'is a link to nothing');
  }
}

// An interpreter named by command, as a path: one with a slash is taken
// relative to the working directory, a bare name is looked up on PATH the way
// a spawn would. Null when a bare name is not found.
function locateExecutable(name, envPath) {
  if (name.includes('/')) return path.resolve(name);
  for (const dir of String(envPath || '').split(path.delimiter).filter(Boolean)) {
    const candidate = path.resolve(dir, name);
    if (unusableReason(candidate) === null) return candidate;
  }
  return null;
}

// Which python the runner uses, in order: an explicit executables.python
// from a programmatic caller, KAMINOS_PYTHON, <root>/.venv/bin/python3 (the
// declared packages live in a repo-local venv) when it resolves to an
// executable file, then the python3 on PATH. A .venv/bin/python3 that is
// there but unusable is recorded and warned about, and PATH is used instead.
// Child tests get the same interpreter for a bare python3 at execution:
// .venv/bin goes first on their PATH, or for KAMINOS_PYTHON a run-private
// directory holding a python3 wrapper that execs it.
function resolvePython(root, explicit, env) {
  if (explicit) return { requested: explicit, resolved: explicit, source: 'executables', located: locateExecutable(explicit, env.PATH), unusable: null, skippedVenv: null };
  if (env.KAMINOS_PYTHON) {
    const located = locateExecutable(env.KAMINOS_PYTHON, env.PATH);
    return { requested: 'KAMINOS_PYTHON', resolved: env.KAMINOS_PYTHON, source: 'KAMINOS_PYTHON', located, unusable: located ? unusableReason(located) : 'is not on PATH', skippedVenv: null };
  }
  const venvBin = path.join(root, '.venv', 'bin');
  const venvPython = path.join(venvBin, 'python3');
  const venvProblem = unusableReason(venvPython);
  if (venvProblem === null) return { requested: 'python3', resolved: venvPython, source: 'venv', located: venvPython, unusable: null, skippedVenv: null, venvBin };
  return { requested: 'python3', resolved: 'python3', source: 'PATH', located: locateExecutable('python3', env.PATH), unusable: null,
    skippedVenv: venvProblem === 'does not exist' ? null : { interpreter: venvPython, reason: venvProblem } };
}

// The commands that fix what the Python check finds, written out for this
// root. The venv command works whether or not a venv (complete, partial or
// broken) is already there; under KAMINOS_PYTHON the packages belong in that
// interpreter instead.
const shellWord = word => (/^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`);
function venvRemedy(root) {
  const venv = path.join(root, '.venv');
  return `uv venv --allow-existing ${shellWord(venv)} && uv pip install --python ${shellWord(path.join(venv, 'bin', 'python3'))} -r ${shellWord(path.join(root, 'requirements.txt'))}`;
}
function installRemedy(root, python) {
  if (python.source === 'KAMINOS_PYTHON' || python.source === 'executables') {
    return `install them into that interpreter: uv pip install --python ${shellWord(python.located || python.resolved)} -r ${shellWord(path.join(root, 'requirements.txt'))}`;
  }
  return `install them into the repo-local venv, which the runner prefers: ${venvRemedy(root)}`;
}
function startRemedy(root, python) {
  if (python.source === 'KAMINOS_PYTHON') return `point KAMINOS_PYTHON at an interpreter that runs, or unset it to use the repo-local venv: ${venvRemedy(root)}`;
  if (python.source === 'executables') return `pass an interpreter that runs, or use the repo-local venv: ${venvRemedy(root)}`;
  return `${python.source === 'venv' ? 'recreate' : 'create'} the repo-local venv, which the runner prefers: ${venvRemedy(root)}`;
}

// Python distributions the suite needs, from requirements.txt at the root:
// one bare distribution name per line, comments and blank lines allowed,
// nothing else. Whenever the file declares anything they are checked before
// anything runs, whatever tests are selected, in the runner's python with
// one importlib.metadata call by distribution name (pillow, not PIL): Node
// tests spawn python3 too, so a narrowed run is warned as well. Installed
// means the package metadata is recorded, not that the package imports.
const DISTRIBUTION_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const PYTHON_DEPENDENCY_PROBE = [
  'import importlib.metadata as m, json, sys',
  'out = {"python": sys.version.split()[0], "executable": sys.executable, "installed": {}, "missing": []}',
  'for name in sys.argv[1:]:',
  '    try: out["installed"][name] = m.version(name)',
  '    except m.PackageNotFoundError: out["missing"].append(name)',
  'print(json.dumps(out))',
].join('\n');
const PYTHON_PROBE_TIMEOUT_MS = 60000;

// Checks requirements.txt in the chosen interpreter and returns what it found
// with the warnings to report. It never throws: whatever goes wrong is a
// warning, and the run goes on.
async function checkPythonDependencies(root, python, env = process.env) {
  const warnings = [];
  const result = { checked: false, skipped: null, requirementsPath: null, requirementsSha256: null, executable: python.resolved, source: python.source, resolvedExecutable: null, python: null, declared: [], invalidLines: [], installed: {}, missing: [], stderrTail: null };
  if (python.skippedVenv) warnings.push(`the repo-local venv interpreter ${python.skippedVenv.interpreter} ${python.skippedVenv.reason}, so the python3 on PATH is used instead; recreate the venv: ${venvRemedy(root)}`);
  if (python.source === 'KAMINOS_PYTHON' && python.unusable) warnings.push(`KAMINOS_PYTHON names ${python.resolved}, which ${python.unusable}, so child tests that spawn python3 get the one on PATH; ${startRemedy(root, python)}`);
  try {
    const requirementsPath = path.join(root, 'requirements.txt');
    if (!existsSync(requirementsPath)) { result.skipped = 'no requirements.txt'; return { result, warnings }; }
    const text = await fs.readFile(requirementsPath, 'utf8');
    Object.assign(result, { requirementsPath, requirementsSha256: sha256(text) });
    text.split(/\r?\n/).forEach((raw, index) => {
      const line = raw.replace(/#.*$/, '').trim();
      if (!line) return;
      if (DISTRIBUTION_NAME.test(line)) result.declared.push(line);
      else result.invalidLines.push({ line: index + 1, text: raw.trim() });
    });
    if (result.invalidLines.length) {
      warnings.push(`requirements.txt holds lines that are not bare distribution names, which were not checked: ${result.invalidLines.map(l => `line ${l.line}: ${l.text}`).join('; ')}; write one bare distribution name per line`);
    }
    if (!result.declared.length) { result.skipped = 'requirements.txt declares nothing'; return { result, warnings }; }
    let probe;
    try {
      probe = JSON.parse(execFileSync(result.executable, ['-c', PYTHON_DEPENDENCY_PROBE, ...result.declared], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: PYTHON_PROBE_TIMEOUT_MS, env }));
    } catch (error) {
      // The raised exception is the last error-shaped stderr line: after a
      // traceback it is the last line, but an interpreter that dies while
      // starting ends with "<no Python frame>" after its error.
      const stderrLines = String(error?.stderr || '').split('\n').map(line => line.trimEnd()).filter(line => line.trim());
      result.stderrTail = stderrLines.length ? stderrLines.slice(-20).join('\n') : null;
      const errorLine = stderrLines.findLast(line => /Error|Exception|Fatal Python error/.test(line)) || stderrLines.at(-1);
      const detail = [error?.code, errorLine?.trim() || firstLine(error?.message || error)].filter(Boolean).join(': ');
      warnings.push(`could not check requirements.txt with ${result.executable} (${detail}); ${startRemedy(root, python)}`);
      return { result, warnings };
    }
    Object.assign(result, { checked: true, resolvedExecutable: probe.executable, python: probe.python, installed: probe.installed, missing: probe.missing });
    if (result.missing.length) {
      const asked = `${result.executable}${result.resolvedExecutable && result.resolvedExecutable !== result.executable ? ` (${result.resolvedExecutable})` : ''}`;
      warnings.push(`python distributions listed in requirements.txt are not installed in ${asked}: ${result.missing.join(', ')}; ${installRemedy(root, python)}`);
    }
  } catch (error) {
    warnings.push(`could not check requirements.txt: ${firstLine(error?.message || error)}`);
  }
  return { result, warnings };
}

// The failure signature: the first error-shaped line for Node, the last for
// Python (the raised exception), otherwise the last output line, otherwise
// the exit status. Machine-local paths are normalized so signatures compare
// across checkouts.
export function failureSignature(output, { root, kind, exitCode }) {
  let text = output;
  if (root) text = text.split(root).join('<root>');
  text = text.split(os.homedir()).join('~');
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const isError = l => /^(?:[A-Za-z_.]*(?:Error|Exception))(?:\s*\[[A-Z_]+\])?:/.test(l) || /^FAIL\b/.test(l);
  const indexes = lines.map((l, i) => (isError(l) ? i : -1)).filter(i => i >= 0);
  if (!indexes.length) return lines.length ? lines.at(-1) : `exit ${exitCode}`;
  const at = kind === 'python' ? indexes.at(-1) : indexes[0];
  // A generic message ending in a colon carries its distinguishing detail on
  // the following lines; keep up to four of them, stopping at the stack.
  if (!lines[at].endsWith(':')) return lines[at];
  const detail = [];
  for (let i = at + 1; i < lines.length && detail.length < 4; i += 1) {
    if (/^at\s/.test(lines[i]) || isError(lines[i])) break;
    detail.push(lines[i]);
  }
  return [lines[at], ...detail].join(' | ');
}

function normalizeText(text, root) {
  let out = String(text);
  if (root) {
    let real = null;
    try { real = realpathSync(root); } catch { real = null; }
    if (real && real !== root) out = out.split(real).join('<root>');
    out = out.split(root).join('<root>');
  }
  return out.split(os.homedir()).join('~');
}

// Build a node:test file's signature from the structured events its reporter
// wrote, after checking that the file is whole: one header from the process
// the runner spawned, every line from that process and parsable, and the
// summary present. Anything else means the events cannot be trusted, and the
// file is unsigned rather than signed by whatever survived. Each failing test
// contributes its suite path and the thrown error's name and first message
// line, plus the assertion itself when Node generated the message; a failed
// hook contributes the hook and its error; errors the test runner caught
// outside any test contribute as uncaught. Suites that only failed because
// their children did, children cancelled because a hook failed, and todo or
// skipped tests add nothing. A file whose tests all passed but which exited
// nonzero is signed by that exit.
export function nodeTestSignature(eventsText, { root, childPid, exitCode } = {}) {
  const records = [];
  for (const line of String(eventsText).split('\n')) {
    if (!line.trim()) continue;
    let record;
    try { record = JSON.parse(line); } catch { return { signature: null, unsigned: 'the events file holds unparsable lines; another process may have written into it' }; }
    if (!record || typeof record !== 'object') return { signature: null, unsigned: 'the events file holds a record that is not an object' };
    records.push(record);
  }
  const headers = records.filter(r => r.kind === 'header');
  if (headers.length !== 1) return { signature: null, unsigned: `expected one header record, found ${headers.length}` };
  if (childPid && headers[0].pid !== childPid) return { signature: null, unsigned: `events were written by process ${headers[0].pid}, not the spawned test ${childPid}` };
  if (headers[0].tid !== 0) return { signature: null, unsigned: 'events were written from a worker thread' };
  if (records.some(r => r.pid !== headers[0].pid || r.tid !== headers[0].tid)) return { signature: null, unsigned: 'events from more than one process or thread' };
  if (!records.some(r => r.kind === 'summary' && /^tests \d+$/.test(r.message || ''))) return { signature: null, unsigned: 'no summary record; the file ended before its tests finished' };
  const entries = [];
  for (const event of records) {
    if (event.kind === 'uncaught') { entries.push(`uncaught :: ${firstLine(normalizeText(event.message, root))}`); continue; }
    if (event.kind !== 'fail') continue;
    if (event.todo || event.skip) continue;
    if (event.failureType === 'subtestsFailed' || event.failureType === 'cancelledByParent') continue;
    const path = normalizeText(event.path, root).split(ENTRY_SEPARATOR).join(' ¦ ');
    const error = describeEventError(event.error, root);
    if (event.failureType === 'hookFailed') {
      const hook = String(event.wrapper || '').match(/failed running (\w+) hook/);
      entries.push(`${path} :: ${hook ? `${hook[1]} hook failed` : 'hook failed'} :: ${error}`);
      continue;
    }
    entries.push(`${path} :: ${error}`);
  }
  if (!entries.length) return { signature: `node:test passed; exit ${exitCode}`, unsigned: null };
  return { signature: `node:test failing: ${entries.sort().join(ENTRY_SEPARATOR)}`, unsigned: null };
}

function describeEventError(error, root) {
  if (!error) return 'no error';
  const head = `${error.name || 'Error'}: ${firstLine(normalizeText(error.message, root))}`;
  return error.detail ? `${head} [${firstLine(normalizeText(error.detail, root))}]` : head;
}

// Entries of a node:test signature, for reporting what changed.
export function signatureEntries(signature) {
  if (typeof signature !== 'string' || !signature.startsWith('node:test failing: ')) return null;
  return signature.slice('node:test failing: '.length).split(ENTRY_SEPARATOR);
}

function firstLine(text) {
  return String(text).split('\n').map(l => l.trim()).find(Boolean) || '';
}

// The warning lines in one stream's output, and output without them.
function testWarnings(text) {
  return [...String(text).matchAll(TEST_WARNING_LINE)].map(match => match[2].trim()).filter(Boolean);
}
function stripTestWarnings(text) {
  return String(text).replace(TEST_WARNING_LINE, '$1');
}

function runOne({ root, file, kind, runtime = kind, executable, timeoutMs, logsDir, env: baseEnv, track, nodeFlags }) {
  const env = { ...baseEnv, KAMINOS_TEST_RUNNER_TEST: file, KAMINOS_TEST_RUNNER_ROOT: root };
  const eventsPath = path.join(logsDir, `${file.replace(/[\/]/g, '__')}.events.jsonl`);
  const flags = runtime === 'node' ? [...nodeFlags] : [];
  const withReporter = flags.some(f => f.startsWith('--test-reporter=') && f.includes('test-events-reporter'));
  if (withReporter) flags.push(`--test-reporter-destination=${eventsPath}`);
  const started = Date.now();
  const logPath = path.join(logsDir, `${file.replace(/[\/]/g, '__')}.log`);
  return new Promise(async resolve => {
    // A stale events file from an earlier run must never stand in for this one.
    try { await fs.rm(eventsPath, { force: true }); } catch (error) {
      return resolve({ file, kind, executable, durationMs: 0, log: null, events: null, signature: null, outcome: 'spawn-error', exitCode: null, signal: null, spawnError: String(error?.message || error) });
    }
    const chunks = [];
    const streams = { stdout: [], stderr: [] };
    let spawnError = null;
    let timedOut = false;
    const finish = async fields => {
      await fs.writeFile(logPath, Buffer.concat(chunks));
      const output = Buffer.concat(chunks).toString('utf8');
      // Warnings are read from each stream on its own, so a line on one is
      // never split by output on the other.
      const warnings = [...new Set(['stdout', 'stderr'].flatMap(name => testWarnings(Buffer.concat(streams[name]).toString('utf8'))))];
      let events = null;
      try { events = await fs.readFile(eventsPath, 'utf8'); } catch { events = null; }
      let signature = null;
      let unsigned = null;
      let outcome = fields.outcome;
      // The preload's exit line, from the spawned process itself, says
      // whether the test harness started running tests here; a relayed
      // child's line carries that child's pid and is ignored. A file that
      // only imported the framework, or failed while loading, is a plain
      // script for signing purposes.
      const markers = [...output.matchAll(EXIT_MARKER)];
      const testsStarted = Boolean(child?.pid) && markers.some(m => Number(m[1]) === child.pid && Number(m[2]) === 0 && m[4] === 'started');
      if (outcome === 'fail') {
        if (testsStarted) {
          ({ signature, unsigned } = nodeTestSignature(events ?? '', { root, childPid: child?.pid, exitCode: fields.exitCode }));
          if (events === null) unsigned = 'tests started but no events were written; the process ended before they were flushed';
          if (unsigned) { outcome = 'unsigned-failure'; signature = null; }
        } else {
          signature = failureSignature(stripTestWarnings(output.replace(EXIT_MARKER, '\n')), { root, kind: runtime, exitCode: fields.exitCode });
        }
      } else if (outcome === 'pass' && testsStarted) {
        // Exiting zero before the summary is not a pass; nothing says the
        // tests finished. Trusted events that record a failing test outrank
        // the exit code too: an exit handler can reset it. Diagnostics the
        // reporter took for uncaught errors do not, on their own: a test may
        // emit a diagnostic that begins with Error and still pass.
        const check = nodeTestSignature(events ?? '', { root, childPid: child?.pid, exitCode: fields.exitCode });
        if (events === null || check.unsigned) { outcome = 'unsigned-failure'; unsigned = events === null ? 'tests started, the process exited zero, and no events were written' : check.unsigned; }
        else if (signatureEntries(check.signature)?.some(e => !e.startsWith('uncaught :: '))) { outcome = 'fail'; signature = check.signature; }
      }
      resolve({ file, kind, executable, durationMs: Date.now() - started, log: logPath, events: events !== null ? eventsPath : null, signature, ...fields, outcome,
        ...(unsigned ? { unsigned } : {}), warnings });
    };
    let child;
    try {
      child = spawn(executable, [...flags, file], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], detached: true, env });
    } catch (error) {
      chunks.push(Buffer.from(String(error?.stack || error)));
      return finish({ outcome: 'spawn-error', exitCode: null, signal: null });
    }
    const untrack = track(child);
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }, timeoutMs);
    child.stdout.on('data', d => { chunks.push(d); streams.stdout.push(d); });
    child.stderr.on('data', d => { chunks.push(d); streams.stderr.push(d); });
    child.on('error', error => { spawnError = error; chunks.push(Buffer.from(String(error?.stack || error))); });
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      untrack();
      const outcome = spawnError ? 'spawn-error'
        : timedOut ? 'timeout'
        : exitCode === 0 ? 'pass'
        : exitCode === null ? 'killed'
        : 'fail';
      finish({ outcome, exitCode, signal });
    });
  });
}

async function pool(items, parallel, worker, aborted) {
  const results = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(parallel, items.length)) }, async () => {
    while (next < items.length && !aborted()) { const index = next++; results[index] = await worker(items[index]); }
  }));
  return results.filter(Boolean);
}

function normalizeSelector(file) {
  return posix(path.normalize(file)).replace(/^\.\//, '');
}

export async function runSuite({
  root = process.cwd(),
  manifestPath,
  quarantinePath,
  reportPath,
  logsDir,
  parallel = Math.max(1, Math.floor(os.availableParallelism() / 2)),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  kinds = ['node', 'python'],
  only = null,
  executables = {},
  nodeFlags = DEFAULT_NODE_FLAGS,
  abortSignal = null,
  // The browser executable for browser-kind tests; null or empty leaves them
  // not run. Defaults to KAMINOS_BROWSER.
  browser = process.env.KAMINOS_BROWSER,
  browserVersionTimeoutMs = 10000,
  // How long to wait after the last test for browser launches a test handed
  // to a detached process. The CLI takes it from KAMINOS_LATE_LAUNCH_SETTLE_MS;
  // the runner's own contracts set 0 except where they test late launches.
  lateLaunchSettleMs = LATE_LAUNCH_SETTLE_MS,
  // Child tests get a private HOME and stubs for the shop's tools; false
  // gives them the real HOME and PATH. The CLI reads KAMINOS_TEST_SANDBOX=off.
  sandbox = true,
  sandboxStubs = (process.env.KAMINOS_TEST_SANDBOX_STUBS || '').split(/\s+/).filter(Boolean),
} = {}) {
  const droppedStubs = sandboxStubs.filter(name => !SANDBOX_STUB_NAME.test(name) || name === '..');
  const sandboxShims = [...new Set([...SANDBOX_SHIMS, ...sandboxStubs.filter(name => !droppedStubs.includes(name))])];
  browser = browser || null;
  const settleRequested = lateLaunchSettleMs;
  const settleUsable = /^\d+$/.test(String(settleRequested ?? ''));
  lateLaunchSettleMs = settleUsable ? Number(settleRequested) : LATE_LAUNCH_SETTLE_MS;
  root = path.resolve(root);
  manifestPath ||= path.join(root, 'tests', 'suite.json');
  quarantinePath ||= path.join(root, 'tests', 'quarantine.json');
  if (!reportPath) throw new Error('reportPath is required');
  logsDir = logsDir || path.join(path.dirname(reportPath), 'logs');
  // NODE_TEST_CONTEXT would switch child node:test files to the binary
  // protocol used between a parent `node --test` and its children.
  // KAMINOS_BROWSER is the runner's input; tests receive the browser only as
  // KAMINOS_CHROME, and only browser-kind tests.
  const { NODE_TEST_CONTEXT: _parentTestContext, KAMINOS_BROWSER: _browserInput, ...inheritedEnv } = process.env;
  const pythonExecutable = resolvePython(root, executables.python, inheritedEnv);
  const resolvedExecutables = { node: process.execPath, ...executables, python: pythonExecutable.resolved };
  const browserLog = path.join(logsDir, 'browser-launch-attempts.tsv');
  // A per-run stub with the log path baked in, so a child that scrubs its
  // environment still records the attempt when it reaches the stub.
  const browserStub = path.join(logsDir, 'browser-launch-stub.sh');
  // Chosen in prepareSandbox: the runner deletes only a sandbox directory
  // that carries its owner marker.
  let sandboxDir = path.join(logsDir, 'kaminos-test-sandbox');
  let sandboxHome = path.join(sandboxDir, 'home');
  let sandboxBin = path.join(sandboxDir, 'bin');
  const sandboxLog = path.join(logsDir, 'sandbox-attempts.tsv');
  const report = {
    schema: REPORT_SCHEMA, ok: false, failurePhase: null, error: null,
    startedAt: new Date().toISOString(), finishedAt: null,
    effective: { root, manifestPath, quarantinePath, parallel, timeoutMs, lateLaunchSettleMs, kinds, only,
      executables: resolvedExecutables, nodeFlags: [...nodeFlags], node: process.version, python: null,
      pythonExecutable: { requested: pythonExecutable.requested, resolved: pythonExecutable.resolved, source: pythonExecutable.source, located: pythonExecutable.located,
        unusable: pythonExecutable.unusable, skippedVenv: pythonExecutable.skippedVenv, pathPrefixed: false, pathPrefix: null },
      platform: `${process.platform}-${process.arch}`, git: gitIdentity(root),
      browserStub: { path: browserStub, overrides: BROWSER_OVERRIDES, log: browserLog },
      sandbox: sandbox ? { enabled: true, home: sandboxHome, bin: sandboxBin, shims: sandboxShims, log: sandboxLog, scrubbed: [], inherited: [] } : { enabled: false },
      browser: browser ? { executable: browser, realpath: null, source: 'KAMINOS_BROWSER', passedAs: 'KAMINOS_CHROME', version: null } : null,
      manifestSha256: null, quarantineSha256: null, dependencies: null, pythonDependencies: null },
    counts: { discovered: 0, executed: 0, passed: 0, knownFailures: 0, newFailures: 0, notRun: 0 },
    newFailures: [], knownFailures: [], signatureChanged: [], staleQuarantine: [],
    unclassified: [], invalid: [], invalidQuarantine: [], unmatchedSelectors: [],
    uncoveredTestRoots: [], excludedRoots: [], browserLaunchAttempts: [], sandboxAttempts: [],
    orphans: { manifest: [], quarantine: [] }, notRun: [], results: [], warnings: [],
  };
  if (!settleUsable) report.warnings.push({ source: 'runner', test: null, message: `the late-launch settle ${JSON.stringify(settleRequested)} (KAMINOS_LATE_LAUNCH_SETTLE_MS) is not a whole number of milliseconds, so the default ${LATE_LAUNCH_SETTLE_MS} ms is used; set a whole number, or leave it unset` });
  const running = new Set();
  const track = child => { running.add(child); return () => running.delete(child); };
  async function prepareSandbox() {
    await fs.mkdir(logsDir, { recursive: true });
    const preferred = path.join(logsDir, 'kaminos-test-sandbox');
    if (existsSync(preferred) && !existsSync(path.join(preferred, SANDBOX_OWNER_MARKER))) {
      sandboxDir = await fs.mkdtemp(path.join(logsDir, 'kaminos-test-sandbox-'));
      report.warnings.push({ source: 'sandbox', test: null, message: `${preferred} exists and was not made by the runner, so it was left alone and the sandbox is ${sandboxDir}` });
    } else {
      sandboxDir = preferred;
      await fs.rm(sandboxDir, { recursive: true, force: true });
    }
    sandboxHome = path.join(sandboxDir, 'home');
    sandboxBin = path.join(sandboxDir, 'bin');
    await fs.rm(sandboxLog, { force: true });
    await fs.mkdir(sandboxBin, { recursive: true });
    await fs.writeFile(path.join(sandboxDir, SANDBOX_OWNER_MARKER), 'made by tools/test-runner.mjs; removed and recreated each run\n');
    for (const dir of ['.config', '.cache', '.local/share', '.local/state']) await fs.mkdir(path.join(sandboxHome, dir), { recursive: true });
    await fs.writeFile(path.join(sandboxHome, '.gitconfig'), SANDBOX_GITCONFIG);
    // macOS login shells run path_helper, which puts the system paths back in
    // front; these startup files put the stubs first again afterwards.
    const quotedBin = `'${sandboxBin.replace(/'/g, `'\\''`)}'`;
    for (const file of ['.profile', '.bash_profile', '.zprofile']) await fs.writeFile(path.join(sandboxHome, file), `PATH=${quotedBin}:"$PATH"; export PATH\n`);
    const quotedSandboxLog = `'${sandboxLog.replace(/'/g, `'\\''`)}'`;
    for (const name of sandboxShims) {
      await fs.writeFile(path.join(sandboxBin, name), `#!/bin/sh\n# Stands in for ${name} while tools/test-runner.mjs runs tests: a test must not\n# reach the operator's real tools. Record the call and refuse it.\nprintf '%s\\t%s\\t%s\\n' "\${KAMINOS_TEST_RUNNER_TEST:-unknown}" '${name}' "$(printf '%s' "$*" | tr '\\n\\t' '  ')" >> ${quotedSandboxLog}\necho "${name} blocked by the tools/test-runner.mjs sandbox" >&2\nexit 97\n`, { mode: 0o755 });
    }
    Object.assign(report.effective.sandbox, { home: sandboxHome, bin: sandboxBin,
      scrubbed: Object.keys(inheritedEnv).filter(k => SANDBOX_SCRUBBED.test(k)).sort(),
      inherited: Object.keys(inheritedEnv).filter(k => !SANDBOX_SCRUBBED.test(k) && SANDBOX_NOTED.test(k)).sort() });
    if (droppedStubs.length) report.warnings.push({ source: 'sandbox', test: null, message: `KAMINOS_TEST_SANDBOX_STUBS names that are not plain tool names were dropped: ${droppedStubs.join(' ')}` });
  }
  const killAll = () => { for (const child of running) { try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} } } };
  let interrupted = false;
  const onAbort = () => { interrupted = true; killAll(); };
  if (abortSignal) { if (abortSignal.aborted) onAbort(); else abortSignal.addEventListener('abort', onAbort, { once: true }); }
  const write = async () => {
    report.finishedAt = new Date().toISOString();
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    return { ok: report.ok, report, reportPath };
  };
  try {
    report.failurePhase = 'arguments';
    if (!Number.isInteger(parallel) || parallel < 1) throw Object.assign(new Error(`parallel must be a positive integer, got ${parallel}`), { phase: 'arguments' });
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) throw Object.assign(new Error(`timeoutMs must be between 1 and ${MAX_TIMEOUT_MS}, got ${timeoutMs}`), { phase: 'arguments' });
    if (browser) {
      report.failurePhase = 'browser';
      const fail = message => Object.assign(new Error(`KAMINOS_BROWSER=${browser}: ${message}`), { phase: 'browser' });
      let stat;
      try { stat = await fs.stat(browser); } catch (error) { throw fail(`cannot be read (${error.code || error.message})`); }
      if (!stat.isFile()) throw fail('is not a file');
      try { await fs.access(browser, fsConstants.X_OK); } catch { throw fail('is not executable'); }
      // The native real path carries the volume's own spelling, so a link or a
      // differently cased path to the installed app is still recognized.
      report.effective.browser.realpath = realpathSync.native(browser);
      if (INSTALLED_CHROME.test(browser) || INSTALLED_CHROME.test(report.effective.browser.realpath)) throw fail('names the installed Google Chrome; use a Chrome for Testing executable');
      const probe = browserVersion(report.effective.browser.realpath, browserVersionTimeoutMs);
      report.effective.browser.version = probe.version;
      report.effective.browser.versionError = probe.error;
    }
    report.failurePhase = 'load-manifest';
    const manifest = await readJson(manifestPath, SUITE_MANIFEST_SCHEMA, 'load-manifest');
    report.effective.manifestSha256 = manifest.sha256;
    report.failurePhase = 'load-quarantine';
    const quarantine = await readJson(quarantinePath, QUARANTINE_SCHEMA, 'load-quarantine');
    report.effective.quarantineSha256 = quarantine.sha256;

    report.failurePhase = 'dependencies';
    report.effective.nodeModules = nodeModulesLink(root);
    report.effective.dependencies = await checkDependencies(root);
    const { missing, mismatched } = report.effective.dependencies;
    if (missing.length || mismatched.length) {
      throw Object.assign(new Error(`installed dependencies do not match package-lock.json (missing: ${missing.join(', ') || 'none'}; mismatched: ${mismatched.map(m => m.name).join(', ') || 'none'}). ${npmRemedy(report.effective.nodeModules)}`), { phase: 'dependencies' });
    }

    // The Python check reports and goes on: what it finds is a warning with
    // the command that fixes it, and the tests run either way.
    report.failurePhase = 'sandbox';
    if (sandbox) await prepareSandbox();

    report.failurePhase = 'python-dependencies';
    const { result: pythonDependencies, warnings: pythonWarnings } = await checkPythonDependencies(root, pythonExecutable, sandbox ? { ...inheritedEnv, HOME: sandboxHome } : inheritedEnv);
    report.effective.pythonDependencies = pythonDependencies;
    for (const message of pythonWarnings) report.warnings.push({ source: 'python-dependencies', test: null, message });

    report.failurePhase = 'discover';
    if (kinds.includes('python')) report.effective.python = executableVersion(resolvedExecutables.python, ['--version']);
    const files = await discover(root);
    const fileSet = new Set(files);
    const tests = manifest.document.tests || {};
    const quarantined = quarantine.document.entries || {};
    report.counts.discovered = files.length;

    const excluded = Object.entries(manifest.document.excludedRoots || {})
      .filter(([, reason]) => typeof reason === 'string' && reason.trim());
    const covering = found => excluded.find(([key]) => found === key || found.startsWith(`${key}/`));
    const usedExclusions = new Set();
    for (const found of await discoverOtherTestRoots(root)) {
      const match = covering(found);
      if (match) usedExclusions.add(match[0]);
      else report.uncoveredTestRoots.push(found);
    }
    report.excludedRoots = excluded.filter(([key]) => usedExclusions.has(key)).map(([key, reason]) => ({ path: key, reason }))
      .sort((a, b) => a.path.localeCompare(b.path));

    const classification = new Map();
    for (const file of files) {
      const declared = await readDeclaration(root, file);
      const listed = tests[file] ? { ...tests[file], source: 'manifest' } : null;
      const entry = declared || listed;
      if (!entry) { report.unclassified.push(file); continue; }
      const conflict = declared && listed && listed.kind !== declared.kind;
      const badKind = !KNOWN_KINDS.has(entry.kind);
      const missingReason = !EXECUTED_KINDS.has(entry.kind) && !entry.reason;
      // Only a browser-kind test can opt in to the KAMINOS_BROWSER route.
      const strayRoute = Boolean(entry.route) && entry.kind !== 'browser';
      if (conflict || badKind || missingReason || strayRoute) { report.invalid.push(file); continue; }
      classification.set(file, entry);
    }
    report.orphans.manifest = Object.keys(tests).filter(f => !fileSet.has(f)).sort();
    report.orphans.quarantine = Object.keys(quarantined).filter(f => !fileSet.has(f)).sort();
    report.invalidQuarantine = Object.entries(quarantined).filter(([, e]) =>
      !e || !QUARANTINE_CLASSES.has(e.class) || !e.owner || !e.reason || typeof e.signature !== 'string' || !e.signature.trim(),
    ).map(([file]) => file).sort();

    for (const kind of kinds) if (!KNOWN_KINDS.has(kind)) report.unmatchedSelectors.push(`kind:${kind}`);
    const onlySet = only ? new Set(only.map(normalizeSelector)) : null;
    if (onlySet) for (const selector of onlySet) if (!classification.has(selector)) report.unmatchedSelectors.push(selector);

    const planned = [];
    for (const [file, entry] of classification) {
      if (onlySet && !onlySet.has(file)) continue;
      if (EXECUTED_KINDS.has(entry.kind) && kinds.includes(entry.kind)) planned.push({ file, kind: entry.kind, executable: resolvedExecutables[entry.kind] });
      else if (entry.kind === 'browser' && browser && entry.route === true) {
        const runtime = file.endsWith('.py') ? 'python' : 'node';
        planned.push({ file, kind: 'browser', runtime, executable: resolvedExecutables[runtime] });
      } else if (entry.kind === 'browser' && browser) {
        report.notRun.push({ file, kind: entry.kind, reason: `not opted in to the KAMINOS_BROWSER route: ${entry.reason}`, source: entry.source });
      } else report.notRun.push({ file, kind: entry.kind, reason: entry.reason || `kind ${entry.kind} not selected`, source: entry.source });
    }
    report.counts.notRun = report.notRun.length;
    if (!planned.length && !report.unmatchedSelectors.length) report.unmatchedSelectors.push('empty-plan');

    report.failurePhase = 'execute';
    await fs.mkdir(logsDir, { recursive: true });
    await fs.rm(browserLog, { force: true });
    const quotedLog = `'${browserLog.replace(/'/g, `'\\''`)}'`;
    await fs.writeFile(browserStub, `#!/bin/sh\n# Stands in for a browser while tools/test-runner.mjs runs tests. Any test\n# that reaches a browser launch lands here: record it and fail.\nprintf '%s\\t%s\\t%s\\n' "\${KAMINOS_TEST_RUNNER_TEST:-unknown}" "$$" "$*" >> ${quotedLog}\necho "browser launch blocked by tools/test-runner.mjs" >&2\nexit 97\n`);
    await fs.chmod(browserStub, 0o755);
    // Child tests that spawn a bare python3 get the chosen interpreter: the
    // venv's bin goes first on their PATH, or for KAMINOS_PYTHON a run-private
    // directory holding a python3 that execs it by its own path. A wrapper,
    // not a link, so a venv interpreter keeps its venv. The prefix is
    // recorded only once it is in place.
    let pathPrefix = pythonExecutable.source === 'venv' ? pythonExecutable.venvBin : null;
    if (pythonExecutable.source === 'KAMINOS_PYTHON' && !pythonExecutable.unusable) {
      const dir = path.join(logsDir, 'python-bin');
      const wrapper = path.join(dir, 'python3');
      try {
        await fs.mkdir(dir, { recursive: true });
        await fs.rm(wrapper, { recursive: true, force: true });
        await fs.writeFile(wrapper, `#!/bin/sh\nexec '${pythonExecutable.located.replace(/'/g, `'\\''`)}' "$@"\n`);
        await fs.chmod(wrapper, 0o755);
        pathPrefix = dir;
      } catch (error) {
        report.warnings.push({ source: 'python-dependencies', test: null, message: `could not put KAMINOS_PYTHON first on the PATH of child tests (${firstLine(error?.message || error)}), so those that spawn python3 get the one on PATH` });
      }
    }
    Object.assign(report.effective.pythonExecutable, { pathPrefixed: Boolean(pathPrefix), pathPrefix });
    let sandboxEnv = {};
    let baseEnv = inheritedEnv;
    if (sandbox) {
      baseEnv = Object.fromEntries(Object.entries(inheritedEnv).filter(([k]) => !SANDBOX_SCRUBBED.test(k)));
      const gitconfig = path.join(sandboxHome, '.gitconfig');
      sandboxEnv = { HOME: sandboxHome, XDG_CONFIG_HOME: path.join(sandboxHome, '.config'), XDG_CACHE_HOME: path.join(sandboxHome, '.cache'),
        XDG_DATA_HOME: path.join(sandboxHome, '.local/share'), XDG_STATE_HOME: path.join(sandboxHome, '.local/state'),
        GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: '1', KAMINOS_BIND_HOST: '127.0.0.1',
        KAMINOS_TEST_RUNNER_SANDBOX_LOG: sandboxLog };
    }
    const childPath = [sandbox ? sandboxBin : null, pathPrefix, baseEnv.PATH].filter(Boolean).join(path.delimiter) || undefined;
    const childEnv = { ...baseEnv, ...sandboxEnv, ...(childPath === undefined ? {} : { PATH: childPath }), ...Object.fromEntries(BROWSER_OVERRIDES.map(k => [k, browserStub])), KAMINOS_TEST_RUNNER_BROWSER_LOG: browserLog };
    // Browser-kind tests get the browser's real path, so a link cannot stand
    // in for the executable the report records.
    const browserEnv = browser ? { ...childEnv, KAMINOS_CHROME: report.effective.browser.realpath } : null;
    report.results = await pool(planned, parallel,
      item => runOne({ root, ...item, timeoutMs, logsDir, env: item.kind === 'browser' ? browserEnv : childEnv, track, nodeFlags }), () => interrupted);
    for (const result of report.results) for (const message of result.warnings || []) report.warnings.push({ source: 'test', test: result.file, message });
    if (interrupted) throw Object.assign(new Error('run interrupted'), { phase: 'interrupted' });

    report.counts.executed = report.results.length;
    if (report.results.length !== planned.length) throw Object.assign(new Error(`planned ${planned.length} tests but ran ${report.results.length}`), { phase: 'execute' });
    // A test can hand off a browser launch to a detached process that fires
    // after the test exits; give such launches a moment to reach the stub.
    if (lateLaunchSettleMs > 0) await new Promise(r => setTimeout(r, lateLaunchSettleMs));
    if (existsSync(browserLog)) {
      report.browserLaunchAttempts = (await fs.readFile(browserLog, 'utf8')).trim().split('\n').filter(Boolean)
        .map(line => { const [file, pid, args] = line.split('\t'); return { file, pid: Number(pid), args }; });
    }
    // A sandbox attempt is a warning: the stub already refused the call, and
    // under the gate rule a new check reports before it ever fails a run.
    if (sandbox && existsSync(sandboxLog)) {
      report.sandboxAttempts = (await fs.readFile(sandboxLog, 'utf8')).trim().split('\n').filter(Boolean)
        .map(line => { const [file, tool, ...rest] = line.split('\t'); return { file, tool, args: rest.join('\t') }; });
      for (const a of report.sandboxAttempts) report.warnings.push({ source: 'sandbox', test: a.file, message: `${a.file} tried to run ${a.tool}${a.args ? ` ${a.args}` : ''}; the sandbox refused it: a test must not reach the operator's real tools, so give the test its own fake` });
    }
    const invalidQuarantine = new Set(report.invalidQuarantine);
    for (const result of report.results) {
      const entry = quarantined[result.file];
      if (result.outcome === 'pass') {
        report.counts.passed += 1;
        if (entry) report.staleQuarantine.push(result.file);
      } else if (entry && !invalidQuarantine.has(result.file) && result.outcome === 'fail' && result.signature === entry.signature) {
        report.knownFailures.push(result.file);
      } else {
        report.newFailures.push(result.file);
        if (entry && result.outcome === 'fail' && result.signature !== entry.signature) {
          const was = signatureEntries(entry.signature); const now = signatureEntries(result.signature);
          const diff = was && now ? { added: now.filter(e => !was.includes(e)), removed: was.filter(e => !now.includes(e)) } : {};
          report.signatureChanged.push({ file: result.file, expected: entry.signature, actual: result.signature, ...diff });
        }
      }
    }
    report.counts.knownFailures = report.knownFailures.length;
    report.counts.newFailures = report.newFailures.length;
    report.failurePhase = null;
    report.ok = report.newFailures.length === 0 && report.staleQuarantine.length === 0
      && report.unclassified.length === 0 && report.invalid.length === 0 && report.invalidQuarantine.length === 0
      && report.unmatchedSelectors.length === 0 && report.uncoveredTestRoots.length === 0
      && report.browserLaunchAttempts.length === 0
      && report.orphans.manifest.length === 0 && (onlySet ? true : report.orphans.quarantine.length === 0);
  } catch (error) {
    report.ok = false;
    report.failurePhase = interrupted ? 'interrupted' : (error.phase || report.failurePhase || 'unknown');
    report.error = String(error?.stack || error);
    killAll();
  } finally {
    abortSignal?.removeEventListener?.('abort', onAbort);
  }
  return write();
}

export function parseArgs(argv) {
  const args = { kinds: ['node', 'python'] };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = () => {
      if (i + 1 >= argv.length) throw new Error(`${flag} requires a value`);
      return argv[++i];
    };
    if (flag === '--report') args.reportPath = path.resolve(value());
    else if (flag === '--logs') args.logsDir = path.resolve(value());
    else if (flag === '--root') args.root = value();
    else if (flag === '--parallel') args.parallel = Number(value());
    else if (flag === '--timeout-ms') args.timeoutMs = Number(value());
    else if (flag === '--kinds') args.kinds = value().split(',');
    else if (flag === '--only') args.only = value().split(',');
    else throw new Error(`unknown argument ${flag}`);
  }
  return args;
}

// The interpreter a run used, as the summary line and the run ledger name it.
function pythonShown(report) {
  const python = report.effective?.pythonExecutable || {};
  return { executable: python.located || python.resolved || null, source: python.source || null };
}

// Warnings once each, in the order they arose; one that several tests wrote
// is listed once with all of them.
function warningLines(warnings = []) {
  const grouped = new Map();
  for (const warning of warnings) {
    const key = `${warning.source}\u0000${warning.message}`;
    if (!grouped.has(key)) grouped.set(key, { source: warning.source, message: warning.message, tests: [] });
    const group = grouped.get(key);
    if (warning.test && !group.tests.includes(warning.test)) group.tests.push(warning.test);
  }
  return [...grouped.values()].map(g => `${g.tests.length ? g.tests.join(', ') : g.source}: ${g.message}`);
}

function summarize({ report, reportPath }) {
  const python = pythonShown(report);
  const lines = [
    `${report.ok ? 'OK' : 'FAILED'}  executed ${report.counts.executed}, passed ${report.counts.passed}, known failures ${report.counts.knownFailures}, new failures ${report.counts.newFailures}, not run ${report.counts.notRun}; python ${python.executable} (${python.source})`,
  ];
  const warned = warningLines(report.warnings);
  if (warned.length) lines.push(`warnings:\n  ${warned.join('\n  ')}`);
  // The browser line follows the counts line and any warnings.
  lines.push(`browser: ${report.effective?.browser ? `${report.effective.browser.executable}${report.effective.browser.version ? ` (${report.effective.browser.version})` : ''}` : 'none; browser-kind tests not run (set KAMINOS_BROWSER to a Chrome for Testing executable)'}`);
  const shared = report.effective?.nodeModules?.linkTarget;
  if (report.effective?.sandbox && report.effective.sandbox.enabled === false) lines.push("sandbox: off (KAMINOS_TEST_SANDBOX=off); tests see the real HOME and the shop's tools");
  if (shared) lines.push(`node_modules: ${report.effective.nodeModules.dangling ? `link to missing ${shared}; unlink it first, then npm ci here` : `shared install at ${shared}; do not run npm ci or npm install here`}`);
  const settle = report.effective?.lateLaunchSettleMs;
  if (typeof settle === 'number' && settle < LATE_LAUNCH_SETTLE_MS) lines.push(`late-launch settle: ${settle} ms (KAMINOS_LATE_LAUNCH_SETTLE_MS; default ${LATE_LAUNCH_SETTLE_MS} ms); browser launches a test hands to a detached process after it exits may not be caught`);
  const dependents = report.effective?.nodeModules?.linkedFrom?.length || 0;
  if (dependents) lines.push(`node_modules: used by ${dependents} other worktree${dependents === 1 ? '' : 's'} through a link; npm ci or npm install here changes it for them too`);
  if (report.failurePhase) lines.push(`failure phase: ${report.failurePhase}\n${String(report.error).split('\n').filter(line => !/^\s+at\s/.test(line)).join('\n')}`);
  const list = (label, items, hint) => { if (items.length) lines.push(`${label}${hint ? ` (${hint})` : ''}:\n  ${items.join('\n  ')}`); };
  list('new failures', report.newFailures, 'fix them, or quarantine with a class, reason, owner and signature');
  list('unsigned failures', report.results.filter(r => r.outcome === 'unsigned-failure').map(r => `${r.file}: ${r.unsigned}`), 'the file failed but its events cannot be trusted, so it can never be known');
  list('changed failure signatures', report.signatureChanged.map(e => e.added ? `${e.file}\n    added:   ${e.added.join('\n             ') || '(none)'}\n    removed: ${e.removed.join('\n             ') || '(none)'}` : `${e.file}\n    expected: ${e.expected}\n    actual:   ${e.actual}`));
  list('quarantined tests that now pass', report.staleQuarantine, 'remove them from tests/quarantine.json');
  list('unclassified test files', report.unclassified, 'add a first-line "// kaminos-test: node" declaration, or a tests/suite.json entry');
  list('invalid classifications', report.invalid, 'unknown kind, a non-executed kind without a reason, or a declaration that disagrees with tests/suite.json');
  list('invalid quarantine entries', report.invalidQuarantine, 'each needs class, owner, reason and signature');
  list('selectors that matched nothing', report.unmatchedSelectors);
  list('browser launches reached by tests', report.browserLaunchAttempts.map(a => `${a.file}: ${a.args}`), 'classify these tests as browser; a browser-kind test must take its browser from KAMINOS_CHROME');
  list('test roots that are neither run nor excluded', report.uncoveredTestRoots, 'add them to excludedRoots in tests/suite.json with a reason');
  list('manifest entries for missing files', report.orphans.manifest);
  list('quarantine entries for missing files', report.orphans.quarantine);
  if (report.excludedRoots.length) lines.push(`excluded test roots: ${report.excludedRoots.map(e => e.path).join(', ')}`);
  lines.push(`report: ${reportPath}`);
  return lines.join('\n');
}

async function writeArgumentFailure(argv, error) {
  const index = argv.indexOf('--report');
  const reportPath = index >= 0 && argv[index + 1] ? path.resolve(argv[index + 1]) : null;
  if (!reportPath) return;
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify({ schema: REPORT_SCHEMA, ok: false, failurePhase: 'arguments', error: error.message, argv }, null, 2)}\n`);
}

// The run ledger: JSON lines appended to KAMINOS_RUN_LEDGER, or
// ~/.local/state/kaminos/test-runs.jsonl by default; KAMINOS_RUN_LEDGER=off
// turns it off. runSuite never writes it. Each command-line run appends a
// `start` line before it parses its arguments and a `finish` line, with the
// same runId, when it ends: a start with no finish is a run that was killed
// or crashed. An argument failure is a finish in the `arguments` phase.
export function runLedgerPath(env = process.env) {
  if (env.KAMINOS_RUN_LEDGER === 'off') return null;
  if (env.KAMINOS_RUN_LEDGER) return path.resolve(env.KAMINOS_RUN_LEDGER);
  return path.join(os.homedir(), '.local', 'state', 'kaminos', 'test-runs.jsonl');
}

export function runLedgerStart(argv, { runId, cwd = process.cwd(), pid = process.pid } = {}) {
  const index = argv.indexOf('--root');
  const root = path.resolve(cwd, index >= 0 && argv[index + 1] ? argv[index + 1] : '.');
  let branch = null;
  try { branch = execFileSync('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; } catch {}
  return { schema: RUN_LEDGER_SCHEMA, event: 'start', runId, timestamp: new Date().toISOString(), root, branch, pid, argv };
}

export function runLedgerEntry({ report, reportPath }, { durationMs, runId = null }) {
  const effective = report.effective || {};
  return {
    schema: RUN_LEDGER_SCHEMA,
    event: 'finish',
    runId,
    timestamp: report.finishedAt || new Date().toISOString(),
    root: effective.root ?? null,
    branch: effective.git?.branch ?? null,
    head: effective.git?.head ?? null,
    dirty: effective.git?.dirty ?? null,
    selection: effective.only ? effective.only.map(normalizeSelector) : 'full',
    kinds: effective.kinds ?? null,
    sandbox: effective.sandbox ? effective.sandbox.enabled : null,
    ok: report.ok,
    failurePhase: report.failurePhase,
    counts: report.counts,
    warnings: (report.warnings || []).map(w => ({ source: w.source, test: w.test, firstLine: firstLine(w.message) })),
    python: pythonShown(report),
    durationMs,
    report: reportPath,
  };
}

// Appends one line to the ledger and returns null, or, when the ledger cannot
// be written, the warning message: never a failure.
async function appendLedgerLine(entry, what, env = process.env) {
  const ledger = runLedgerPath(env);
  if (!ledger) return null;
  try {
    await fs.mkdir(path.dirname(ledger), { recursive: true });
    await fs.appendFile(ledger, `${JSON.stringify(entry)}\n`);
    return null;
  } catch (error) {
    return `could not append ${what} to ${ledger}: ${firstLine(error?.message || error)}`;
  }
}

// Appends this run's finish line. A ledger that could not be written is one
// warning on the report: the finish line's, or else the start line's.
async function appendRunLedger(result, { durationMs, runId, startWarning = null, env = process.env }) {
  const failed = await appendLedgerLine(runLedgerEntry(result, { durationMs, runId }), 'this run', env);
  const messages = [failed || startWarning].filter(Boolean);
  if (!messages.length) return;
  result.report.warnings ||= [];
  for (const message of messages) result.report.warnings.push({ source: 'run-ledger', test: null, message });
  try { await fs.writeFile(result.reportPath, `${JSON.stringify(result.report, null, 2)}\n`); } catch {}
}

const invokedAsMain = (() => { try { return Boolean(process.argv[1]) && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(path.resolve(process.argv[1])); } catch { return false; } })();
if (invokedAsMain) {
  const argv = process.argv.slice(2);
  const runId = crypto.randomUUID();
  const startWarning = await appendLedgerLine(runLedgerStart(argv, { runId }), "this run's start");
  let args;
  try { args = parseArgs(argv); } catch (error) {
    console.error(error.message);
    if (startWarning) console.error(`warning: ${startWarning}`);
    await writeArgumentFailure(argv, error);
    await appendLedgerLine({ schema: RUN_LEDGER_SCHEMA, event: 'finish', runId, timestamp: new Date().toISOString(), ok: false, failurePhase: 'arguments', error: error.message, argv }, 'this run');
    process.exit(2);
  }
  args.reportPath ||= path.resolve(os.tmpdir(), `kaminos-test-run-${Date.now()}`, 'report.json');
  const controller = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => controller.abort());
  const started = Date.now();
  const result = await runSuite({ ...args, abortSignal: controller.signal, lateLaunchSettleMs: process.env.KAMINOS_LATE_LAUNCH_SETTLE_MS ?? LATE_LAUNCH_SETTLE_MS, sandbox: process.env.KAMINOS_TEST_SANDBOX !== 'off' });
  await appendRunLedger(result, { durationMs: Date.now() - started, runId, startWarning });
  console.log(summarize(result));
  process.exit(result.report.failurePhase === 'interrupted' ? 130 : result.ok ? 0 : 1);
}
