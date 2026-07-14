#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, link, lstat, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

import { createSam31BrowserTrackerPackageProjection } from '../src/sam31-browser-tracker-package.js';
import { verifySam31TwoFramePacketAuthority, verifySam31TwoImageIngressPacketAuthority } from '../src/sam31-packet-artifact.js';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const outDir = resolve(args.get('--out-dir') || 'sam31-browser-tracker-package');
const basePacketDir = args.get('--packet-dir') ? resolve(args.get('--packet-dir')) : null;
const packetNames = ['ingress', 'decoder', 'memory', 'temporal', 'episode', 'pointer'];
const packetDirs = Object.fromEntries(packetNames.map(name => [
  name,
  resolve(args.get(`--${name}-packet-dir`) || (name === 'ingress' ? args.get('--ingress-packet-dir') || '' : basePacketDir ? join(basePacketDir, name) : '')),
]));
const expectedDigests = Object.fromEntries(packetNames.map(name => [name, args.get(`--expected-${name}-manifest-sha256`) || null]));
const sessionId = args.get('--session-id') || 'sam31-session-0';
const reportPath = join(outDir, 'package-report.json');

function assertInside(path, root, label) {
  const offset = relative(root, path);
  if (offset === '' || (!offset.startsWith('..') && !offset.startsWith('/'))) return;
  throw new Error(`${label} escapes owned root: ${path}`);
}

async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return `sha256:${hash.digest('hex')}`;
}

async function writeAtomic(path, text) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, text);
  await rename(temporary, path);
}

async function loadAndVerifyPackets() {
  const packets = {};
  const authorities = {};
  for (const name of packetNames) {
    const packetDir = packetDirs[name];
    if (!packetDir) throw new Error(`${name} packet directory is required`);
    const expectedManifestSha256 = expectedDigests[name];
    if (!expectedManifestSha256) throw new Error(`${name} expected manifest sha256 is required`);
    const manifestText = await readFile(join(packetDir, 'tensor-manifest.json'), 'utf8');
    const manifest = JSON.parse(manifestText);
    const referenceReceipt = JSON.parse(await readFile(join(packetDir, 'reference-receipt.json'), 'utf8'));
    authorities[name] = name === 'ingress'
      ? await verifySam31TwoImageIngressPacketAuthority({ manifestText, manifest, referenceReceipt, expectedManifestSha256 })
      : await verifySam31TwoFramePacketAuthority({
        name,
        authorityName: name === 'episode' ? 'twoImageEpisode' : name,
        manifestText,
        manifest,
        referenceReceipt,
        expectedManifestSha256,
        authenticatedIngress: ['episode', 'pointer'].includes(name)
          ? { manifest: packets.ingress, authority: authorities.ingress }
          : null,
      });
    packets[name] = manifest;
  }
  return { packets, authorities };
}

async function materialize(projection) {
  const evidence = { artifactCount: 0, totalBytes: 0, hardlinkCount: 0, copyCount: 0, reusedCount: 0, hashVerificationCount: 0 };
  for (const artifact of projection.materialization) {
    const sourceRoot = packetDirs[artifact.packetName];
    const source = resolve(sourceRoot, artifact.sourceFile);
    const target = resolve(outDir, artifact.targetFile);
    assertInside(source, sourceRoot, 'packet artifact');
    assertInside(target, outDir, 'package artifact');
    const sourceStat = await stat(source);
    if (sourceStat.size !== artifact.byteLength) throw new Error(`source byte length mismatch for ${artifact.packetName}:${artifact.sourceFile}`);
    const sourceSha256 = await sha256File(source);
    evidence.hashVerificationCount += 1;
    if (sourceSha256 !== artifact.sha256) throw new Error(`source hash mismatch for ${artifact.packetName}:${artifact.sourceFile}: ${sourceSha256} !== ${artifact.sha256}`);
    await mkdir(dirname(target), { recursive: true });
    let targetExists = false;
    try {
      const targetStat = await lstat(target);
      targetExists = targetStat.isFile();
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (targetExists) {
      const targetStat = await stat(target);
      const sameAuthenticatedInode = targetStat.dev === sourceStat.dev && targetStat.ino === sourceStat.ino;
      const targetSha256 = targetStat.size === artifact.byteLength
        ? sameAuthenticatedInode ? sourceSha256 : await sha256File(target)
        : null;
      evidence.hashVerificationCount += targetSha256 && !sameAuthenticatedInode ? 1 : 0;
      if (targetSha256 !== artifact.sha256) {
        await unlink(target);
        targetExists = false;
      } else {
        evidence.reusedCount += 1;
      }
    }
    if (!targetExists) {
      try {
        await link(source, target);
        evidence.hardlinkCount += 1;
      } catch (error) {
        if (!['EXDEV', 'EPERM', 'EACCES', 'EMLINK'].includes(error.code)) throw error;
        await copyFile(source, target);
        evidence.copyCount += 1;
      }
    }
    evidence.artifactCount += 1;
    evidence.totalBytes += artifact.byteLength;
  }
  return evidence;
}

async function main() {
  await mkdir(outDir, { recursive: true });
  let phase = 'verify-packet-authority';
  try {
    const { packets, authorities } = await loadAndVerifyPackets();
    phase = 'project-package-ownership';
    const projection = await createSam31BrowserTrackerPackageProjection({ packets, sessionId, componentAuthorities: authorities });
    phase = 'materialize-authenticated-artifacts';
    const materialization = await materialize(projection);
    phase = 'write-package-manifests';
    await writeAtomic(join(outDir, 'sam31-model-package.json'), projection.texts.modelPackage);
    await writeAtomic(join(outDir, 'sam31-invocation.json'), projection.texts.invocation);
    await writeAtomic(join(outDir, 'sam31-verification.json'), projection.texts.verification);
    await writeAtomic(join(outDir, 'tracker-model-root.json'), projection.texts.modelRoot);
    await writeAtomic(join(outDir, 'tracker-root.json'), projection.texts.root);
    await writeAtomic(join(outDir, 'tracker-runtime-root.json'), projection.texts.runtimeRoot);
    const report = {
      schema: 'kaminos.sam31-browser-tracker-package-report.v0',
      ok: true,
      failurePhase: null,
      outDir,
      packetDirs,
      expectedDigests,
      packageId: projection.modelPackage.packageId,
      invocationId: projection.invocation.invocationId,
      verificationId: projection.verification.verificationId,
      staticArtifactCount: projection.modelPackage.staticArtifacts.length,
      dynamicArtifactCount: projection.invocation.dynamicArtifacts.length,
      verificationTensorCount: Object.values(projection.verification.tensors).reduce((total, entries) => total + entries.length, 0),
      materialization,
      roots: { model: 'tracker-model-root.json', verified: 'tracker-root.json', runtime: 'tracker-runtime-root.json' },
    };
    await writeAtomic(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    const report = { schema: 'kaminos.sam31-browser-tracker-package-report.v0', ok: false, failurePhase: phase, outDir, packetDirs, expectedDigests, error: String(error?.stack || error) };
    await writeAtomic(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    throw error;
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
