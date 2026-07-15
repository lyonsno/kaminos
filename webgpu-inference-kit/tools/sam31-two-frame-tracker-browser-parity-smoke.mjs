#!/usr/bin/env node
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { verifySam31TwoFramePacketAuthority, verifySam31TwoImageIngressPacketAuthority } from '../src/sam31-packet-artifact.js';
import { canonicalSam3IdentityJson, resolveSam3BrowserPackageManifestSync } from '../src/sam-browser-package-manifest.js';
import { SAM31_BROWSER_TRACKER_PACKAGE_CONTRACT } from '../src/sam31-browser-tracker-package.js';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const root = resolve(new URL('..', import.meta.url).pathname);
const packetDir = resolve(args.get('--packet-dir') || mkdtempSync(join(tmpdir(), 'kaminos-sam31-two-frame-')));
const packageDirs = [args.get('--package-dir'), args.get('--second-package-dir')].filter(Boolean).map(path => resolve(path));
const packageMode = packageDirs.length > 0;
const callerInputs = args.get('--caller-inputs') === '1';
if (callerInputs && packageDirs.length !== 2) throw new Error('--caller-inputs requires exactly two package directories');
const packageRootFiles = [
  args.get('--package-root') || (callerInputs ? 'tracker-model-root.json' : 'tracker-root.json'),
  args.get('--second-package-root') || (callerInputs ? 'tracker-model-root.json' : 'tracker-runtime-root.json'),
];
const reportPath = resolve(args.get('--report') || '/tmp/kaminos-sam31-two-frame-tracker-webgpu.json');
const screenshotPath = resolve(args.get('--screenshot') || '/tmp/kaminos-sam31-two-frame-tracker-webgpu.png');
const debugPort = Number(args.get('--debug-port') || 9576);
const serverPort = Number(args.get('--server-port') || 18576);
const timeoutMs = Number(args.get('--timeout-ms') || 300000);
const staticBacking = args.get('--static-backing') || 'memory';
if (!['memory', 'opfs'].includes(staticBacking)) throw new Error(`unsupported --static-backing ${staticBacking}`);
const reusePacket = args.get('--reuse-packet') === '1';
const verifyOnly = args.get('--verify-only') === '1';
const requestedCommit = args.get('--commit') || null;
const episodeMode = packageMode ? 'two-image' : args.get('--episode-mode') || 'propagation-decoder';
if (!['propagation-decoder', 'mask-conditioning', 'two-image'].includes(episodeMode)) throw new Error(`unsupported --episode-mode ${episodeMode}`);
const isTwoImage = episodeMode === 'two-image';
const REPORT_SCHEMA = callerInputs
  ? 'kaminos.sam31-browser-tracker-caller-input.browser-smoke.v0'
  : packageMode
  ? 'kaminos.sam31-browser-tracker-package.browser-smoke.v0'
  : isTwoImage
  ? 'kaminos.sam31-two-image-tracker.browser-parity-smoke.v0'
  : 'kaminos.sam31-two-frame-tracker.browser-parity-smoke.v0';
const episodeAuthorityName = isTwoImage ? 'twoImageEpisode' : episodeMode === 'mask-conditioning' ? 'conditionedEpisode' : 'episode';
const POINTER_EXPECTED_MANIFEST_ARG = '--expected-pointer-manifest-sha256';
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const python = process.env.SAM31_TORCH_PYTHON || '/Users/noahlyons/dev/sf3d/.venv/bin/python';
const userDataDir = args.get('--user-data-dir')
  ? resolve(args.get('--user-data-dir'))
  : mkdtempSync(join(tmpdir(), `kaminos-sam31-two-frame-chrome-${process.pid}-`));
const baseUrl = `http://127.0.0.1:${serverPort}/smokes/${isTwoImage ? 'sam31-two-image-tracker-parity.html' : 'sam31-two-frame-tracker-parity.html'}`;
let url = baseUrl;
const packetTools = {
  ...(isTwoImage ? { ingress: 'sam31-two-image-ingress-meta-packet.py' } : {}),
  decoder: 'sam31-multiplex-mask-decoder-meta-packet.py',
  memory: 'sam31-propagation-memory-meta-packet.py',
  temporal: 'sam31-temporal-memory-bank-meta-packet.py',
  episode: 'sam31-two-frame-tracker-meta-packet.py',
};
if (episodeMode !== 'propagation-decoder') packetTools.pointer = 'sam31-interactive-pointer-meta-packet.py';
const externalIngressPacketDir = args.get('--ingress-packet-dir') ? resolve(args.get('--ingress-packet-dir')) : null;
const packetDirs = Object.fromEntries(Object.keys(packetTools).map(name => [name, name === 'ingress' && externalIngressPacketDir ? externalIngressPacketDir : join(packetDir, name)]));
const expectedManifestSha256 = Object.fromEntries(Object.keys(packetTools).map(name => [
  name,
  args.get(name === 'pointer' ? POINTER_EXPECTED_MANIFEST_ARG : `--expected-${name}-manifest-sha256`) || null,
]));

