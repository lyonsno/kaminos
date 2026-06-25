#!/usr/bin/env node
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

import {
  buildMotionDecisionComparison,
  buildGeneratedMotionTrackHarness,
  buildGeneratedPoseOutputMapHarness,
  buildGeneratedPoseTemporalHarness,
  buildMotionPhraseControlHarness,
  buildMotionTrackHarness,
  buildMotionWitnessTimeline,
} from './motion-core.js';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

const url = args.get('--url') || 'http://127.0.0.1:8095/?kaminos_motion_agency=1';
const isPhraseRoute = url.includes('kaminos_motion_phrase=1');
const isPhraseControlRoute = url.includes('kaminos_motion_phrase_controls=1');
const isTrackRoute = url.includes('kaminos_motion_tracks=1');
const isGeneratedTrackRoute = url.includes('kaminos_generated_motion_track=1');
const isOutputMapRoute = url.includes('kaminos_motion_output_map=1');
const isGeneratedPoseTemporalRoute = url.includes('kaminos_generated_pose_temporal=1');
const out = resolve(args.get('--out') || '/tmp/kaminos-motion-agency-witness.png');
const reportPath = resolve(args.get('--report') || out.replace(/\.png$/i, '.json'));
const filmstripPath = resolve(args.get('--filmstrip') || out.replace(/\.png$/i, '-filmstrip.png'));
const port = Number(args.get('--debug-port') || 9444);
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = args.get('--user-data-dir') || `/tmp/kaminos-motion-agency-witness-profile-${port}-${process.pid}`;
const settleMs = Number(args.get('--settle-ms') || 2200);

let phase = 'initializing';
let stderr = '';
let effectiveUrl = null;
let browserVersion = null;
let lastEvidence = {};

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

function writeReport(report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({
    requestedUrl: url,
    effectiveUrl,
    debugPort: port,
    chrome,
    userDataDir,
    settleMs,
    phase,
    browserVersion,
    stderrTail: stderr.slice(-2000),
    ...report,
  }, null, 2));
}

async function cdpFetch(path, options) {
  const resp = await fetch(`http://127.0.0.1:${port}${path}`, options);
  if (!resp.ok) throw new Error(`CDP ${path} failed ${resp.status}`);
  return resp.json();
}

async function isCdpEndpointOpen() {
  try {
    await cdpFetch('/json/version', { signal: AbortSignal.timeout(300) });
    return true;
  } catch {
    return false;
  }
}

async function waitForCdp() {
  for (let i = 0; i < 80; i++) {
    try {
      return await cdpFetch('/json/version');
    } catch {
      await delay(125);
    }
  }
  throw new Error('Chrome DevTools endpoint did not open');
}

function wsRequest(ws, method, params = {}, options = {}) {
  const id = ws._nextId = (ws._nextId || 0) + 1;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveReq, rejectReq) => {
    const timer = setTimeout(() => {
      ws.removeEventListener('message', onMessage);
      rejectReq(new Error(`${method}: CDP request timed out`));
    }, options.timeoutMs || 10000);
    const onMessage = event => {
      const msg = JSON.parse(String(event.data));
      if (msg.id !== id) return;
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
      if (msg.error) rejectReq(new Error(`${method}: ${msg.error.message}`));
      else resolveReq(msg.result);
    };
    ws.addEventListener('message', onMessage);
  });
}

function waitForWebSocketOpen(ws) {
  return new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener('open', resolveOpen, { once: true });
    ws.addEventListener('error', () => rejectOpen(new Error('WebSocket open failed')), { once: true });
  });
}

async function evaluate(ws, expression, options = {}) {
  const result = await wsRequest(ws, 'Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression,
  }, { timeoutMs: options.timeoutMs });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate failed');
  }
  return result.result.value;
}

function assertPngScreenshot(buffer) {
  assert.ok(buffer.length > 1024, 'screenshot is too small to be credible visual evidence');
  assert.equal(buffer.readUInt32BE(0), 0x89504e47, 'screenshot is not a PNG');
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const outBuf = Buffer.alloc(12 + data.length);
  outBuf.writeUInt32BE(data.length, 0);
  typeBuf.copy(outBuf, 4);
  data.copy(outBuf, 8);
  outBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 8 + data.length);
  return outBuf;
}

