import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { layout, viewsAround, layoutSheet } from './experiment-scene.mjs';

const { values: first } = parseArgs({ options: { out: { type: 'string' } }, strict: false, allowPositionals: true });
if (!first.out) throw Error('--out required');
await fs.mkdir(first.out, { recursive: true });
const report = { status: 'running', phase: 'arguments', argv: process.argv.slice(2), representation: 'CPU-authored-layout' };
const write = () => fs.writeFile(path.join(first.out, 'plan.json'), JSON.stringify(report, null, 2));
await write();
try {
  const { values } = parseArgs({ options: { out: { type: 'string' }, scene: { type: 'string' }, example: { type: 'string' } } });
  if (!values.scene || !values.example) throw Error('--scene and --example required');
  report.phase = 'compose'; await write();
  const { default: document, layoutOptions, viewOptions } = await import(pathToFileURL(path.resolve(values.example)));
  const objects = layout(document, layoutOptions), views = viewsAround(objects, viewOptions);
  document.camera ||= views.find(v => v.name === 'three-quarter') || views[0];
  await fs.mkdir(path.dirname(path.resolve(values.scene)), { recursive: true });
  await fs.writeFile(values.scene, JSON.stringify(document, null, 2));
  await fs.writeFile(path.join(values.out, 'views.json'), JSON.stringify(views, null, 2));
  await fs.writeFile(path.join(values.out, 'inputs.json'), JSON.stringify({ views: path.resolve(values.out, 'views.json') }, null, 2));
  await fs.writeFile(path.join(values.out, 'layout.svg'), layoutSheet(objects, views));
  Object.assign(report, { status: 'passed', phase: 'complete', scene: path.resolve(values.scene), objects, views });
} catch (error) { report.status = 'failed'; report.failure = error.stack || String(error); process.exitCode = 1; }
finally { await write(); console.log(JSON.stringify(report)); }