let phase = 'initializing';
let server;
let chromeProcess;
let browserVersion;
let lastState;
let stderr = '';
let screenshotWritten = false;
let pixelCheck = null;
let viewportLayout = null;
let packetAuthority = null;
let packageAuthority = null;
let commitIdentityEvidence = { requestedCommit, effectiveCommits: [], commitIdentityPassed: requestedCommit == null };
const callerRequestEvidence = {
  schema: 'kaminos.sam31-browser-tracker-caller-request-evidence.v0',
  callerInputMode: callerInputs,
  callerRequests: [],
  packageRequests: [],
  dynamicPackageRequests: [],
};

const delay = milliseconds => new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));
function contentType(path) { const extension = extname(path); return extension === '.html' ? 'text/html; charset=utf-8' : extension === '.js' || extension === '.mjs' ? 'text/javascript; charset=utf-8' : extension === '.json' ? 'application/json; charset=utf-8' : extension === '.png' ? 'image/png' : 'application/octet-stream'; }

function sha256File(path) {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

function deriveMetaCallerImageAuthority(index, framePaths, resolution, sourceRoot) {
  const report = join(userDataDir, `caller-${index}-meta-preprocess.json`);
  const toolArgs = [
    resolve(root, 'tools/sam31-meta-image-preprocess.py'),
    '--source-root', sourceRoot,
    '--resolution', String(resolution),
    '--out', report,
    ...framePaths.flatMap(path => ['--image', path]),
  ];
  const result = spawnSync(python, toolArgs, { cwd: root, encoding: 'utf8', timeout: 120000 });
  if (!existsSync(report)) {
    throw new Error(`caller ${index} Meta preprocessing witness wrote no durable report: ${result.stderr || result.stdout}`);
  }
  const evidence = JSON.parse(readFileSync(report, 'utf8'));
  if (result.status !== 0 || !evidence.ok || !evidence.primaryOutputWritten) {
    throw new Error(`caller ${index} Meta preprocessing witness failed: ${JSON.stringify(evidence)}`);
  }
  const effective = evidence.effective || {};
  if (effective.sourceRoot !== sourceRoot || effective.sourceCommit !== '5dd401d1c5c1d5c3eedff06d41b77af824517619') {
    throw new Error(`caller ${index} Meta preprocessing source identity mismatch`);
  }
  if (effective.algorithm !== 'Meta sam3.model.io_utils.load_resource_as_video_frames list-of-PIL-images branch default Pillow bicubic'
      || effective.defaultResizeFilter !== 'Resampling.BICUBIC'
      || effective.loaderEntryPoint !== 'sam3.model.io_utils.load_resource_as_video_frames'
      || effective.loaderBranch !== 'list-of-PIL-images'
      || effective.loaderExecutionObserved !== true
      || effective.resizeCallCount !== framePaths.length
      || effective.resolution !== resolution) {
    throw new Error(`caller ${index} Meta preprocessing algorithm identity mismatch`);
  }
  if (evidence.images?.length !== framePaths.length
      || evidence.images.some((image, frameIndex) => image.path !== framePaths[frameIndex]
        || JSON.stringify(image.outputSize) !== JSON.stringify([resolution, resolution])
        || image.rgbaByteLength !== resolution * resolution * 4)) {
    throw new Error(`caller ${index} Meta preprocessing image evidence mismatch`);
  }
  return evidence;
}

function loadCallerInput(index) {
  const directory = packageDirs[index];
  const invocation = JSON.parse(readFileSync(join(directory, 'sam31-invocation.json'), 'utf8'));
  const modelPackage = JSON.parse(readFileSync(join(directory, 'sam31-model-package.json'), 'utf8'));
  const sourceRoot = resolve(args.get('--source-root') || '/Users/noahlyons/dev/sam3');
  const framePaths = index === 0
    ? [resolve(args.get('--caller-frame-0') || join(sourceRoot, 'assets/videos/0001/0.jpg')), resolve(args.get('--caller-frame-1') || join(sourceRoot, 'assets/videos/0001/1.jpg'))]
    : [resolve(args.get('--second-caller-frame-0') || join(sourceRoot, 'assets/videos/0001/2.jpg')), resolve(args.get('--second-caller-frame-1') || join(sourceRoot, 'assets/videos/0001/3.jpg'))];
  const maskPath = resolve(directory, invocation.initialMask.file);
  for (const path of [...framePaths, maskPath]) if (!existsSync(path)) throw new Error(`caller input missing: ${path}`);
  const imageHeight = modelPackage.geometry?.ingress?.imageHeight;
  const imageWidth = modelPackage.geometry?.ingress?.imageWidth;
  if (!Number.isInteger(imageHeight) || imageHeight <= 0 || imageHeight !== imageWidth) {
    throw new Error(`caller ${index} model package requires unsupported ingress geometry ${imageHeight}x${imageWidth}`);
  }
  const metaPreprocessEvidence = deriveMetaCallerImageAuthority(index, framePaths, imageHeight, sourceRoot);
  const authority = {
    encodedSourceImageSha256: framePaths.map(sha256File),
    rgbaSourceImageSha256: metaPreprocessEvidence.images.map(image => image.rgbaSha256),
    initialMaskSha256: sha256File(maskPath),
  };
  if (JSON.stringify(authority.encodedSourceImageSha256) !== JSON.stringify(metaPreprocessEvidence.images.map(image => image.encodedSha256))) {
    throw new Error(`caller ${index} encoded images do not match the pinned Meta preprocessing witness`);
  }
  if (JSON.stringify(authority.encodedSourceImageSha256) !== JSON.stringify(invocation.sourceImages.map(image => image.originalSha256))) {
    throw new Error(`caller ${index} encoded images do not match the authenticated ingress authority`);
  }
  if (authority.initialMaskSha256 !== invocation.initialMask.sha256) throw new Error(`caller ${index} mask does not match invocation authority`);
  return {
    framePaths,
    maskPath,
    metaPreprocessEvidence,
    metadata: {
      schema: 'kaminos.sam31-browser-tracker-caller-preload.v0',
      frameUrls: [`/caller/${index}/frame-0`, `/caller/${index}/frame-1`],
      maskUrl: `/caller/${index}/mask`,
      session: invocation.session,
      authority,
    },
  };
}

const callerInputEntries = callerInputs ? packageDirs.map((_, index) => loadCallerInput(index)) : [];

function writeReport(extra = {}) {
  const value = {
    schema: REPORT_SCHEMA,
    ok: false,
    failure_phase: phase,
    url,
    packetDir,
    packetDirs,
    packageDirs,
    packageRootFiles: packageMode ? packageRootFiles.slice(0, packageDirs.length) : [],
    userDataDir,
    staticBacking: packageMode ? staticBacking : null,
    packetSource: packageMode ? 'browser-package' : reusePacket ? 'caller-provided-existing' : 'generated',
    episodeMode,
    packetTools,
    packetAuthority,
    packageAuthority,
    metaPreprocessEvidence: callerInputEntries.map(entry => entry.metaPreprocessEvidence),
    callerRequestEvidence,
    commitIdentityEvidence,
    browserPacketAuthority: lastState?.packetAuthority || null,
    reportPath,
    screenshot: screenshotWritten ? screenshotPath : null,
    primary_output_written: screenshotWritten,
    pixelCheck,
    viewportLayout,
    browserVersion,
    adapterInfo: lastState?.adapterInfo || null,
    requestedRouteIds: lastState?.requestedRouteIds || null,
    effectiveRouteIds: lastState?.effectiveRouteIds || null,
    receipts: lastState?.receipts || null,
    parity: lastState?.parity || null,
    stateTransition: lastState?.stateTransition || null,
    referenceStateTransition: lastState?.referenceStateTransition || null,
    effectiveStateTransition: lastState?.effectiveStateTransition || null,
    routeChainPassed: lastState?.evidence?.routeChainPassed || false,
    stateTransitionPassed: lastState?.evidence?.stateTransitionPassed || false,
    parityPassed: lastState?.evidence?.parityPassed || false,
    evidence: lastState?.evidence || null,
    deviceLoss: lastState?.deviceLoss || null,
    dualInvocationEvidence: lastState?.dualInvocationEvidence || null,
    invocations: lastState?.invocations || null,
    reference: lastState?.manifest?.reference || null,
    lastState,
    stderrTail: stderr.slice(-4000),
    ...extra,
  };
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(value, null, 2));
  return value;
}

