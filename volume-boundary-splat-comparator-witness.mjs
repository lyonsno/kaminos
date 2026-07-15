#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

import { measureBoundarySplatTemporalFrame } from './boundary-splat-temporal-collapse.mjs';

const SCHEMA = 'kaminos.volume.boundary-splat-matched-comparator-witness.v0';
const PHYSICAL_COMMAND_AUTHORITY = 'gpu-indirect-command-buffer-post-submit-readback-v0';
const args = parseArgs(process.argv.slice(2));
const requestedRoute = String(args.get('--url') || '');
const outDir = resolve(String(args.get('--out-dir') || '/tmp/kaminos-boundary-splat-comparator'));
const reportPath = resolve(String(args.get('--report') || `${outDir}/comparator-report.json`));
const port = Number(args.get('--chrome-port') || 19431);
const settleMs = Number(args.get('--settle-ms') ?? 3000);
const warmupSamples = Number(args.get('--warmup-samples') ?? 2);
const steadySamples = Number(args.get('--steady-samples') ?? 8);
const residualGain = Number(args.get('--residual-gain') ?? 8);
const controlMode = String(args.get('--control-lod-mode') || 'fixed');
const treatmentMode = String(args.get('--treatment-lod-mode') || 'projected-area');
const requestedBrowserProfilePath = resolve(String(args.get('--browser-profile') || `${outDir}/chrome-profile`));
const runStartedAt = new Date().toISOString();

let ws = null;
let browser = null;
let browserPageId = null;
let failurePhase = 'startup';
const lastTrustworthyEvidence = {};
mkdirSync(outDir, { recursive: true });