function writeRgbaPng(path, width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.slice(y * stride, (y + 1) * stride)).copy(raw, y * (stride + 1) + 1);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]));
}

function hexToRgb(hex) {
  const value = String(hex || '#d8c38e').replace('#', '');
  const n = Number.parseInt(value.length === 3 ? value.split('').map(ch => ch + ch).join('') : value, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function drawCircle(rgba, width, height, cx, cy, radius, color, alpha = 1) {
  const [r, g, b] = color;
  const minX = Math.max(0, Math.floor(cx - radius));
  const maxX = Math.min(width - 1, Math.ceil(cx + radius));
  const minY = Math.max(0, Math.floor(cy - radius));
  const maxY = Math.min(height - 1, Math.ceil(cy + radius));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d > radius) continue;
      const i = (y * width + x) * 4;
      const falloff = (1 - d / radius) * alpha;
      rgba[i] = Math.max(rgba[i], Math.round(r * falloff));
      rgba[i + 1] = Math.max(rgba[i + 1], Math.round(g * falloff));
      rgba[i + 2] = Math.max(rgba[i + 2], Math.round(b * falloff));
      rgba[i + 3] = 255;
    }
  }
}

function drawFilmstrip(timeline, path) {
  const panelWidth = 220;
  const panelHeight = 160;
  const width = panelWidth * timeline.filmstrip.length;
  const height = panelHeight;
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 5;
    rgba[i + 1] = 6;
    rgba[i + 2] = 8;
    rgba[i + 3] = 255;
  }
  timeline.filmstrip.forEach((frame, panelIndex) => {
    const x0 = panelIndex * panelWidth;
    for (let y = 0; y < panelHeight; y++) {
      const borderIndex = (y * width + x0) * 4;
      rgba[borderIndex] = 88;
      rgba[borderIndex + 1] = 72;
      rgba[borderIndex + 2] = 35;
    }
    for (const actor of frame.actors) {
      const cx = x0 + panelWidth * 0.5 + actor.root[0] * 42;
      const cy = panelHeight * 0.68 - actor.root[2] * 38 - actor.root[1] * 12;
      const color = hexToRgb(actor.color);
      drawCircle(rgba, width, height, cx, cy, 11 + actor.effort * 9, color, 0.92);
      drawCircle(rgba, width, height, cx + actor.facing[0] * 15, cy - actor.facing[2] * 15, 3.5, [255, 255, 255], 0.9);
    }
  });
  writeRgbaPng(path, width, height, rgba);
  return { path, width, height, frames: timeline.filmstrip.length };
}

let chromeProcess = null;