async function verifyPacketAuthority() {
  const verifiedPackets = [];
  const packets = {};
  const manifests = {};
  for (const name of Object.keys(packetTools)) {
    const outDir = packetDirs[name];
    const manifestPath = join(outDir, 'tensor-manifest.json');
    const receiptPath = join(outDir, 'reference-receipt.json');
    if (!existsSync(manifestPath)) throw new Error(`${name} manifest missing: ${manifestPath}`);
    if (!existsSync(receiptPath)) throw new Error(`${name} reference receipt missing: ${receiptPath}`);
    const manifestText = readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestText);
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
    const externallyOwned = reusePacket || (name === 'ingress' && externalIngressPacketDir);
    const expectedDigest = expectedManifestSha256[name] || (!externallyOwned ? receipt.outputs?.tensorManifestSha256 : null);
    if (externallyOwned && !expectedDigest) throw new Error(`${name} reused packet requires --expected-${name}-manifest-sha256`);
    packets[name] = name === 'ingress'
      ? await verifySam31TwoImageIngressPacketAuthority({ manifestText, manifest, referenceReceipt: receipt, expectedManifestSha256: expectedDigest })
      : await verifySam31TwoFramePacketAuthority({
        name,
        authorityName: name === 'episode' ? episodeAuthorityName : name,
        manifestText,
        manifest,
        referenceReceipt: receipt,
        expectedManifestSha256: expectedDigest,
        authenticatedIngress: ['episode', 'pointer'].includes(name) && isTwoImage
          ? { manifest: manifests.ingress, authority: packets.ingress }
          : null,
      });
    manifests[name] = manifest;
    expectedManifestSha256[name] = packets[name].manifestSha256;
    verifiedPackets.push(name);
  }
  return { passed: true, verifiedPackets, packets };
}