try {
  if (!requestedRoute) throw new Error('missing --url');
  requirePositiveInteger(port, '--chrome-port');
  requireNonnegativeNumber(settleMs, '--settle-ms');
  requireNonnegativeInteger(warmupSamples, '--warmup-samples');
  requirePositiveInteger(steadySamples, '--steady-samples');
  requirePositiveNumber(residualGain, '--residual-gain');
  if (controlMode !== 'fixed' || treatmentMode !== 'projected-area') {
    throw new Error('comparator modes must be fixed control and projected-area treatment');
  }

  failurePhase = 'browser-seat';
  browser = await existingBrowserSeat();
  const page = await findPage();
  browserPageId = page.id;
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await waitForWebSocketOpen(ws);
  await wsRequest('Page.enable');
  await wsRequest('Runtime.enable');

  failurePhase = 'route-load';
  await wsRequest('Page.navigate', { url: requestedRoute });
  await wsRequest('Page.bringToFront');
  await waitForPrototype();
  await delay(settleMs);
  await hideHud();

  failurePhase = 'route-authority';
  const initialState = await waitForTelemetry();
  const effectivePageUrl = await evaluate('location.href');
  const requestedEffectiveRouteAgreement = requestedRouteAgrees(requestedRoute, effectivePageUrl);
  if (!requestedEffectiveRouteAgreement) throw new Error('requested-effective-route-mismatch');
  validateEffectiveState(initialState);
  lastTrustworthyEvidence.initialState = compactState(initialState);
  lastTrustworthyEvidence.effectivePageUrl = effectivePageUrl;
  lastTrustworthyEvidence.requestedEffectiveRouteAgreement = true;

  failurePhase = 'freeze-source';
  const frozen = await evaluate('window.__kaminosVolumePrototype.captureBoundarySplatWitnessFrame()', true);
  if (frozen?.ok !== true || frozen?.exactDrawState?.indirectCommandAgreement !== true) {
    throw new Error(`exact-source-freeze-failed:${JSON.stringify(frozen)}`);
  }
  const sameStateCaptureId = `matched-f${frozen.frameCount}-s${frozen.simStepCount}-h${frozen.historyWriteSlot}`;
  const fixedNow = await evaluate('performance.now()');
  lastTrustworthyEvidence.frozen = frozen;
  lastTrustworthyEvidence.sameStateCaptureId = sameStateCaptureId;

  failurePhase = 'variant-capture';
  const variants = [];
  for (const [role, lodMode] of [['control', controlMode], ['treatment', treatmentMode]]) {
    const capture = await evaluate(`window.__kaminosVolumePrototype.renderFrozenScaleToCanvas(${JSON.stringify({
      sameStateCaptureId,
      baseFrameCount: frozen.frameCount,
      baseSimStepCount: frozen.simStepCount,
      now: fixedNow,
      resumeRenderLoop: false,
      restoreControls: true,
      controlOverrides: { boundarySplatLodMode: lodMode },
    })})`, true);
    validateVariantCapture(capture, frozen, lodMode, sameStateCaptureId);
    lastTrustworthyEvidence.pendingVariant = { role, lodMode, capture };
    const image = await captureCanvas();
    const filename = `${role}-${lodMode}.png`;
    const imagePath = resolve(outDir, filename);
    writeFileSync(imagePath, image.bytes);
    variants.push({
      role,
      lodMode,
      capture,
      boundarySplatProjectedSizeBins: projectedSizeBins(capture.boundarySplatInstanceDescriptors),
      image: { path: imagePath, filename, sha256: sha256(image.bytes), bytes: image.bytes.length, clip: image.clip, metrics: image.metrics },
    });
    lastTrustworthyEvidence.pendingVariant = null;
    lastTrustworthyEvidence.lastVariant = variants.at(-1);
  }
  validateMatchedVariants(variants, frozen);

  failurePhase = 'matched-cost';
  const cost = await evaluate(`window.__kaminosVolumePrototype.sampleBoundarySplatMatchedComparatorCost(${JSON.stringify({
    controlMode,
    treatmentMode,
    warmupSamples,
    steadySamples,
    now: fixedNow,
  })})`, true);
  if (cost?.ok !== true || cost?.simulatorPreserved !== true || cost?.framePreserved !== true) {
    throw new Error(`matched-cost-authority-failed:${JSON.stringify(cost)}`);
  }
  lastTrustworthyEvidence.cost = cost;

  failurePhase = 'comparison-surface';
  const comparisonFilename = 'matched-comparator.html';
  const comparisonPath = resolve(outDir, comparisonFilename);
  writeFileSync(comparisonPath, comparisonHtml({ variants, residualGain, sameStateCaptureId, cost }));
  const comparisonRelativePath = relative(process.cwd(), comparisonPath).split('\\').join('/');
  if (comparisonRelativePath.startsWith('../')) throw new Error('comparison-output-outside-served-worktree');
  const comparisonUrl = new URL(comparisonRelativePath, `${new URL(requestedRoute).origin}/`).href;

  failurePhase = 'resume-and-present';
  const resumed = await evaluate('window.__kaminosVolumePrototype.resumeBoundarySplatWitnessFrame()');
  if (resumed?.ok !== true) throw new Error(`live-loop-resume-failed:${JSON.stringify(resumed)}`);
  await wsRequest('Page.navigate', { url: comparisonUrl });
  await delay(500);
  const comparisonState = await evaluate('window.__kaminosMatchedComparator');
  if (comparisonState?.sameStateCaptureId !== sameStateCaptureId || comparisonState?.rawEvidenceAvailable !== true) {
    throw new Error(`comparison-surface-stale-or-partial:${JSON.stringify(comparisonState)}`);
  }
  const comparisonScreenshot = await wsRequest('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const comparisonSurfaceBytes = Buffer.from(comparisonScreenshot.data, 'base64');
  if (comparisonSurfaceBytes.length < 1024 || comparisonSurfaceBytes.readUInt32BE(0) !== 0x89504e47) {
    throw new Error('comparison-surface-stale-or-partial:invalid-screenshot');
  }
  const comparisonSurfacePath = resolve(outDir, 'comparison-surface.png');
  writeFileSync(comparisonSurfacePath, comparisonSurfaceBytes);
  const comparisonSurfaceImage = {
    path: comparisonSurfacePath,
    sha256: sha256(comparisonSurfaceBytes),
    bytes: comparisonSurfaceBytes.length,
    authority: 'cdp-existing-browser-full-page-comparator-surface-v0',
  };
  lastTrustworthyEvidence.comparisonSurfaceImage = comparisonSurfaceImage;
  const sameBrowserTargetPreserved = await targetIsReachable(browserPageId);
  if (!sameBrowserTargetPreserved) throw new Error('browser-target-unreachable-after-comparator-witness');

  failurePhase = 'complete';
  writeReport({
    schema: SCHEMA,
    status: 'passed',
    claimBoundary: 'matched-static-morphology-and-frozen-gpu-cost; amplified residual locates differences but cannot close beauty or temporal continuity',
    runStartedAt,
    runCompletedAt: new Date().toISOString(),
    requestedRoute,
    effectivePageUrl,
    requestedEffectiveRouteAgreement,
    comparisonUrl,
    comparisonPath,
    comparisonSurfaceImage,
    browser,
    browserPageId,
    sameBrowserTargetPreserved,
    sameStateCaptureId,
    controlMode,
    treatmentMode,
    residualGain,
    frozen,
    route: compactState(initialState),
    variants,
    cost,
    lastTrustworthyEvidence,
  });
} catch (error) {
  writeReport({
    schema: SCHEMA,
    status: 'failed',
    failurePhase,
    failureClass: classifyFailure(error, failurePhase),
    error: error?.stack || error?.message || String(error),
    runStartedAt,
    failedAt: new Date().toISOString(),
    requestedRoute,
    browser,
    browserPageId,
    lastTrustworthyEvidence,
  });
  console.error(error?.stack || error);
  process.exitCode = 1;
} finally {
  ws?.close();
}

function validateVariantCapture(capture, frozen, lodMode, sameStateCaptureId) {
  if (capture?.ok !== true || capture?.sampleAuthority !== 'render-only-frozen-sim-state') throw new Error(`variant-render-failed:${JSON.stringify(capture)}`);
  if (capture.sameStateCaptureId !== sameStateCaptureId || capture.frameCount !== frozen.frameCount || capture.simStepCount !== frozen.simStepCount) {
    throw new Error(`variant-source-state-mismatch:${JSON.stringify(capture)}`);
  }
  if (capture.boundarySplatLodMode !== lodMode || capture.boundarySplatTelemetryLodMode !== lodMode) {
    throw new Error(`stale-or-default-comparator-config:${JSON.stringify({ lodMode, capture })}`);
  }
  if (capture.boundarySplatFallbackReason != null) throw new Error(`fallback-route:${capture.boundarySplatFallbackReason}`);
  if (Number(capture.boundarySplatOverflowCount || 0) !== 0 || Number(capture.boundarySplatCandidateCopyBytes || 0) !== 0) throw new Error('variant-buffer-authority-failed');
  if (capture.boundarySplatIndirectCommandAgreement !== true || capture.boundarySplatIndirectCommandAuthority !== PHYSICAL_COMMAND_AUTHORITY) {
    throw new Error('variant-physical-command-authority-failed');
  }
}

function validateMatchedVariants(variants, frozen) {
  if (variants.length !== 2 || new Set(variants.map(variant => variant.image.sha256)).size < 1) throw new Error('matched-variant-output-incomplete');
  for (const variant of variants) {
    if (variant.capture.frameCount !== frozen.frameCount || variant.capture.simStepCount !== frozen.simStepCount) throw new Error('matched-source-progressed');
    if (variant.capture.boundarySplatSourceCandidateCount !== frozen.exactDrawState.sourceCandidateCount) throw new Error('matched-source-candidate-identity-mismatch');
  }
}

function projectedSizeBins(descriptors) {
  const bins = [
    { id: '0-64', min: 0, max: 64 }, { id: '65-128', min: 64, max: 128 },
    { id: '129-256', min: 128, max: 256 }, { id: '257-384', min: 256, max: 384 },
    { id: '385-640', min: 384, max: 640 }, { id: '641+', min: 640, max: Infinity },
  ];
  return bins.map(bin => {
    const members = (descriptors || []).filter(item => Number(item.projectedDiameterPx) > bin.min && Number(item.projectedDiameterPx) <= bin.max);
    return {
      id: bin.id,
      count: members.length,
      candidateDraws: members.reduce((sum, item) => sum + Number(item.requestedCandidateBudget || 0), 0),
      diametersPx: members.map(item => Number(item.projectedDiameterPx)),
    };
  });
}

function comparisonHtml({ variants, residualGain: gain, sameStateCaptureId, cost }) {
  const [control, treatment] = variants;
  const summary = JSON.stringify({ sameStateCaptureId, rawEvidenceAvailable: true, residualGain: gain, costIdentity: cost.identity });
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kaminos matched flame comparator</title><style>
*{box-sizing:border-box}html,body{margin:0;background:#090a0b;color:#f4f4f2;font:14px system-ui;height:100%}body{display:grid;grid-template-rows:auto 1fr}.bar{display:flex;align-items:center;gap:8px;padding:8px 12px;background:#17191b;border-bottom:1px solid #34383c}.bar button{width:36px;height:32px;border:1px solid #4b5055;background:#222528;color:#eee}.bar button.active{background:#f4b942;color:#111}.bar label{margin-left:auto;color:#bbb}.stage{position:relative;min-height:0;overflow:hidden}.view{display:none;width:100%;height:100%}.view.active{display:flex}.pair{position:relative}.pair img,.raw img{width:50%;height:100%;object-fit:contain;background:#000}.wipe{position:relative}.wipe img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}.wipe .top{clip-path:inset(0 50% 0 0)}.wipe input{position:absolute;left:10%;right:10%;bottom:18px;width:80%;z-index:2}.blink img{width:100%;height:100%;object-fit:contain;background:#000}.residual canvas{width:100%;height:100%;object-fit:contain;background:#000}.tag{position:absolute;top:12px;padding:5px 8px;background:#000b;color:#fff;z-index:3}.tag.a{left:12px}.tag.b{right:12px}
</style></head><body><div class="bar"><button data-view="side-by-side" class="active" title="Side by side">AB</button><button data-view="wipe" title="Wipe">W</button><button data-view="blink" title="Blink">B</button><button data-view="residual" title="Residual">D</button><button data-view="raw" title="Raw evidence">R</button><label>Gain <input id="residualGain" type="range" min="1" max="24" value="${gain}"></label></div><main class="stage"><section id="side-by-side" class="view pair active"><img data-slot="a"><img data-slot="b"><span class="tag a">A</span><span class="tag b">B</span></section><section id="wipe" class="view wipe"><img data-slot="b"><img class="top" data-slot="a"><input id="wipePosition" type="range" min="0" max="100" value="50"></section><section id="blink" class="view blink"><img id="blinkImage"><span class="tag a" id="blinkTag"></span></section><section id="residual" class="view residual"><canvas id="residualCanvas"></canvas></section><section id="raw" class="view raw"><img src="${control.image.filename}" alt="Raw A"><img src="${treatment.image.filename}" alt="Raw B"></section></main><script>
const files=['${control.image.filename}','${treatment.image.filename}'];const swap=new Uint32Array(1);crypto.getRandomValues(swap);const order=swap[0]%2?[1,0]:[0,1];const labels=['A','B'];document.querySelectorAll('[data-slot="a"]').forEach(n=>n.src=files[order[0]]);document.querySelectorAll('[data-slot="b"]').forEach(n=>n.src=files[order[1]]);window.__kaminosMatchedComparator=${summary};window.__kaminosMatchedComparator.blindOrder=order;document.querySelectorAll('.bar button').forEach(b=>b.onclick=()=>{document.querySelectorAll('.bar button').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===b.dataset.view));if(b.dataset.view==='residual')drawResidual()});const wipe=document.getElementById('wipePosition');wipe.oninput=()=>document.querySelector('.wipe .top').style.clipPath='inset(0 '+(100-wipe.value)+'% 0 0)';let blink=0;setInterval(()=>{blink^=1;document.getElementById('blinkImage').src=files[order[blink]];document.getElementById('blinkTag').textContent=labels[blink]},300);const imgs=files.map(src=>{const i=new Image;i.src=src;return i});function drawResidual(){if(!imgs.every(i=>i.complete))return setTimeout(drawResidual,50);const c=document.getElementById('residualCanvas'),w=imgs[0].naturalWidth,h=imgs[0].naturalHeight;c.width=w;c.height=h;const x=c.getContext('2d'),t=document.createElement('canvas');t.width=w;t.height=h;const q=t.getContext('2d');x.drawImage(imgs[0],0,0);const a=x.getImageData(0,0,w,h);q.drawImage(imgs[1],0,0);const b=q.getImageData(0,0,w,h),g=+document.getElementById('residualGain').value;for(let i=0;i<a.data.length;i+=4){a.data[i]=Math.min(255,Math.abs(a.data[i]-b.data[i])*g);a.data[i+1]=Math.min(255,Math.abs(a.data[i+1]-b.data[i+1])*g);a.data[i+2]=Math.min(255,Math.abs(a.data[i+2]-b.data[i+2])*g);a.data[i+3]=255}x.putImageData(a,0,0)}document.getElementById('residualGain').oninput=drawResidual;
</script></body></html>`;
}

async function captureCanvas() {
  const rect = await evaluate(`(() => { const c=document.getElementById('kaminos-volume-canvas'); if(!c?.classList.contains('active'))return null; const r=c.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })()`);
  if (!rect || rect.width < 100 || rect.height < 100) throw new Error(`blank-or-partial-comparator-canvas:${JSON.stringify(rect)}`);
  const clip = { x: Math.max(0, Math.floor(rect.x)), y: Math.max(0, Math.floor(rect.y)), width: Math.floor(rect.width), height: Math.floor(rect.height), scale: 1 };
  const screenshot = await wsRequest('Page.captureScreenshot', { format: 'png', fromSurface: true, clip });
  const bytes = Buffer.from(screenshot.data, 'base64');
  const metrics = measureBoundarySplatTemporalFrame(bytes);
  if (metrics.litPixels <= 200) throw new Error(`blank-or-partial-comparator-canvas:${JSON.stringify(metrics)}`);
  return { bytes, clip, metrics };
}

function validateEffectiveState(state) {
  const mismatches = [];
  if (state?.active !== true || !String(state?.backend || '').toLowerCase().startsWith('webgpu')) mismatches.push(['backend', state?.backend]);
  if (state?.boundarySplatMode !== 'learned') mismatches.push(['mode', state?.boundarySplatMode]);
  if (state?.boundarySplatPbrSceneIdentity !== 'boundary-splat-pbr-fire-field-v0') mismatches.push(['pbr', state?.boundarySplatPbrSceneIdentity]);
  if (Number(state?.boundarySplatRequestedInstanceCount) !== 100) mismatches.push(['instances', state?.boundarySplatRequestedInstanceCount]);
  if (state?.boundarySplatFallbackReason != null) mismatches.push(['fallback', state?.boundarySplatFallbackReason]);
  if (Number(state?.boundarySplatOverflowCount || 0) !== 0 || Number(state?.boundarySplatCopyBytesThisFrame || 0) !== 0) mismatches.push(['buffer', state?.boundarySplatOverflowCount, state?.boundarySplatCopyBytesThisFrame]);
  if (mismatches.length) throw new Error(`stale-or-default-comparator-config:${JSON.stringify(mismatches)}`);
}

function compactState(state) { return { active: state?.active, backend: state?.backend, effectiveRoute: state?.effectiveRoute, rendererIdentity: state?.boundarySplatRendererIdentity, modelIdentity: state?.boundarySplatAttributeModelIdentity, sourceAuthority: state?.boundarySplatSourceAuthority, phaseSourceIdentity: state?.boundarySplatPhaseSourceIdentity, frameCount: state?.frameCount, simStepCount: state?.simStepCount, sourceCandidateCount: state?.boundarySplatSourceCandidateCount, requestedInstanceCount: state?.boundarySplatRequestedInstanceCount, overflowCount: state?.boundarySplatOverflowCount, candidateCopyBytes: state?.boundarySplatCopyBytesThisFrame, fallbackReason: state?.boundarySplatFallbackReason }; }
async function waitForPrototype(){for(let i=0;i<240;i+=1){const s=await debugState();if(s?.active&&s?.backend)return s;await delay(125)}throw new Error('volume-prototype-did-not-become-active')}
async function waitForTelemetry(){for(let i=0;i<240;i+=1){const s=await debugState();if(Number(s?.boundarySplatSourceCandidateCount)>0&&s?.boundarySplatFallbackReason==null)return s;await delay(125)}throw new Error('comparator-telemetry-did-not-settle')}
async function debugState(){return evaluate('window.__kaminosVolumePrototype?.debugState?.()')}
async function hideHud(){return evaluate(`(()=>{const e=document.getElementById('fps-counter');if(e)e.style.visibility='hidden';return true})()`)}

async function existingBrowserSeat(){const p=discoverBrowserProcessIdentity(port);if(resolve(p.browserProfilePath)!==requestedBrowserProfilePath)throw new Error('browser-profile-mismatch');const v=await cdpFetch('/json/version');return{...p,browserVersion:v.Browser||null,continuityBoundary:'existing-persistent-browser-only-no-launch'}}
function discoverBrowserProcessIdentity(chromePort){const marker=`--remote-debugging-port=${chromePort}`;const rows=execFileSync('/bin/ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).split('\n');const p=rows.map(r=>r.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/)).filter(Boolean).map(m=>({pid:+m[1],ppid:+m[2],command:m[3]})).find(x=>x.command.includes(marker)&&x.command.includes('Google Chrome')&&!x.command.includes('--type='));if(!p)throw new Error('browser-process-not-found');const m=p.command.match(/--user-data-dir=(?:"([^"]+)"|'([^']+)'|(\S+))/);const browserProfilePath=m?.[1]||m?.[2]||m?.[3];if(!browserProfilePath)throw new Error('browser-profile-not-found');return{browserProcessId:p.pid,browserParentProcessId:p.ppid,browserProfilePath,chromePort:port,authority:'effective-os-process-command-line'}}
async function cdpFetch(path){const r=await fetch(`http://127.0.0.1:${port}${path}`);if(!r.ok)throw new Error(`CDP ${path} failed`);return r.json()}
async function findPage(){const pages=await cdpFetch('/json/list');const p=pages.find(x=>x.id&&x.type==='page'&&x.url.includes('kaminos_volume_smoke=1'))||pages.find(x=>x.type==='page');if(!p?.webSocketDebuggerUrl)throw new Error('existing Chrome has no targetable page');return p}
async function targetIsReachable(id){return(await cdpFetch('/json/list')).some(x=>x.id===id&&x.type==='page'&&x.webSocketDebuggerUrl)}
function waitForWebSocketOpen(s){return new Promise((ok,bad)=>{s.addEventListener('open',ok,{once:true});s.addEventListener('error',()=>bad(new Error('WebSocket open failed')),{once:true})})}
function wsRequest(method,params={}){const id=ws._nextId=(ws._nextId||0)+1;return new Promise((ok,bad)=>{const msg=e=>{const m=JSON.parse(String(e.data));if(m.id!==id)return;clean();m.error?bad(new Error(`${method}: ${m.error.message}`)):ok(m.result)};const close=()=>{clean();bad(new Error(`${method}: WebSocket closed`))};const clean=()=>{ws.removeEventListener('message',msg);ws.removeEventListener('close',close)};ws.addEventListener('message',msg);ws.addEventListener('close',close,{once:true});ws.send(JSON.stringify({id,method,params}))})}
async function evaluate(expression,awaitPromise=false){const r=await wsRequest('Runtime.evaluate',{expression,awaitPromise,returnByValue:true});if(r.exceptionDetails)throw new Error(`Runtime.evaluate failed:${r.exceptionDetails.text}`);return r.result.value}
function requestedRouteAgrees(a,b){const x=new URL(a),y=new URL(b);if(x.origin!==y.origin||x.pathname!==y.pathname)return false;const xe=canonicalRouteEntries(x),ye=canonicalRouteEntries(y);return xe.length===ye.length&&JSON.stringify(xe)===JSON.stringify(ye)}
function canonicalRouteEntries(url){return[...url.searchParams.entries()].sort(([ak,av],[bk,bv])=>ak.localeCompare(bk)||av.localeCompare(bv))}
function classifyFailure(error,phase){const m=error?.message||String(error);for(const n of ['browser-profile-mismatch','requested-effective-route-mismatch','stale-or-default-comparator-config','fallback-route','blank-or-partial-comparator-canvas','matched-cost-authority-failed','comparison-surface-stale-or-partial'])if(m.includes(n))return n;return phase}
function writeReport(report){mkdirSync(dirname(reportPath),{recursive:true});writeFileSync(reportPath,`${JSON.stringify(report,null,2)}\n`)}
function sha256(bytes){return createHash('sha256').update(bytes).digest('hex')}
function parseArgs(argv){const m=new Map;for(let i=0;i<argv.length;i+=2)m.set(argv[i],argv[i+1]);return m}
function requirePositiveInteger(v,n){if(!Number.isInteger(v)||v<=0)throw new Error(`${n} must be positive`)}
function requireNonnegativeInteger(v,n){if(!Number.isInteger(v)||v<0)throw new Error(`${n} must be nonnegative`)}
function requireNonnegativeNumber(v,n){if(!Number.isFinite(v)||v<0)throw new Error(`${n} must be nonnegative`)}
function requirePositiveNumber(v,n){if(!Number.isFinite(v)||v<=0)throw new Error(`${n} must be positive`)}
function delay(ms){return new Promise(ok=>setTimeout(ok,ms))}
