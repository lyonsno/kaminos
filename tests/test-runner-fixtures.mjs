// kaminos-test: helper — fixtures shared by the tests/test-runner-*.mjs contract files
// Fixtures and helpers shared by the test-runner contract files: a temporary
// repository with tests, manifest and quarantine; runSuite and the command line
// pointed at it; and an environment that never reaches the real run ledger.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSuite } from '../tools/test-runner.mjs';

export const PASS = 'process.exit(0);\n';
export const FAIL = "console.error('boom'); process.exit(1);\n";
export const HANG = 'setTimeout(() => {}, 60000);\n';

export async function fixture(t, { files, manifest, quarantine }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kaminos-runner-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'tests'), { recursive: true });
  for (const [name, body] of Object.entries(files)) await fs.writeFile(path.join(root, 'tests', name), body);
  const manifestPath = path.join(root, 'tests', 'suite.json');
  const quarantinePath = path.join(root, 'tests', 'quarantine.json');
  if (manifest !== undefined) await fs.writeFile(manifestPath, typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
  await fs.writeFile(quarantinePath, JSON.stringify({ schema: 'kaminos.test-quarantine.v1', entries: quarantine || {} }));
  const reportPath = path.join(root, 'out', 'report.json');
  return { root, manifestPath, quarantinePath, reportPath };
}

export const manifestOf = tests => ({ schema: 'kaminos.test-suite-manifest.v1', tests });
// browser: null keeps these contracts independent of a KAMINOS_BROWSER set
// in the environment that runs them.
export const run = (f, extra = {}) => runSuite({ root: f.root, manifestPath: f.manifestPath, quarantinePath: f.quarantinePath,
  reportPath: f.reportPath, logsDir: path.join(f.root, 'out', 'logs'), parallel: 2, timeoutMs: 20000, browser: null, ...extra });
export const readReport = async f => JSON.parse(await fs.readFile(f.reportPath, 'utf8'));

// Sets (or, with undefined, clears) an environment variable for one test and
// restores whatever the caller exported, so the contracts hold under any env.
export const scopedEnv = (t, name, value) => {
  const had = Object.hasOwn(process.env, name), saved = process.env[name];
  if (value === undefined) delete process.env[name]; else process.env[name] = value;
  t.after(() => { if (had) process.env[name] = saved; else delete process.env[name]; });
};

// The runner's command line, run with HOME and the run ledger inside the
// fixture so no contract ever writes the real ledger, and without an exported
// KAMINOS_PYTHON unless a contract passes one.
export const CLI = fileURLToPath(new URL('../tools/test-runner.mjs', import.meta.url));
export const cliEnv = (f, extra = {}) => ({ ...process.env, HOME: path.join(f.root, 'home'), KAMINOS_RUN_LEDGER: path.join(f.root, 'run-ledger.jsonl'), KAMINOS_PYTHON: undefined, ...extra });

export const OTHER = "console.error('Error: something else broke'); process.exit(1);\n";

export const quarantined = (signature, extra = {}) => ({ class: 'regression', reason: 'known', owner: 'runner', since: '2026-10-12', signature, ...extra });

export const FAKE_DIST = 'kaminos-fake-dist';

// A stand-in interpreter. It answers the dependency probe, and answers the
// sys.executable query with a fixed path or, like Python, with the path it was
// run by ($0): a venv interpreter run through a link elsewhere loses its venv.
export const stubPython = async (file, { executable = file, installed = { [FAKE_DIST]: '1.0' }, missing = [], selfPath = false } = {}) => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const probeAnswer = JSON.stringify({ python: '9.9.9', executable, installed, missing });
  const answer = selfPath ? 'echo "$0"' : `echo ${JSON.stringify(executable)}`;
  await fs.writeFile(file, `#!/bin/sh\ncase "$2" in *print\\(sys.executable\\)*) ${answer};; *) printf '%s\\n' ${JSON.stringify(probeAnswer)};; esac\n`, { mode: 0o755 });
  return file;
};