function verifyPackageAuthority() {
  const roots = packageDirs.map((directory, index) => {
    const rootFile = packageRootFiles[index];
    const rootPath = resolve(directory, rootFile);
    if (rootPath !== directory && !rootPath.startsWith(`${directory}/`)) throw new Error(`package root escapes package directory: ${rootFile}`);
    if (!existsSync(rootPath)) throw new Error(`package root missing: ${rootPath}`);
    const rootManifest = JSON.parse(readFileSync(rootPath, 'utf8'));
    if (callerInputs) {
      if (Object.hasOwn(rootManifest, 'invocation') || Object.hasOwn(rootManifest, 'verification')) {
        throw new Error(`caller model root ${rootFile} contains invocation authority`);
      }
      const ref = rootManifest.modelPackage;
      const modelPackagePath = resolve(directory, ref?.file || '');
      if (!ref || modelPackagePath === directory || !modelPackagePath.startsWith(`${directory}/`) || !existsSync(modelPackagePath)) {
        throw new Error(`caller model root ${rootFile} has an invalid model-package reference`);
      }
      const modelPackageText = readFileSync(modelPackagePath, 'utf8');
      const effectiveSha256 = `sha256:${createHash('sha256').update(modelPackageText).digest('hex')}`;
      if (effectiveSha256 !== ref.sha256) throw new Error(`caller model-package hash mismatch: ${effectiveSha256} !== ${ref.sha256}`);
      const modelPackage = JSON.parse(modelPackageText);
      const identityContract = Object.fromEntries(SAM31_BROWSER_TRACKER_PACKAGE_CONTRACT.modelPackageFields
        .filter(field => field !== 'packageId' && Object.hasOwn(modelPackage, field))
        .map(field => [field, modelPackage[field]]));
      const expectedPackageId = `${SAM31_BROWSER_TRACKER_PACKAGE_CONTRACT.modelPackagePrefix}sha256:${createHash('sha256').update(canonicalSam3IdentityJson(identityContract)).digest('hex')}`;
      if (modelPackage.packageId !== expectedPackageId) throw new Error(`caller model-package identity mismatch: ${modelPackage.packageId} !== ${expectedPackageId}`);
      return {
        directory,
        rootFile,
        packageId: modelPackage.packageId,
        modelOnly: true,
        modelPackage: { ...ref, effectiveSha256 },
        staticArtifactCount: modelPackage.staticArtifacts.length,
      };
    }
    const resolution = resolveSam3BrowserPackageManifestSync(rootManifest, {
      contract: SAM31_BROWSER_TRACKER_PACKAGE_CONTRACT,
      readArtifactText: file => {
        const path = resolve(directory, file);
        if (path !== directory && !path.startsWith(`${directory}/`)) throw new Error(`package artifact escapes package directory: ${file}`);
        return readFileSync(path, 'utf8');
      },
      sha256Text: text => `sha256:${createHash('sha256').update(text).digest('hex')}`,
    });
    return {
      directory,
      rootFile,
      packageId: resolution.manifest.packageId,
      invocationId: resolution.manifest.invocationId,
      verificationId: resolution.manifest.verificationId || null,
      verificationAttached: resolution.evidence.verification.attached,
      encodedSourceImageSha256: resolution.manifest.sourceImages.map(image => image.originalSha256),
      rgbaSourceImageSha256: resolution.manifest.sourceImages.map(image => image.rgbaSha256),
      sourceImageSha256: resolution.manifest.sourceImages.map(image => image.sha256),
      initialMaskSha256: resolution.manifest.initialMask.sha256,
      resolution: resolution.evidence,
    };
  });
  if (roots.some(root => root.packageId !== roots[0].packageId)) throw new Error('browser package roots do not share one model package identity');
  return { passed: true, roots };
}

