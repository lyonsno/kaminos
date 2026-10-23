// Copy already-prepared, personally held packages into one importable folder.
// No inference, download or model redistribution is performed.
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export async function prepareLocalModels({ mobrecon, detector, out }) {
  const rows = [];
  for (const [kind, root, schema] of [['mobrecon', mobrecon, 'mobrecon.browser-weight-package.v0'], ['detector', detector, 'wilor-hand-detector.browser-weight-package.v0']]) {
    const metadata = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
    if (metadata.schema !== schema || metadata.status !== 'succeeded' || metadata.resources?.length !== 1) throw Error(`Invalid ${kind} package`);
    const row = metadata.resources[0];
    if (typeof row.file !== 'string' || /[/\\]/.test(row.file)) throw Error(`Invalid ${kind} bundle filename`);
    const data = await fs.readFile(path.join(root, row.file));
    if (data.length !== row.manifest.bundle.byteLength || createHash('sha256').update(data).digest('hex') !== row.manifest.bundle.sha256) throw Error(`${kind} bundle hash/size mismatch`);
    // Public package metadata needs provenance, not the preparer's home path.
    if (metadata.provenance) delete metadata.provenance.sourceRoot;
    rows.push({ kind, metadata, data, file: row.file });
  }
  await fs.mkdir(out); // Never overwrite an existing model folder.
  for (const row of rows) {
    await fs.writeFile(path.join(out, `${row.kind}.package.json`), JSON.stringify(row.metadata, null, 2) + '\n');
    await fs.writeFile(path.join(out, row.file), row.data);
  }
  return { out: path.resolve(out), files: rows.flatMap(row => [`${row.kind}.package.json`, row.file]), distribution: 'local-user-import-not-public-hosting' };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { mobrecon: { type: 'string' }, detector: { type: 'string' }, out: { type: 'string' } } });
  if (!values.mobrecon || !values.detector || !values.out) throw Error('Usage: node demos/hand-mesh/prepare-local-models.mjs --mobrecon <package-dir> --detector <package-dir> --out <new-folder>');
  console.log(JSON.stringify(await prepareLocalModels(values), null, 2));
}