try {
  phase = 'checking-debug-port';
  if (await isCdpEndpointOpen()) throw new Error(`CDP debug port already in use before launch: ${port}`);

  phase = 'rendering-filmstrip';
  const timeline = isGeneratedPoseTemporalRoute
    ? buildGeneratedPoseTemporalHarness({ fps: 12, filmstripFrames: 7 })
    : (isOutputMapRoute
    ? buildGeneratedPoseOutputMapHarness({ fps: 12, filmstripFrames: 7 })
    : (isGeneratedTrackRoute
    ? buildGeneratedMotionTrackHarness({ fps: 12, filmstripFrames: 7 })
    : (isTrackRoute
    ? buildMotionTrackHarness({ duration: 5.4, fps: 12, filmstripFrames: 7 })
    : (isPhraseControlRoute
    ? buildMotionPhraseControlHarness({ duration: 7.2, fps: 12, filmstripFrames: 7 })
    : (isPhraseRoute
      ? buildMotionDecisionComparison({ duration: 7.2, fps: 12, filmstripFrames: 7 })
      : buildMotionWitnessTimeline({ duration: 5.2, fps: 12, filmstripFrames: 6 }))))));
  const filmstrip = drawFilmstrip(timeline, filmstripPath);
  if (isGeneratedPoseTemporalRoute) {
    lastEvidence.generatedPoseTemporalHarness = {
      schema: timeline.schema,
      route: timeline.route,
      sourceStatus: timeline.sourceStatus,
      sourceKind: timeline.sourceKind,
      sourceModel: timeline.sourceModel,
      sourceRoute: timeline.sourceRoute,
      sourceFormat: timeline.sourceFormat,
      inputSha256: timeline.inputSha256,
      sampleCount: timeline.sampleCount,
      sourceFrameStride: timeline.sourceFrameStride,
      track: {
        schema: timeline.track.schema,
        id: timeline.track.id,
        sourceKind: timeline.track.sourceKind,
        sourceStatus: timeline.track.sourceStatus,
        sourceModel: timeline.track.sourceModel,
        sourceRoute: timeline.track.sourceRoute,
        rawFrameCount: timeline.track.rawFrameCount,
        fps: timeline.track.fps,
        duration: timeline.track.duration,
        jointMapping: timeline.track.jointMapping,
        extractionAssumptions: timeline.track.extractionAssumptions,
      },
      metrics: timeline.metrics,
      filmstrip,
    };
  } else if (isOutputMapRoute) {
    lastEvidence.generatedPoseOutputMapHarness = {
      schema: timeline.schema,
      route: timeline.route,
      sourceStatus: timeline.sourceStatus,
      sourceKind: timeline.sourceKind,
      sourceRoute: timeline.sourceRoute,
      outputMap: {
        schema: timeline.outputMap.schema,
        ok: timeline.outputMap.ok,
        route: timeline.outputMap.route,
        source: timeline.outputMap.source,
        summary: timeline.outputMap.summary,
      },
      inputSocketCount: timeline.inputSocketCount,
      outputSocketCount: timeline.outputSocketCount,
      edgeCount: timeline.edgeCount,
      strongestOutput: timeline.strongestOutput,
      maxOutputValue: timeline.maxOutputValue,
      normalizedOutputs: timeline.normalizedOutputs,
      metrics: timeline.metrics,
      filmstrip,
    };
  } else if (isGeneratedTrackRoute) {
    lastEvidence.generatedMotionTrackHarness = {
      schema: timeline.schema,
      route: timeline.route,
      sourceStatus: timeline.sourceStatus,
      sourceKind: timeline.sourceKind,
      sourceModel: timeline.sourceModel,
      sourceRoute: timeline.sourceRoute,
      prompt: timeline.prompt,
      track: {
        schema: timeline.track.schema,
        id: timeline.track.id,
        sourceKind: timeline.track.sourceKind,
        sourceStatus: timeline.track.sourceStatus,
        sourceModel: timeline.track.sourceModel,
        sourceRoute: timeline.track.sourceRoute,
        prompt: timeline.track.prompt,
        rawFrameCount: timeline.track.rawFrameCount,
        fps: timeline.track.fps,
        units: timeline.track.units,
        jointMapping: timeline.track.jointMapping,
        extractionAssumptions: timeline.track.extractionAssumptions,
      },
      variants: timeline.variants.map(variant => ({
        id: variant.id,
        label: variant.label,
        kind: variant.kind,
        attentionMode: variant.attentionMode,
        verticalDisplayScale: Number(variant.verticalDisplayScale || 1),
        metrics: variant.metrics,
      })),
      filmstrip,
    };
  } else if (isTrackRoute) {
    lastEvidence.motionTrackHarness = {
      schema: timeline.schema,
      route: timeline.route,
      track: {
        schema: timeline.track.schema,
        id: timeline.track.id,
        sourceKind: timeline.track.sourceKind,
        sourceRoute: timeline.track.sourceRoute,
        fps: timeline.track.fps,
        units: timeline.track.units,
      },
      variants: timeline.variants.map(variant => ({
        id: variant.id,
        label: variant.label,
        kind: variant.kind,
        metrics: variant.metrics,
      })),
      filmstrip,
    };
  } else if (isPhraseControlRoute) {
    lastEvidence.phraseControlHarness = {
      schema: timeline.schema,
      route: timeline.route,
      basePlanId: timeline.basePlanId,
      variants: timeline.variants.map(variant => ({
        id: variant.id,
        label: variant.label,
        effectiveControls: variant.effectiveControls,
        metrics: variant.metrics,
      })),
      filmstrip,
    };
  } else if (isPhraseRoute) {
    lastEvidence.decisionComparison = {
      schema: timeline.schema,
      route: timeline.route,
      naive: {
        actor: timeline.naive.actor,
        metrics: timeline.naive.metrics,
      },
      phrased: {
        actor: timeline.phrased.actor,
        metrics: timeline.phrased.metrics,
      },
      filmstrip,
    };
  } else {
    lastEvidence.timeline = {
      schema: timeline.schema,
      route: timeline.route,
      requestedClipIds: timeline.requestedClipIds,
      effectiveClipIds: timeline.effectiveClipIds,
      fallbackCount: timeline.fallbackCount,
      metrics: timeline.metrics,
      filmstrip,
    };
  }

  phase = 'launching-chrome';
  mkdirSync(userDataDir, { recursive: true });
  chromeProcess = spawn(chrome, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--disable-background-networking',
    '--disable-default-apps',
    '--window-size=1400,900',
    url,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  chromeProcess.stderr.on('data', chunk => { stderr += chunk.toString(); });
  chromeProcess.once('error', error => { stderr += `\nChrome launch failed: ${error.message}`; });

  phase = 'connecting-cdp';
  const version = await waitForCdp();
  browserVersion = version.Browser || null;
  const pages = await cdpFetch('/json/list');
  const page = pages.find(entry => entry.type === 'page') || pages[0];
  if (!page?.webSocketDebuggerUrl) throw new Error('No debuggable Chrome page found');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await waitForWebSocketOpen(ws);
  await wsRequest(ws, 'Page.enable');
  await wsRequest(ws, 'Runtime.enable');

  phase = 'settling-route';
  await delay(settleMs);
  effectiveUrl = await evaluate(ws, 'window.location.href');
  const routeParam = isGeneratedPoseTemporalRoute
    ? 'kaminos_generated_pose_temporal=1'
    : (isOutputMapRoute
    ? 'kaminos_motion_output_map=1'
    : (isGeneratedTrackRoute
    ? 'kaminos_generated_motion_track=1'
    : (isPhraseControlRoute
    ? 'kaminos_motion_phrase_controls=1'
    : (isTrackRoute
      ? 'kaminos_motion_tracks=1'
      : (isPhraseRoute ? 'kaminos_motion_phrase=1' : 'kaminos_motion_agency=1')))));
  if (!effectiveUrl.includes(routeParam)) throw new Error(`effective URL lost motion route ${routeParam}: ${effectiveUrl}`);
  const debugExpression = isGeneratedPoseTemporalRoute
    ? 'window.kaminosGeneratedPoseTemporalDebugState?.()'
    : (isOutputMapRoute
    ? 'window.kaminosGeneratedPoseOutputMapDebugState?.()'
    : (isGeneratedTrackRoute
    ? 'window.kaminosGeneratedMotionTrackDebugState?.()'
    : (isPhraseControlRoute
    ? 'window.kaminosMotionPhraseControlDebugState?.()'
    : (isTrackRoute
      ? 'window.kaminosMotionTrackDebugState?.()'
      : (isPhraseRoute
      ? 'window.kaminosMotionDecisionDebugState?.()'
      : 'window.kaminosMotionAgencyDebugState?.()')))));
  let debug = null;
  for (let i = 0; i < 48; i++) {
    debug = await evaluate(ws, debugExpression, { timeoutMs: 10000 });
    if (debug?.route) break;
    await delay(125);
  }
  lastEvidence.debug = debug;
  if (debug?.route !== 'procedural-orb-motion-grammar-v0') throw new Error(`motion route identity mismatch: ${JSON.stringify(debug)}`);
  if (isGeneratedPoseTemporalRoute) {
    for (let i = 0; i < 24; i++) {
      const actor = debug?.actors?.[0];
      const bracket = actor?.sourceBracket;
      const sourceInterpolation = Number(actor?.sourceInterpolation);
      if (
        Number.isFinite(sourceInterpolation)
        && sourceInterpolation > 0
        && sourceInterpolation < 1
        && bracket?.fromFrame !== bracket?.toFrame
      ) break;
      await delay(83);
      debug = await evaluate(ws, debugExpression, { timeoutMs: 10000 });
      lastEvidence.debug = debug;
    }
    const generatedPoseTemporalHarness = debug?.generatedPoseTemporalHarness;
    const actor = debug?.actors?.[0];
    const sourceInterpolation = Number(actor?.sourceInterpolation);
    const sourceBracket = actor?.sourceBracket;
    const sampler = String(actor?.sampler || '');
    if (!debug?.active || debug.actorCount < 1) throw new Error(`generated pose temporal route did not spawn temporal actor: ${JSON.stringify(debug)}`);
    if (generatedPoseTemporalHarness?.schema !== 'kaminos.generated-pose-temporal-harness.v0') throw new Error(`generated pose temporal route lost harness schema: ${JSON.stringify(debug)}`);
    if (generatedPoseTemporalHarness.track?.id !== 'kimodo_theatrical_bow_temporal_v0') throw new Error(`generated pose temporal route lost Kimodo bow track identity: ${JSON.stringify(debug)}`);
    if (!String(generatedPoseTemporalHarness.sourceRoute || '').includes('03_a_person_performs_an_exaggerated_theatrical_bow_sw.npz')) throw new Error(`generated pose temporal route lost source route: ${JSON.stringify(debug)}`);
    if (generatedPoseTemporalHarness.sourceFormat !== 'kimodo-soma77-explicit-joints') throw new Error(`generated pose temporal route lost source format: ${JSON.stringify(debug)}`);
    if (!(generatedPoseTemporalHarness.sampleCount >= 16)) throw new Error(`generated pose temporal route lost sample count: ${JSON.stringify(debug)}`);
    if (!(generatedPoseTemporalHarness.metrics?.maxBowCompression > 0.25)) throw new Error(`generated pose temporal route lost bow compression: ${JSON.stringify(debug)}`);
    if (!generatedPoseTemporalHarness.metrics?.phaseLabels?.includes('compress')) throw new Error(`generated pose temporal route lost compress phase: ${JSON.stringify(debug)}`);
    if (!generatedPoseTemporalHarness.metrics?.phaseLabels?.includes('release')) throw new Error(`generated pose temporal route lost release phase: ${JSON.stringify(debug)}`);
    if (!(Number.isFinite(sourceInterpolation) && sourceInterpolation > 0 && sourceInterpolation < 1)) throw new Error(`generated pose temporal route lost sourceInterpolation evidence: ${JSON.stringify(debug)}`);
    if (!sourceBracket || sourceBracket.fromFrame === sourceBracket.toFrame) throw new Error(`generated pose temporal route lost sourceBracket interpolation evidence: ${JSON.stringify(debug)}`);
    if (sampler !== 'catmull-rom-continuous-velocity') throw new Error(`generated pose temporal route lost catmull-rom-continuous-velocity sampler evidence: ${JSON.stringify(debug)}`);
  } else if (isOutputMapRoute) {
    const generatedPoseOutputMapHarness = debug?.generatedPoseOutputMapHarness;
    if (!debug?.active || debug.actorCount < 1) throw new Error(`generated pose output-map route did not spawn mapped actor: ${JSON.stringify(debug)}`);
    if (generatedPoseOutputMapHarness?.schema !== 'kaminos.generated-pose-output-map-harness.v0') throw new Error(`generated pose output-map route lost harness schema: ${JSON.stringify(debug)}`);
    if (generatedPoseOutputMapHarness.outputMap?.schema !== 'kaminos.generated-pose-output-map.v0') throw new Error(`generated pose output-map route lost output-map schema: ${JSON.stringify(debug)}`);
    if (debug.outputSocketCount !== 7 || debug.edgeCount !== 7) throw new Error(`generated pose output-map route lost socket/edge counts: ${JSON.stringify(debug)}`);
    if (debug.strongestOutput !== 'body.scalePulse') throw new Error(`generated pose output-map route lost strongest output: ${JSON.stringify(debug)}`);
    if (!(debug.normalizedOutputs?.['body.scalePulse']?.value > 0.95)) throw new Error(`generated pose output-map route lost body.scalePulse value: ${JSON.stringify(debug)}`);
    if (!(debug.normalizedOutputs?.['aura.radius']?.value > 0.9)) throw new Error(`generated pose output-map route lost aura.radius value: ${JSON.stringify(debug)}`);
    if (debug.normalizedOutputs?.['trail.accent']?.event?.channel !== 'leftHand') throw new Error(`generated pose output-map route lost trail.accent event channel: ${JSON.stringify(debug)}`);
    if (!(generatedPoseOutputMapHarness.metrics?.maxAuraRadius > 1.25)) throw new Error(`generated pose output-map route lost visible aura metric: ${JSON.stringify(debug)}`);
    if (!(generatedPoseOutputMapHarness.metrics?.maxBodyScale > 1.2)) throw new Error(`generated pose output-map route lost visible body-scale metric: ${JSON.stringify(debug)}`);
    if (!(generatedPoseOutputMapHarness.metrics?.maxTrailAccent > 0.65)) throw new Error(`generated pose output-map route lost visible trail-accent metric: ${JSON.stringify(debug)}`);
  } else if (isGeneratedTrackRoute) {
    const generatedMotionTrackHarness = debug?.generatedMotionTrackHarness;
    if (!debug?.active || debug.actorCount < 2) throw new Error(`generated motion track route did not spawn comparison actors: ${JSON.stringify(debug)}`);
    if (generatedMotionTrackHarness?.schema !== 'kaminos.generated-motion-track-harness.v0') throw new Error(`generated motion track route lost harness schema: ${JSON.stringify(debug)}`);
    if (generatedMotionTrackHarness.track?.schema !== 'kaminos.motion-track.v0') throw new Error(`generated motion track route lost track schema: ${JSON.stringify(debug)}`);
    if (generatedMotionTrackHarness.sourceStatus !== 'fixture') throw new Error(`generated motion track route lost fixture source status: ${JSON.stringify(debug)}`);
    if (!String(generatedMotionTrackHarness.sourceRoute || '').includes('motion-diffusion-model/save')) throw new Error(`generated motion track route lost model route identity: ${JSON.stringify(debug)}`);
    const generated = generatedMotionTrackHarness.variants?.find(variant => variant.id === 'generated_dip_wave');
    if (!generated) throw new Error(`generated motion track route lost generated variant: ${JSON.stringify(debug)}`);
    if (!(generated.metrics?.rootTravel > 4.5)) throw new Error(`generated motion track route lost root travel: ${JSON.stringify(debug)}`);
    if (!(generated.metrics?.rootVerticalRange > 0.025)) throw new Error(`generated motion track route lost raw vertical root motion: ${JSON.stringify(debug)}`);
    if (!(generated.metrics?.maxEffort > 0.45)) throw new Error(`generated motion track route lost effort envelope: ${JSON.stringify(debug)}`);
  } else if (isTrackRoute) {
    const motionTrackHarness = debug?.motionTrackHarness;
    if (!debug?.active || debug.actorCount < 3) throw new Error(`motion track route did not spawn comparison actors: ${JSON.stringify(debug)}`);
    if (motionTrackHarness?.schema !== 'kaminos.motion-track-harness.v0') throw new Error(`motion track route lost harness schema: ${JSON.stringify(debug)}`);
    if (motionTrackHarness.track?.schema !== 'kaminos.motion-track.v0') throw new Error(`motion track route lost track schema: ${JSON.stringify(debug)}`);
    const massOnly = motionTrackHarness.variants?.find(variant => variant.id === 'track_mass_only');
    const massAttention = motionTrackHarness.variants?.find(variant => variant.id === 'track_mass_attention');
    if (massOnly?.attentionMode !== 'mass-only' || massAttention?.attentionMode !== 'mass-attention') {
      throw new Error(`motion track route lost attention-mode contrast identity: ${JSON.stringify(debug)}`);
    }
    if (!(massAttention?.metrics?.attentionLeadDistance > massOnly?.metrics?.attentionLeadDistance)) {
      throw new Error(`motion track route lost mass+attention lead advantage: ${JSON.stringify(debug)}`);
    }
    if (!(massAttention?.metrics?.maxHeadRootSeparation > massOnly?.metrics?.maxHeadRootSeparation)) {
      throw new Error(`motion track route lost mass+attention separation advantage: ${JSON.stringify(debug)}`);
    }
    if (!(massAttention?.metrics?.attentionMassContrast > massOnly?.metrics?.attentionMassContrast)) {
      throw new Error(`motion track route lost mass/attention contrast advantage: ${JSON.stringify(debug)}`);
    }
  } else if (isPhraseControlRoute) {
    const phraseControlHarness = debug?.phraseControlHarness;
    if (!debug?.active || debug.actorCount < 1) throw new Error(`motion phrase-control route did not spawn controlled actor: ${JSON.stringify(debug)}`);
    if (phraseControlHarness?.schema !== 'kaminos.motion-phrase-control-harness.v0') throw new Error(`motion phrase-control route lost harness schema: ${JSON.stringify(debug)}`);
    if (debug.effectiveControls?.schema !== 'kaminos.motion-phrase-controls.v0') throw new Error(`motion phrase-control route lost effectiveControls: ${JSON.stringify(debug)}`);
    const hesitant = phraseControlHarness.variants?.find(variant => variant.id === 'hesitant_curious');
    const sharp = phraseControlHarness.variants?.find(variant => variant.id === 'sharp_aggressive');
    if (!(hesitant?.metrics?.anticipationDepth > sharp?.metrics?.anticipationDepth)) {
      throw new Error(`motion phrase-control route lost hesitant anticipation advantage: ${JSON.stringify(debug)}`);
    }
    if (!(sharp?.metrics?.overshootDistance > hesitant?.metrics?.overshootDistance)) {
      throw new Error(`motion phrase-control route lost sharp overshoot advantage: ${JSON.stringify(debug)}`);
    }
  } else if (isPhraseRoute) {
    const decisionComparison = debug?.decisionComparison;
    if (!debug?.active || debug.actorCount < 2) throw new Error(`motion phrase route did not spawn comparison actors: ${JSON.stringify(debug)}`);
    if (decisionComparison?.schema !== 'kaminos.motion-decision-comparison.v0') throw new Error(`motion phrase route lost comparison schema: ${JSON.stringify(debug)}`);
    if (!(decisionComparison.phrased.metrics.anticipationDepth > decisionComparison.naive.metrics.anticipationDepth)) {
      throw new Error(`motion phrase route lost anticipationDepth advantage: ${JSON.stringify(debug)}`);
    }
    if (!(decisionComparison.phrased.metrics.overshootDistance > decisionComparison.naive.metrics.overshootDistance)) {
      throw new Error(`motion phrase route lost overshootDistance advantage: ${JSON.stringify(debug)}`);
    }
  } else {
    if (!debug?.active || debug.actorCount < 5) throw new Error(`motion route did not spawn actor fixture: ${JSON.stringify(debug)}`);
    if (debug.fallbackCount !== 0) throw new Error(`default fixture unexpectedly used fallbacks: ${JSON.stringify(debug)}`);
    if (!debug.requestedClipIds?.includes('stalk_bad_intent')) throw new Error(`motion route lost requestedClipIds: ${JSON.stringify(debug)}`);
    if (!debug.effectiveClipIds?.includes('orbit_inspect')) throw new Error(`motion route lost effectiveClipIds: ${JSON.stringify(debug)}`);
  }

  phase = 'capturing-screenshot';
  const shot = await wsRequest(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: true });
  const png = Buffer.from(shot.data, 'base64');
  assertPngScreenshot(png);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, png);

  phase = 'writing-report';
  writeReport({
    ok: true,
    screenshot: { path: out, bytes: png.length },
    filmstrip,
    requestedClipIds: debug.requestedClipIds || [],
    effectiveClipIds: debug.effectiveClipIds || [],
    fallbackCount: debug.fallbackCount || 0,
    decisionComparison: debug.decisionComparison || lastEvidence.decisionComparison || null,
    phraseControlHarness: debug.phraseControlHarness || lastEvidence.phraseControlHarness || null,
    motionTrackHarness: debug.motionTrackHarness || lastEvidence.motionTrackHarness || null,
    generatedMotionTrackHarness: debug.generatedMotionTrackHarness || lastEvidence.generatedMotionTrackHarness || null,
    generatedPoseOutputMapHarness: debug.generatedPoseOutputMapHarness || lastEvidence.generatedPoseOutputMapHarness || null,
    generatedPoseTemporalHarness: debug.generatedPoseTemporalHarness || lastEvidence.generatedPoseTemporalHarness || null,
    effectiveControls: debug.effectiveControls || null,
    debug,
    timeline: lastEvidence.timeline,
  });
  ws.close();
  chromeProcess.kill('SIGTERM');
} catch (error) {
  writeReport({
    ok: false,
    error: error.stack || String(error),
    lastEvidence,
  });
  if (chromeProcess) chromeProcess.kill('SIGTERM');
  throw error;
}