function generatePackets() {
  for (const [name, tool] of Object.entries(packetTools)) {
    const outDir = packetDirs[name];
    const manifest = join(outDir, 'tensor-manifest.json');
    if (reusePacket || (name === 'ingress' && externalIngressPacketDir)) {
      if (!existsSync(manifest)) throw new Error(`reused ${name} manifest missing: ${manifest}`);
      continue;
    }
    mkdirSync(outDir, { recursive: true });
    const toolArgs = [resolve(root, 'tools', tool), '--out-dir', outDir];
    if (name === 'ingress') {
      const sourceRoot = args.get('--source-root') || '/Users/noahlyons/dev/sam3';
      toolArgs.push('--frame-0', args.get('--frame-0') || join(sourceRoot, 'assets', 'videos', '0001', '0.jpg'));
      toolArgs.push('--frame-1', args.get('--frame-1') || join(sourceRoot, 'assets', 'videos', '0001', '1.jpg'));
      toolArgs.push('--resolution', args.get('--resolution') || '28');
    }
    if (name === 'episode') {
      toolArgs.push('--frame0-mode', isTwoImage ? 'mask-conditioning' : episodeMode);
      if (isTwoImage) {
        const ingressManifestPath = join(packetDirs.ingress, 'tensor-manifest.json');
        const ingressDigest = expectedManifestSha256.ingress || `sha256:${createHash('sha256').update(readFileSync(ingressManifestPath)).digest('hex')}`;
        toolArgs.push('--ingress-packet-dir', packetDirs.ingress, '--expected-ingress-manifest-sha256', ingressDigest);
      }
    }
    if (name === 'pointer' && isTwoImage) {
      const ingressManifestPath = join(packetDirs.ingress, 'tensor-manifest.json');
      const ingressDigest = expectedManifestSha256.ingress || `sha256:${createHash('sha256').update(readFileSync(ingressManifestPath)).digest('hex')}`;
      toolArgs.push('--ingress-dir', packetDirs.ingress, '--expected-ingress-manifest-sha256', ingressDigest);
    }
    const result = spawnSync(python, toolArgs, { cwd: root, encoding: 'utf8', timeout: 240000 });
    if (result.status !== 0) throw new Error(`${name} official packet generation failed: ${result.stderr || result.stdout}`);
  }
}

