import fs from 'node:fs/promises';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {openFluidBrowser, attachFluidBrowser, closeFluidBrowser} from '../fluid-session-browser.mjs';

const {values: early} = parseArgs({options: {out: {type: 'string'}}, strict: false});
if (!early.out) throw Error('--out is required');
const out = path.resolve(early.out);
await fs.mkdir(out, {recursive: true});
const record = {status: 'running', phase: 'arguments', argv: process.argv.slice(2), startedAt: new Date().toISOString()};
const reportPath = path.join(out, 'run.json');
const file = await fs.open(reportPath, 'wx'); await file.close();
const write = () => fs.writeFile(reportPath, JSON.stringify(record, null, 2));
await write();
let connection;
try {
  const {values} = parseArgs({options: {...Object.fromEntries(['out', 'session', 'url', 'repo', 'browser', 'playwright', 'observe', 'exercise', 'inputs']
    .map(name => [name, {type: 'string'}])), close: {type: 'boolean'}}});
  if (!values.session) throw Error('--session is required');
  if (values.close) {
    record.phase = 'close'; await write(); await closeFluidBrowser(values.session);
  } else {
    if (!values.exercise) throw Error('--exercise program is required');
    values.observe ||= new URL('../observation-session.mjs', import.meta.url).pathname;
    record.modules = {};
    for (const [name, filename] of Object.entries({observe: values.observe, exercise: values.exercise,
      ...(values.inputs ? {inputs: values.inputs} : {})})) {
      record.modules[name] = {path: path.resolve(filename),
        sha256: createHash('sha256').update(await fs.readFile(filename)).digest('hex')};
    }
    record.phase = 'connect'; await write();
    connection = values.url
      ? await openFluidBrowser({sessionFile: values.session, url: values.url, repo: values.repo,
        executable: values.browser, playwrightModule: values.playwright})
      : await attachFluidBrowser(values.session);
    record.session = connection.descriptor;
    const {observationSession} = await import(pathToFileURL(path.resolve(values.observe)));
    const {default: exercise} = await import(pathToFileURL(path.resolve(values.exercise)));
    const inputs = values.inputs ? JSON.parse(await fs.readFile(values.inputs, 'utf8')) : {};
    record.phase = 'exercise'; await write();
    record.observations = path.join(out, 'observations', 'report.json');
    const result = await observationSession({out: path.join(out, 'observations'), source: {...connection.descriptor, modules: record.modules},
      capture: () => connection.page.screenshot(),
      exercise: ({retain}) => exercise({fluid: connection.session, page: connection.page, retain, inputs})});
    if (result.status !== 'passed') throw Error('Observation session did not pass');
  }
  record.status = 'passed'; record.phase = 'complete';
} catch (error) {
  record.status = 'failed'; record.failure = String(error.stack || error); process.exitCode = 1;
  if (connection) {
    try {record.lastRuntime = await connection.page.evaluate(() => ({
      clock: window.kaminosFingerFluidBenchSessionState?.(), errors: window.__fluidSessionErrors,
    }));} catch (readError) {record.readFailure = String(readError);}
  }
} finally {
  // Closing a CDP connection disconnects the client; the held browser persists.
  try {await connection?.browser.close();}
  catch (error) {record.disconnectFailure = String(error); record.status = 'failed'; process.exitCode = 1;}
  record.finishedAt = new Date().toISOString(); await write();
  console.log(JSON.stringify({out, status: record.status, failure: record.failure}));
}
