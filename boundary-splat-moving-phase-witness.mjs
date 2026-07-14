#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { renderBoundarySplatRowsPng, writeRgbaPng } from './boundary-splat-phase-render-witness.mjs';
import {
  buildBoundedTransportCorrespondence,
  interpolateTransportRows,
  validateMovingPhaseWitness,
} from './boundary-splat-phase-transport.mjs';

const SCHEMA = 'kaminos-boundary-splat-moving-phase-witness-v0';
const CAPTURE_AUTHORITY = 'intercepted-live-boundary-splat-buffer-post-compaction-v0';
const PREDICTION_AUTHORITY = 'learned-local-grid-transport-plus-residual-churn-v0';
const GLYPHS = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
};

function parseArgs(argv) {
  const result = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) result.set(key, '1');
    else {
      result.set(key, value);
      index += 1;
    }
  }
  return result;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function offsetLabel(index, controlledStepDeltaMs) {
  return `+${index} step${index === 1 ? '' : 's'} (${index * controlledStepDeltaMs} ms)`;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function loadFloatArtifact(artifact, stride, label, authority = null) {
  if (artifact?.strideFloats !== stride || artifact?.dtype !== 'float32-le') {
    throw new Error(`${label} must be float32-le stride-${stride}`);
  }
  if (!Number.isInteger(artifact.count) || artifact.count <= 0) throw new Error(`${label} count must be positive`);
  if (authority && artifact.authority !== authority) throw new Error(`${label} authority mismatch`);
  const path = resolve(String(artifact.path));
  const bytes = await readFile(path);
  if (bytes.byteLength !== artifact.bytes || sha256(bytes) !== artifact.sha256) throw new Error(`${label} byte/hash mismatch`);
  const values = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  if (values.length !== artifact.count * stride) throw new Error(`${label} count mismatch`);
  return { path, bytes, values: new Float32Array(values) };
}

function row(values, index, stride) {
  return Array.from(values.subarray(index * stride, (index + 1) * stride));
}

async function loadState(frame, label, splatAuthority) {
  const candidates = await loadFloatArtifact(frame.candidates, 16, `${label} candidates`);
  const splats = await loadFloatArtifact(frame.splats, 12, `${label} splats`, splatAuthority);
  if (frame.candidates.count !== frame.splats.count) throw new Error(`${label} candidate/splat count mismatch`);
  const sites = Array.from({ length: frame.splats.count }, (_, index) => ({
    position: row(splats.values, index, 12).slice(0, 3),
    candidate: row(candidates.values, index, 16),
    splat: row(splats.values, index, 12),
  }));
  return { frame, candidates, splats, sites };
}

function mixColor(rowValue, color, gain) {
  const result = Array.from(rowValue);
  for (let channel = 0; channel < 3; channel += 1) {
    result[4 + channel] = result[4 + channel] * (1 - gain) + color[channel] * gain;
  }
  return result;
}

function interpolateWithChurn(source, target, correspondence, fraction, debugGain = null) {
  const rows = interpolateTransportRows(source.sites, target.sites, correspondence.matches, fraction);
  if (debugGain !== null) {
    for (let index = 0; index < rows.length; index += 1) {
      const kind = correspondence.matches[index].kind;
      rows[index] = mixColor(rows[index], kind === 'stable' ? [0.15, 0.9, 0.25] : [0.1, 0.65, 1], debugGain);
    }
  }
  for (const targetIndex of correspondence.births) {
    const birth = Array.from(target.sites[targetIndex].splat);
    birth[7] *= fraction;
    rows.push(debugGain === null ? birth : mixColor(birth, [1, 0.1, 0.8], debugGain));
  }
  for (const sourceIndex of correspondence.deaths) {
    const death = Array.from(source.sites[sourceIndex].splat);
    death[7] *= 1 - fraction;
    rows.push(debugGain === null ? death : mixColor(death, [1, 0.2, 0.05], debugGain));
  }
  return rows;
}

function makeSequence(states, framesPerStep, gridStep, debugGain = null) {
  const frames = [];
  const segmentReports = [];
  for (let segment = 0; segment < states.length - 1; segment += 1) {
    const correspondence = buildBoundedTransportCorrespondence(states[segment].sites, states[segment + 1].sites, {
      gridStep,
      radiusCells: 1,
    });
    segmentReports.push({
      segment,
      authority: correspondence.authority,
      stableCount: correspondence.stableCount,
      transportedCount: correspondence.transportedCount,
      birthCount: correspondence.births.length,
      deathCount: correspondence.deaths.length,
      ambiguityCount: correspondence.ambiguityCount,
    });
    for (let sample = segment === 0 ? 0 : 1; sample <= framesPerStep; sample += 1) {
      const fraction = sample / framesPerStep;
      frames.push({
        segment,
        fraction,
        rows: interpolateWithChurn(states[segment], states[segment + 1], correspondence, fraction, debugGain),
      });
    }
  }
  return { frames, segmentReports };
}

function makeControlSequence(source, frameCount, debugGain = null) {
  const rows = source.sites.map(site => (
    debugGain === null ? Array.from(site.splat) : mixColor(site.splat, [0.15, 0.9, 0.25], debugGain)
  ));
  return { frames: Array.from({ length: frameCount }, () => ({ segment: 0, fraction: 0, rows })) };
}

function addBitmapLabel(rendered, label) {
  const rgba = Buffer.from(rendered.rgba);
  const barHeight = Math.min(12, rendered.height);
  for (let y = 0; y < barHeight; y += 1) {
    for (let x = 0; x < rendered.width; x += 1) {
      const pixel = (y * rendered.width + x) * 4;
      rgba[pixel] = 4;
      rgba[pixel + 1] = 6;
      rgba[pixel + 2] = 8;
      rgba[pixel + 3] = 255;
    }
  }
  let cursor = 3;
  for (const character of label) {
    const glyph = GLYPHS[character];
    if (!glyph) {
      cursor += 3;
      continue;
    }
    for (let y = 0; y < glyph.length; y += 1) {
      for (let x = 0; x < glyph[y].length; x += 1) {
        if (glyph[y][x] !== '1' || cursor + x >= rendered.width) continue;
        const pixel = ((y + 2) * rendered.width + cursor + x) * 4;
        rgba[pixel] = 245;
        rgba[pixel + 1] = 247;
        rgba[pixel + 2] = 250;
      }
    }
    cursor += 6;
  }
  return writeRgbaPng(rendered.width, rendered.height, rgba);
}

async function renderSequence(sequence, camera, outDir, renderOptions, label) {
  await mkdir(outDir, { recursive: true });
  const frameHashes = [];
  const frameEvidence = [];
  for (let index = 0; index < sequence.frames.length; index += 1) {
    const rendered = renderBoundarySplatRowsPng(sequence.frames[index].rows, camera, renderOptions);
    if (rendered.projectedSplatCount <= 0 || rendered.nonBackgroundPixelCount <= 0 || rendered.maxLuminance <= rendered.backgroundLuminance) {
      throw new Error(`rendered frame ${index} is blank or partial`);
    }
    const path = resolve(outDir, `frame-${String(index).padStart(3, '0')}.png`);
    const labeledPng = addBitmapLabel(rendered, label);
    await writeFile(path, labeledPng);
    frameHashes.push(sha256(labeledPng));
    frameEvidence.push({
      index,
      path,
      sha256: frameHashes.at(-1),
      segment: sequence.frames[index].segment,
      fraction: sequence.frames[index].fraction,
      inputSplatCount: rendered.inputSplatCount,
      projectedSplatCount: rendered.projectedSplatCount,
      nonBackgroundPixelCount: rendered.nonBackgroundPixelCount,
      maxLuminance: rendered.maxLuminance,
    });
  }
  return { frameHashes, frameEvidence };
}

function run(command, commandArgs, label) {
  const result = spawnSync(command, commandArgs, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${label} failed ${result.status}: ${String(result.stderr || result.stdout).slice(-3000)}`);
  return result;
}

function probeVideo(path, ffprobe) {
  const result = run(ffprobe, [
    '-v', 'error', '-count_frames',
    '-show_entries', 'stream=width,height,r_frame_rate,nb_read_frames:format=duration',
    '-of', 'json', path,
  ], 'ffprobe');
  const document = JSON.parse(result.stdout);
  const stream = document.streams?.[0];
  if (!stream || !Number(stream.width) || !Number(stream.height)) throw new Error('encoded witness has no video stream');
  const [numerator, denominator] = String(stream.r_frame_rate).split('/').map(Number);
  return {
    width: Number(stream.width),
    height: Number(stream.height),
    fps: numerator / denominator,
    frameCount: Number(stream.nb_read_frames),
    duration: Number(document.format?.duration),
  };
}

async function encodeComparison(roleDirs, outputPath, fps, frameCount, labels, ffmpeg, ffprobe) {
  await mkdir(dirname(outputPath), { recursive: true });
  const args = ['-y'];
  for (const directory of roleDirs) args.push('-framerate', String(fps), '-i', resolve(directory, 'frame-%03d.png'));
  const stack = `${labels.map((_, index) => `[${index}:v]`).join('')}hstack=inputs=${labels.length}[out]`;
  args.push(
    '-filter_complex', stack,
    '-map', '[out]', '-frames:v', String(frameCount),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    outputPath,
  );
  run(ffmpeg, args, 'ffmpeg comparison encode');
  const bytes = await readFile(outputPath);
  const probe = probeVideo(outputPath, ffprobe);
  if (probe.frameCount !== frameCount || Math.abs(probe.fps - fps) > 1e-6) throw new Error('encoded comparison cadence/frame count mismatch');
  return { path: outputPath, bytes: bytes.byteLength, sha256: sha256(bytes), probe, command: [ffmpeg, ...args] };
}

function inspectionGuide(report) {
  const labels = report.discreteOffsets.map(row => `<li><strong>${row.label}</strong>: reference <code>${row.referenceFrameId}</code>; recurrent prediction step ${row.step}.</li>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Phase Transport Motion Witness</title>
<style>body{margin:0;background:#111;color:#eee;font:15px/1.45 system-ui,sans-serif}main{max-width:1120px;margin:auto;padding:24px}h1,h2{letter-spacing:0}video{display:block;width:100%;background:#000;border:1px solid #444}section{margin:28px 0}code{color:#9ee7ff}.legend{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.legend span{padding:8px;border-left:5px solid #777}.stable{border-color:#26e63f!important}.transport{border-color:#19a6ff!important}.birth{border-color:#ff1acc!important}.death{border-color:#ff4210!important}</style></head>
<body><main><h1>Held-Out Local-Grid Phase Transport</h1>
<p>This finite forward episode starts at the exact current state and ends at the farthest held-out target. Playback does not loop; replay is an explicit viewer action.</p>
<section><h2>Beauty Motion</h2><p><strong>Reference: exact held-out simulator states.</strong> <strong>Control: copied current state at zero velocity.</strong> <strong>Prediction: recurrent learned local-grid transport plus calibrated residual births/deaths.</strong> All three use the same camera, interpolation count, and ${report.playback.effectiveFps} fps cadence.</p><video controls muted playsinline src="beauty-comparison.mp4"></video></section>
<section><h2>Partial Flow Debug, Gain 0.625</h2><p>This is a display-only mix over the same role frames and cadence. It exposes carrier motion and support churn without changing simulation, prediction, or raster state.</p><div class="legend"><span class="stable">green: stable</span><span class="transport">blue: transported</span><span class="birth">magenta: birth</span><span class="death">orange: death</span></div><video controls muted playsinline src="partial-flow-debug-comparison.mp4"></video></section>
<section><h2>Temporal Anchors</h2><ol>${labels}</ol></section>
<section><h2>Claim Boundary</h2><p>${report.claimBoundary}</p></section></main></body></html>`;
}

export async function writeMovingPhaseWitness(manifestPathValue, predictionsPathValue, options = {}) {
  const manifestPath = resolve(manifestPathValue);
  const predictionsPath = resolve(predictionsPathValue);
  const outDir = resolve(options.outDir ?? '/tmp/kaminos-moving-phase-witness');
  const reportPath = resolve(options.report ?? outDir, options.report ? '' : 'moving-phase-witness.json');
  const width = Math.max(32, Math.floor(Number(options.width ?? 320)));
  const height = Math.max(32, Math.floor(Number(options.height ?? 240)));
  const framesPerStep = Math.max(1, Math.floor(Number(options.framesPerStep ?? 4)));
  const requestedFps = Math.max(1, Number(options.fps ?? 12));
  const gridStep = Number(options.gridStep ?? (2 / 160));
  const requestedGain = Number(options.partialFlowDebugGain ?? 0.625);
  const ffmpeg = String(options.ffmpeg ?? 'ffmpeg');
  const ffprobe = String(options.ffprobe ?? 'ffprobe');
  let failurePhase = 'argument-validation';
  let lastTrustworthyEvidence = { manifestPath, predictionsPath, outDir };
  await mkdir(outDir, { recursive: true });
  try {
    if (!Number.isFinite(gridStep) || gridStep <= 0) throw new Error('grid step must be positive');
    if (requestedGain !== 0.625) throw new Error('partial flow debug gain must be exactly 0.625 for this witness');
    failurePhase = 'manifest-validation';
    const [manifestBytes, predictionsBytes] = await Promise.all([readFile(manifestPath), readFile(predictionsPath)]);
    const manifest = JSON.parse(manifestBytes.toString('utf8'));
    const predictions = JSON.parse(predictionsBytes.toString('utf8'));
    if (manifest.schema !== 'kaminos-boundary-splat-phase-candidate-corpus-v0') throw new Error('phase corpus schema mismatch');
    if (manifest.effectiveRoute !== 'native-3d-compute-fluid-raymarch-v0') throw new Error('phase corpus effective route mismatch');
    if (predictions.schema !== 'kaminos-boundary-splat-phase-transport-predictions-v0' || predictions.status !== 'completed') throw new Error('transport predictions schema/status mismatch');
    if (predictions.route?.backend !== 'mlx' || !/^Device\(gpu,\s*\d+\)$/i.test(String(predictions.route?.device)) || predictions.route?.fallbackReason !== null) {
      throw new Error('transport predictions require effective MLX GPU identity and null fallback');
    }
    const referenceIds = predictions.temporal?.heldoutReferenceFrameIds;
    if (!Array.isArray(referenceIds) || referenceIds.length < 3 || predictions.frames?.length !== referenceIds.length) throw new Error('heldout forward episode is incomplete');
    const corpusFrames = new Map(manifest.frames.map(frame => [frame.id, frame]));
    const referenceDocs = referenceIds.map(id => corpusFrames.get(id));
    if (referenceDocs.some(frame => !frame)) throw new Error('heldout reference frame is absent from corpus');
    if (predictions.frames.some((frame, index) => frame.referenceFrameId !== referenceIds[index])) throw new Error('prediction/reference order mismatch');
    lastTrustworthyEvidence = {
      ...lastTrustworthyEvidence,
      manifestSha256: sha256(manifestBytes),
      predictionsSha256: sha256(predictionsBytes),
      effectiveRoute: manifest.effectiveRoute,
      effectiveBackend: predictions.route,
      referenceIds,
    };
    failurePhase = 'artifact-validation';
    const referenceStates = await Promise.all(referenceDocs.map((frame, index) => loadState(frame, `reference ${index}`, CAPTURE_AUTHORITY)));
    const predictedStates = await Promise.all(predictions.frames.map((frame, index) => loadState(frame, `prediction ${index}`, PREDICTION_AUTHORITY)));
    const frameCount = (referenceStates.length - 1) * framesPerStep + 1;
    failurePhase = 'sequence-construction';
    const beautyReference = makeSequence(referenceStates, framesPerStep, gridStep);
    const beautyPrediction = makeSequence(predictedStates, framesPerStep, gridStep);
    const beautyControl = makeControlSequence(referenceStates[0], frameCount);
    const debugReference = makeSequence(referenceStates, framesPerStep, gridStep, requestedGain);
    const debugPrediction = makeSequence(predictedStates, framesPerStep, gridStep, requestedGain);
    const debugControl = makeControlSequence(referenceStates[0], frameCount, requestedGain);
    failurePhase = 'isolated-raster';
    const renderOptions = { width, height, radiusMultiplier: 1, kernelSharpness: 6.5 };
    const roleNames = ['reference', 'control', 'predicted'];
    const beautySequences = [beautyReference, beautyControl, beautyPrediction];
    const debugSequences = [debugReference, debugControl, debugPrediction];
    const beautyEvidence = [];
    const debugEvidence = [];
    for (let index = 0; index < roleNames.length; index += 1) {
      beautyEvidence.push(await renderSequence(beautySequences[index], referenceDocs[0].camera, resolve(outDir, 'beauty', roleNames[index]), renderOptions, roleNames[index].toUpperCase()));
      debugEvidence.push(await renderSequence(debugSequences[index], referenceDocs[0].camera, resolve(outDir, 'partial-debug', roleNames[index]), renderOptions, roleNames[index].toUpperCase()));
    }
    failurePhase = 'video-encode';
    const labels = ['REFERENCE exact', 'CONTROL copied current', 'PREDICTION learned transport'];
    const beautyComparison = await encodeComparison(
      roleNames.map(role => resolve(outDir, 'beauty', role)), resolve(outDir, 'beauty-comparison.mp4'),
      requestedFps, frameCount, labels, ffmpeg, ffprobe,
    );
    const partialDebugComparison = await encodeComparison(
      roleNames.map(role => resolve(outDir, 'partial-debug', role)), resolve(outDir, 'partial-flow-debug-comparison.mp4'),
      requestedFps, frameCount, labels, ffmpeg, ffprobe,
    );
    failurePhase = 'report-write';
    const controlledStepDeltaMs = Number(predictions.temporal.controlledStepDeltaMs);
    const report = {
      schema: SCHEMA,
      status: 'completed',
      source: {
        manifest: { path: manifestPath, sha256: sha256(manifestBytes) },
        predictions: { path: predictionsPath, sha256: sha256(predictionsBytes) },
        requestedRoute: manifest.requestedRoute,
        effectiveRoute: manifest.effectiveRoute,
        backend: predictions.route,
      },
      playback: {
        authority: 'finite-forward-heldout-phase-sequence-v0',
        requestedFps,
        effectiveFps: beautyComparison.probe.fps,
        frameCount,
        framesPerControlledStep: framesPerStep,
        controlledStepDeltaMs,
        loops: false,
        resetDisclosure: 'playback ends on the farthest held-out target and restarts only by explicit viewer action',
      },
      roles: {
        reference: { authority: 'exact-heldout-target-state-v0', frameHashes: beautyEvidence[0].frameHashes, frameEvidence: beautyEvidence[0].frameEvidence },
        control: { authority: 'copied-current-zero-velocity-v0', frameHashes: beautyEvidence[1].frameHashes, frameEvidence: beautyEvidence[1].frameEvidence },
        predicted: { authority: 'learned-local-grid-transport-plus-residual-churn-v0', frameHashes: beautyEvidence[2].frameHashes, frameEvidence: beautyEvidence[2].frameEvidence },
      },
      partialFlowDebug: {
        authority: 'display-only-support-flow-debug-mix-v0',
        requestedGain,
        effectiveGain: requestedGain,
        roles: roleNames,
        frameCount,
        effectiveFps: partialDebugComparison.probe.fps,
        frameHashes: Object.fromEntries(roleNames.map((role, index) => [role, debugEvidence[index].frameHashes])),
        stateMutation: false,
      },
      discreteOffsets: referenceIds.map((referenceFrameId, step) => ({ step, label: offsetLabel(step, controlledStepDeltaMs), referenceFrameId })),
      correspondence: {
        authority: 'stable-site-first-bounded-local-grid-feature-correspondence-v0',
        referenceSegments: beautyReference.segmentReports,
        predictedSegments: beautyPrediction.segmentReports,
      },
      render: { authority: 'isolated-cpu-projected-boundary-splat-raster-v0', width, height, gridStep },
      artifacts: { beautyComparison, partialDebugComparison },
      claimBoundary: 'Motion plausibility and held-out support behavior under an isolated recurrent local-grid predictor; this does not establish hero-fire fidelity, analytical raymarch agreement, live runtime integration, or long-horizon stability.',
    };
    validateMovingPhaseWitness(report);
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    await writeFile(resolve(outDir, 'inspection-guide.html'), inspectionGuide(report));
    return report;
  } catch (error) {
    const failure = {
      schema: SCHEMA,
      status: 'failed',
      failurePhase,
      error: error?.stack || error?.message || String(error),
      lastTrustworthyEvidence,
    };
    await writeFile(reportPath, JSON.stringify(failure, null, 2));
    throw error;
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.get('--manifest') || !args.get('--predictions')) {
    console.error('Usage: node boundary-splat-moving-phase-witness.mjs --manifest <phase-corpus.json> --predictions <transport-predictions.json> --out-dir <dir>');
    process.exitCode = 2;
  } else {
    try {
      const report = await writeMovingPhaseWitness(args.get('--manifest'), args.get('--predictions'), {
        outDir: args.get('--out-dir'), report: args.get('--report'), width: args.get('--width'), height: args.get('--height'),
        framesPerStep: args.get('--frames-per-step'), fps: args.get('--fps'), gridStep: args.get('--grid-step'),
        partialFlowDebugGain: args.get('--partial-flow-debug-gain'), ffmpeg: args.get('--ffmpeg'), ffprobe: args.get('--ffprobe'),
      });
      console.log(JSON.stringify(report, null, 2));
    } catch (error) {
      console.error(error?.stack || error?.message || String(error));
      process.exitCode = 1;
    }
  }
}