function startServer() {
  server = createServer((request, response) => {
    try {
      const parsed = new URL(request.url, url);
      const packageMatch = parsed.pathname.match(/^\/package\/(\d+)\/(.+)$/);
      const callerMatch = parsed.pathname.match(/^\/caller\/(\d+)\/(metadata\.json|frame-0|frame-1|mask)$/);
      const match = parsed.pathname.match(/^\/oracle\/(ingress|decoder|memory|temporal|episode|pointer)\/(.+)$/);
      const packageIndex = packageMatch ? Number(packageMatch[1]) : -1;
      if (packageMatch && !packageDirs[packageIndex]) { response.writeHead(404); response.end(`missing package ${packageIndex}`); return; }
      if (packageMatch) {
        callerRequestEvidence.packageRequests.push(parsed.pathname);
        if (/\/(?:invocation|verification)\//.test(parsed.pathname) || /sam31-(?:invocation|verification)\.json$/.test(parsed.pathname)) {
          callerRequestEvidence.dynamicPackageRequests.push(parsed.pathname);
        }
      }
      if (callerMatch) {
        const index = Number(callerMatch[1]);
        const entry = callerInputEntries[index];
        if (!entry) { response.writeHead(404); response.end(`missing caller input ${index}`); return; }
        callerRequestEvidence.callerRequests.push(parsed.pathname);
        if (callerMatch[2] === 'metadata.json') {
          response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
          response.end(JSON.stringify(entry.metadata));
          return;
        }
        const callerPath = callerMatch[2] === 'frame-0' ? entry.framePaths[0] : callerMatch[2] === 'frame-1' ? entry.framePaths[1] : entry.maskPath;
        response.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' });
        response.end(readFileSync(callerPath));
        return;
      }
      const base = packageMatch ? packageDirs[packageIndex] : match ? packetDirs[match[1]] : root;
      const relative = packageMatch ? packageMatch[2] : match ? match[2] : parsed.pathname.slice(1);
      const path = resolve(base, relative || 'smokes/sam31-two-frame-tracker-parity.html');
      if (path !== base && !path.startsWith(`${base}/`)) { response.writeHead(403); response.end('forbidden'); return; }
      if (!existsSync(path)) { response.writeHead(404); response.end(`missing ${parsed.pathname}`); return; }
      response.writeHead(200, { 'content-type': contentType(path), 'cache-control': 'no-store', 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' });
      response.end(readFileSync(path));
    } catch (error) { response.writeHead(500); response.end(String(error?.stack || error)); }
  });
  return new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(serverPort, '127.0.0.1', resolveListen); });
}

async function cdp(path) { const response = await fetch(`http://127.0.0.1:${debugPort}${path}`); if (!response.ok) throw new Error(`CDP ${path} failed ${response.status}`); return response.json(); }
async function waitCdp() { for (let attempt = 0; attempt < 160; attempt += 1) { try { return await cdp('/json/version'); } catch { await delay(125); } } throw new Error('Chrome DevTools endpoint did not open'); }
function wsRequest(socket, method, params = {}, requestTimeout = timeoutMs) {
  const id = socket._id = (socket._id || 0) + 1;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveRequest, reject) => {
    const timer = setTimeout(() => { socket.removeEventListener('message', listener); reject(new Error(`${method} timed out`)); }, requestTimeout);
    const listener = event => { const message = JSON.parse(String(event.data)); if (message.id !== id) return; clearTimeout(timer); socket.removeEventListener('message', listener); if (message.error) reject(new Error(message.error.message)); else resolveRequest(message.result); };
    socket.addEventListener('message', listener);
  });
}
async function evaluate(socket, expression, requestTimeout = timeoutMs) { const result = await wsRequest(socket, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, requestTimeout); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; }

async function inspectPixels(socket, pngBase64, layout) {
  return evaluate(socket, `(async () => {
    const image = new Image(); image.src = ${JSON.stringify(`data:image/png;base64,${pngBase64}`)}; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let sampled = 0, nonBlack = 0, maximumChannel = 0;
    for (let offset = 0; offset < data.length; offset += 16) { const r=data[offset], g=data[offset+1], b=data[offset+2]; sampled++; if (r+g+b>24) nonBlack++; maximumChannel=Math.max(maximumChannel,r,g,b); }
    const heading=${JSON.stringify(layout.heading)}, status=${JSON.stringify(layout.status)};
    const brightFraction=(left,top,right,bottom)=>{let samples=0,signals=0;for(let y=Math.max(0,Math.floor(top));y<Math.min(canvas.height,Math.ceil(bottom));y++){for(let x=Math.max(0,Math.floor(left));x<Math.min(canvas.width,Math.ceil(right));x++){const offset=(y*canvas.width+x)*4,r=data[offset],g=data[offset+1],b=data[offset+2];samples++;if(Math.max(r,g,b)>160&&r+g+b>350)signals++;}}return samples?signals/samples:0;};
    const x=Math.max(0,Math.min(canvas.width-1,Math.round(status.left+1))), top=Math.max(0,Math.min(canvas.height-1,Math.round(status.top+4)));
    let borderSamples=0,borderSignals=0;
    for(let y=top;y<canvas.height;y++){const offset=(y*canvas.width+x)*4,r=data[offset],g=data[offset+1],b=data[offset+2];borderSamples++;if(g>r+30&&g>b+30&&g>100)borderSignals++;}
    return { width:canvas.width,height:canvas.height,nonBlackFraction:sampled?nonBlack/sampled:0,maximumChannel,borderSignalFraction:borderSamples?borderSignals/borderSamples:0,headingSignalFraction:brightFraction(heading.left,heading.top,heading.right,heading.bottom),statusTopSignalFraction:brightFraction(status.left,status.top,status.right,Math.min(status.bottom,status.top+96)) };
  })()`);
}

