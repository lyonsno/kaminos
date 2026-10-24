#!/usr/bin/env node
import { mkdir, readFile, writeFile, link } from 'node:fs/promises';
import { resolve, dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { sha256 } from './sam-model.mjs';
import { canonicalSam3IdentityJson } from '../src/sam-browser-package-manifest.js';
import { SAM31_BROWSER_TRACKER_PACKAGE_CONTRACT as contract, SAM31_BROWSER_TRACKER_ROOT_SCHEMA } from '../src/sam31-browser-tracker-package.js';

function identity(model) {
  const input = Object.fromEntries(contract.modelPackageFields.filter(k => k !== 'packageId' && Object.hasOwn(model, k)).map(k => [k, model[k]]));
  return contract.modelPackagePrefix + sha256(canonicalSam3IdentityJson(input));
}
function local(directory, file) {
  const path = resolve(directory, file);
  if (!path.startsWith(resolve(directory) + sep)) throw new Error('model artifact escapes its package');
  return path;
}
export async function prepareSam31StreamPackage({ modelPath, controlsPath, outDir }) {
  const output = resolve(outDir);
  await mkdir(output, { recursive: false });
  const report = { schema: 'kaminos.sam31-stream-package-preparation.v1', status: 'running', phase: 'inputs', modelPath, controlsPath };
  try {
    const model = JSON.parse(await readFile(modelPath, 'utf8'));
    if (model.schema !== contract.modelPackageSchema || model.packageId !== identity(model)) throw new Error('base model identity mismatch');
    const controls = JSON.parse(await readFile(controlsPath, 'utf8'));
    if (controls.schema !== 'kaminos.sam31-stream-controls.v1' || controls.status !== 'complete'
        || controls.checkpointSha256 !== model.model.sha256) throw new Error('stream control checkpoint identity mismatch');
    const projected = structuredClone(model), entries = {};
    const artifacts = new Map(projected.staticArtifacts.map(entry => [entry.sha256, entry]));
    report.phase = 'controls';
    for (const [name, count] of [['valid', 4096], ['invalid', 4096], ['noMemory', 256], ['positionMatrix', 256]]) {
      const entry = controls.controls[name];
      if (!entry) throw new Error(`missing control ${name}`);
      const bytes = await readFile(local(dirname(controlsPath), entry.file));
      if (bytes.length !== count * 4 || bytes.length !== entry.byteLength || sha256(bytes) !== entry.sha256) throw new Error(`control ${name} identity mismatch`);
      const file = artifacts.get(entry.sha256)?.file || `static/${entry.sha256.slice(7)}.bin`;
      entries[name] = { ...entry, file };
      if (!artifacts.has(entry.sha256)) {
        const path = local(output, file);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, bytes, { flag: 'wx' });
        artifacts.set(entry.sha256, { file, sha256: entry.sha256, byteLength: bytes.length });
      }
      const artifact = artifacts.get(entry.sha256);
      artifact.aliases ||= [];
      artifact.aliases.push({ role: entry.role, file, packetName: 'stream', kind: 'tensor' });
      Object.assign(entries[name], { packetName: 'stream', kind: 'tensor' });
    }
    report.phase = 'base-artifacts';
    for (const entry of model.staticArtifacts) {
      const target = local(output, entry.file);
      await mkdir(dirname(target), { recursive: true });
      // New manifest, unchanged authenticated base bytes; no second multi-GB copy.
      await link(local(dirname(modelPath), entry.file), target);
    }
    projected.components.stream = {
      schema: 'kaminos.sam31-stream-model.v1', controls: entries,
      source: { checkpointSha256: controls.checkpointSha256, sourceCommit: model.source.commit },
      plan: { numMaskmem: 7, maxConditioningFrames: 4, maxObjectPointerFrames: 16,
        memoryTemporalStride: 1, useMaskmemTemporalPositionV2: true, onlyObjectPointersInPastForEval: true,
        useSignedPointerTemporalPosition: false },
    };
    projected.staticArtifacts = [...artifacts.values()];
    projected.packageId = identity(projected);
    const modelText = JSON.stringify(projected, null, 2);
    report.modelPath = join(output, 'sam31-model-package.json');
    await writeFile(report.modelPath, modelText);
    await writeFile(join(output, 'tracker-model-root.json'), JSON.stringify({ schema: SAM31_BROWSER_TRACKER_ROOT_SCHEMA,
      modelPackage: { file: 'sam31-model-package.json', schema: projected.schema, sha256: sha256(modelText) } }, null, 2));
    Object.assign(report, { status: 'complete', phase: 'complete', packageId: projected.packageId });
    return report;
  } catch (error) { report.status = 'failed'; report.error = String(error); throw error; }
  finally { await writeFile(join(output, 'prepare-report.json'), JSON.stringify(report, null, 2)); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { model: { type: 'string' }, controls: { type: 'string' }, out: { type: 'string' } } });
  if (!values.model || !values.controls || !values.out) throw new Error('--model, --controls and --out are required');
  console.log(JSON.stringify(await prepareSam31StreamPackage({ modelPath: resolve(values.model), controlsPath: resolve(values.controls), outDir: values.out }), null, 2));
}