async function main() {
  let socket;
  try {
    if (packageMode) {
      phase = 'verify_package_authority';
      try {
        packageAuthority = verifyPackageAuthority();
      } catch (error) {
        packageAuthority = { passed: false, error: String(error?.message || error) };
        throw error;
      }
    } else {
      phase = 'generate_official_packets'; generatePackets();
      phase = 'verify_packet_authority';
      try {
        packetAuthority = await verifyPacketAuthority();
      } catch (error) {
        packetAuthority = { passed: false, error: String(error?.message || error) };
        throw error;
      }
    }
    if (verifyOnly) {
      phase = 'write_authority_report';
      const value = writeReport({ ok: true, failure_phase: null });
      process.stdout.write(`${JSON.stringify({ ok: true, reportPath, packetAuthority: value.packetAuthority, packageAuthority: value.packageAuthority }, null, 2)}\n`);
      return;
    }
    const browserParams = new URLSearchParams({ packetSource: packageMode ? 'browser-package' : reusePacket ? 'caller-provided-existing' : 'generated', episodeMode });
    if (packageMode) {
      browserParams.set('staticBacking', staticBacking);
      if (callerInputs) browserParams.set('callerInput', '1');
      packageDirs.forEach((_, index) => browserParams.append('packageRoot', `/package/${index}/${packageRootFiles[index]}`));
    } else {
      for (const name of Object.keys(packetTools)) browserParams.set(`expected-${name}-manifest-sha256`, expectedManifestSha256[name]);
    }
    if (requestedCommit) browserParams.set('commit', requestedCommit);
    url = `${baseUrl}?${browserParams}`;
    phase = 'start_server'; await startServer();
    phase = 'launch_chrome';
    chromeProcess = spawn(chrome, [`--remote-debugging-port=${debugPort}`, `--user-data-dir=${userDataDir}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU,WebGPUDeveloperFeatures', '--js-flags=--expose-gc', '--window-size=1000,560', '--headless=new', url], { stdio: ['ignore', 'ignore', 'pipe'] });
    const spawnError = new Promise((_, rejectSpawn) => chromeProcess.once('error', rejectSpawn));
    chromeProcess.stderr.on('data', chunk => { stderr += chunk.toString(); });
    browserVersion = await Promise.race([waitCdp(), spawnError]);
    const pages = await cdp('/json/list');
    const page = pages.find(item => item.url.includes(isTwoImage ? 'sam31-two-image-tracker-parity' : 'sam31-two-frame-tracker-parity')) || pages[0];
    if (!page?.webSocketDebuggerUrl) throw new Error('Chrome page target missing debugger URL');
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolveOpen, reject) => { socket.addEventListener('open', resolveOpen, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    await wsRequest(socket, 'Runtime.enable'); await wsRequest(socket, 'Page.enable');
    phase = 'wait_browser_parity';
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      lastState = await evaluate(socket, 'window.sam31TwoFrameTrackerParityState?.({ summary: true }) || null', Math.max(1, deadline - Date.now()));
      if (['passed', 'failed'].includes(lastState?.status)) {
        phase = 'read_browser_evidence';
        lastState = await evaluate(socket, 'window.sam31TwoFrameTrackerParityState?.({ evidence: true }) || null', Math.max(1, deadline - Date.now()));
        break;
      }
      await delay(250);
    }
    if (lastState?.status !== 'passed') throw new Error(lastState?.error || `browser ended in ${lastState?.status}`);
    const completedInvocations = lastState.invocations?.length > 0 ? lastState.invocations : [lastState];
    const effectiveCommits = [...new Set(completedInvocations
      .flatMap(invocation => invocation.receipts || [])
      .map(receipt => receipt.kernel?.commit ?? null).filter(Boolean))];
    const commitIdentityPassed = requestedCommit == null
      ? true
      : effectiveCommits.length === 1 && effectiveCommits[0] === requestedCommit;
    commitIdentityEvidence = { requestedCommit, effectiveCommits, commitIdentityPassed };
    if (!commitIdentityPassed) throw new Error(`browser receipt commit identity mismatch: ${JSON.stringify(commitIdentityEvidence)}`);
    if (callerInputs) {
      const expectedCallerRequests = callerInputEntries.flatMap((_, index) => [
        `/caller/${index}/metadata.json`,
        `/caller/${index}/frame-0`,
        `/caller/${index}/frame-1`,
        `/caller/${index}/mask`,
      ]);
      callerRequestEvidence.expectedCallerRequests = expectedCallerRequests;
      callerRequestEvidence.callerPreloadsPassed = callerRequestEvidence.callerRequests.length === expectedCallerRequests.length
        && new Set(callerRequestEvidence.callerRequests).size === expectedCallerRequests.length
        && expectedCallerRequests.every(path => callerRequestEvidence.callerRequests.includes(path));
      callerRequestEvidence.noDynamicPackageRequests = callerRequestEvidence.dynamicPackageRequests.length === 0;
      callerRequestEvidence.passed = callerRequestEvidence.callerPreloadsPassed && callerRequestEvidence.noDynamicPackageRequests;
      if (!callerRequestEvidence.passed) throw new Error(`caller request evidence failed: ${JSON.stringify(callerRequestEvidence)}`);
    }
    phase = 'capture_screenshot';
    viewportLayout = await evaluate(socket, `(() => { const statusElement=document.querySelector('#status'); window.scrollTo(0,0); statusElement.scrollTo(0, 0); const h=document.querySelector('h1').getBoundingClientRect(),s=statusElement.getBoundingClientRect(); return {innerWidth,innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollX,scrollY,statusScrollLeft:statusElement.scrollLeft,statusScrollTop:statusElement.scrollTop,heading:{left:h.left,right:h.right,top:h.top,bottom:h.bottom},status:{left:s.left,right:s.right,top:s.top,bottom:s.bottom},layoutPassed:scrollX===0&&scrollY===0&&statusElement.scrollLeft===0&&statusElement.scrollTop===0&&document.documentElement.scrollWidth<=innerWidth&&h.left>=0&&h.right<=innerWidth&&h.top>=0&&h.bottom<=innerHeight&&s.left>=0&&s.right<=innerWidth&&s.top>=0}; })()`);
    if (!viewportLayout.layoutPassed) throw new Error(`receipt surface clipped: ${JSON.stringify(viewportLayout)}`);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await delay(attempt === 1 ? 300 : 750);
      await evaluate(socket, 'new Promise(resolveFrame => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)))');
      await evaluate(socket, `(() => { window.scrollTo(0,0); const statusElement=document.querySelector('#status'); statusElement.scrollTo(0, 0); return {scrollX,scrollY,statusScrollLeft:statusElement.scrollLeft,statusScrollTop:statusElement.scrollTop}; })()`);
      const shot = await wsRequest(socket, 'Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false, clip: { x: 0, y: 0, width: viewportLayout.innerWidth, height: viewportLayout.innerHeight, scale: 1 } });
      const pixels = await inspectPixels(socket, shot.data, viewportLayout);
      pixelCheck = { ...pixels, attempt, passed: pixels.nonBlackFraction >= 0.05 && pixels.maximumChannel > 24 && pixels.borderSignalFraction >= 0.25 && pixels.headingSignalFraction >= 0.01 && pixels.statusTopSignalFraction >= 0.005 };
      if (!pixelCheck.passed) continue;
      mkdirSync(dirname(screenshotPath), { recursive: true }); writeFileSync(screenshotPath, Buffer.from(shot.data, 'base64')); screenshotWritten = true; break;
    }
    if (!screenshotWritten) throw new Error(`screenshot pixel witness failed: ${JSON.stringify(pixelCheck)}`);
    phase = 'write_report';
    const value = writeReport({ ok: true, failure_phase: null });
    process.stdout.write(`${JSON.stringify({ ok: value.ok, reportPath, screenshot: value.screenshot, adapterInfo: value.adapterInfo, requestedRouteIds: value.requestedRouteIds, effectiveRouteIds: value.effectiveRouteIds, parity: value.parity, evidence: value.evidence, pixelCheck }, null, 2)}\n`);
  } catch (error) {
    const value = writeReport({ ok: false, failure_phase: phase, error: String(error?.stack || error) });
    process.stderr.write(`${JSON.stringify(value, null, 2)}\n`);
    throw error;
  } finally {
    try { socket?.close(); } catch {}
    if (chromeProcess) chromeProcess.kill('SIGTERM');
    if (server) server.close();
  }
}

main().catch(error => { console.error(error); process.exit(1); });
