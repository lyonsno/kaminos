#!/usr/bin/env node

import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  applyEnvelopeEdits,
  createSyntheticHipCrossSection,
  relaxEnvelopeFromTargets,
  sampleEnvelopeRadius,
  solveConstructionalPacking,
} from './constructional-packing-core.mjs';

const WITNESS_ROUTE = 'constructional-packing-cross-section-v0';
const DEFAULT_IO = Object.freeze({ mkdir, rename, writeFile });
const COLORS = Object.freeze({
  'dorsal-extensor': '#56b896',
  'posterior-power': '#e2ad4f',
  'ventral-flexor': '#df705f',
  'connective-envelope': '#5a82c9',
});

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function worldToPanel(source, point, width, height, padding) {
  const bounds = source.grid.bounds;
  return [
    padding +
      ((point[0] - bounds.minX) / (bounds.maxX - bounds.minX)) *
        (width - padding * 2),
    height -
      padding -
      ((point[1] - bounds.minY) / (bounds.maxY - bounds.minY)) *
        (height - padding * 2),
  ];
}

function envelopePath(source, width, height, padding) {
  const points = [];
  for (let index = 0; index <= 128; index += 1) {
    const angle = (index / 128) * Math.PI * 2;
    const radius = sampleEnvelopeRadius(source, angle);
    const world = [
      source.envelope.center[0] + Math.cos(angle) * radius,
      source.envelope.center[1] + Math.sin(angle) * radius,
    ];
    points.push(worldToPanel(source, world, width, height, padding));
  }
  return points
    .map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(' ');
}

function caseMetrics(result) {
  return {
    activeCellCount: result.metrics.activeCellCount,
    excludedObstacleCellCount: result.metrics.excludedObstacleCellCount,
    unownedCellCount: result.metrics.unownedCellCount,
    multiOwnedCellCount: result.metrics.multiOwnedCellCount,
    obstacleOwnedCellCount: result.metrics.obstacleOwnedCellCount,
    anchorViolationCount: result.metrics.anchorViolations.length,
    maxTargetShareError: result.metrics.maxTargetShareError,
  };
}

function assertAcceptedCases(cases) {
  for (const item of cases) {
    const metrics = caseMetrics(item.packing);
    if (
      metrics.unownedCellCount !== 0 ||
      metrics.multiOwnedCellCount !== 0 ||
      metrics.obstacleOwnedCellCount !== 0 ||
      metrics.excludedObstacleCellCount <= 0 ||
      metrics.anchorViolationCount !== 0 ||
      metrics.maxTargetShareError >= 0.055
    ) {
      throw new Error(
        `constructional witness case ${item.id} failed numerical acceptance: ${JSON.stringify(metrics)}`,
      );
    }
  }
}

async function writeJsonAtomically(io, path, value) {
  const temporaryPath = `${path}.tmp`;
  await io.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  await io.rename(temporaryPath, path);
}

function renderPanel({ id, title, subtitle, source, packing, referenceSource = null }) {
  const width = 420;
  const height = 330;
  const padding = 20;
  const bounds = source.grid.bounds;
  const cellWidth =
    ((bounds.maxX - bounds.minX) / source.grid.width / (bounds.maxX - bounds.minX)) *
    (width - padding * 2);
  const cellHeight =
    ((bounds.maxY - bounds.minY) / source.grid.height / (bounds.maxY - bounds.minY)) *
    (height - padding * 2);
  const cells = packing.cells
    .map(cell => {
      const [x, y] = worldToPanel(source, [cell.x, cell.y], width, height, padding);
      return `<rect x="${(x - cellWidth / 2).toFixed(2)}" y="${(y - cellHeight / 2).toFixed(2)}" width="${(cellWidth + 0.35).toFixed(2)}" height="${(cellHeight + 0.35).toFixed(2)}" fill="${COLORS[cell.ownerId]}"/>`;
    })
    .join('');
  const obstacle = source.obstacles[0];
  const obstacleCenter = worldToPanel(source, obstacle.center, width, height, padding);
  const obstacleRadius =
    (obstacle.radius / (bounds.maxX - bounds.minX)) * (width - padding * 2);
  const anchors = source.compartments
    .flatMap(compartment =>
      compartment.anchors.map(anchor => {
        const [x, y] = worldToPanel(source, anchor, width, height, padding);
        return `<g><circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="5.5" fill="#111612" stroke="#f4f1e8" stroke-width="2"/><circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="2" fill="${COLORS[compartment.id]}"/></g>`;
      }),
    )
    .join('');
  const referenceEnvelope = referenceSource
    ? `<path d="${envelopePath(referenceSource, width, height, padding)} Z" fill="none" stroke="#f4f1e8" stroke-opacity="0.62" stroke-width="1.5" stroke-dasharray="6 5"/>`
    : '';
  return `
    <section class="panel" data-case="${escapeHtml(id)}">
      <header>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(subtitle)}</p>
      </header>
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)} semantic packing">
        <path d="${envelopePath(source, width, height, padding)} Z" fill="#202721" stroke="#d8ddce" stroke-width="2"/>
        ${cells}
        ${referenceEnvelope}
        <circle cx="${obstacleCenter[0].toFixed(2)}" cy="${obstacleCenter[1].toFixed(2)}" r="${obstacleRadius.toFixed(2)}" fill="#111612" stroke="#f0dba4" stroke-width="2.5"/>
        ${anchors}
        <text x="${(obstacleCenter[0] + obstacleRadius + 7).toFixed(2)}" y="${(obstacleCenter[1] + 4).toFixed(2)}" class="obstacle-label">hip-joint-clearance</text>
      </svg>
      <dl>
        <div><dt>Owned cells</dt><dd>${packing.metrics.activeCellCount}</dd></div>
        <div><dt>Unowned</dt><dd>${packing.metrics.unownedCellCount}</dd></div>
        <div><dt>Anchor drift</dt><dd>${packing.metrics.anchorViolations.length}</dd></div>
        <div><dt>Max share error</dt><dd>${packing.metrics.maxTargetShareError.toFixed(4)}</dd></div>
      </dl>
    </section>`;
}

function renderHtml({ source, cases, report }) {
  const panels = cases.map(renderPanel).join('');
  const legend = source.compartments
    .map(
      compartment =>
        `<li><span style="background:${COLORS[compartment.id]}"></span>${escapeHtml(compartment.label)}</li>`,
    )
    .join('');
  return `<!doctype html>
<html lang="en" data-witness-route="${WITNESS_ROUTE}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Reciprocal constructional packing witness</title>
  <style>
    :root { color-scheme: dark; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background:#111612; color:#f4f1e8; }
    * { box-sizing:border-box; }
    body { margin:0; min-width:320px; background:#111612; }
    main { width:100%; max-width:1400px; margin:0 auto; padding:24px; overflow:hidden; }
    .masthead { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:24px; align-items:end; border-bottom:1px solid #546257; padding-bottom:18px; }
    h1 { margin:0; font:700 26px/1.1 ui-sans-serif,system-ui,sans-serif; letter-spacing:0; overflow-wrap:anywhere; }
    .status { margin:8px 0 0; color:#f0dba4; font-size:13px; }
    .route { min-width:0; text-align:right; color:#a9b5aa; font-size:12px; overflow-wrap:anywhere; }
    .legend { display:flex; flex-wrap:wrap; gap:18px; list-style:none; margin:18px 0; padding:0; color:#ccd3ca; font-size:12px; }
    .legend li { min-width:0; overflow-wrap:anywhere; }
    .legend span { display:inline-block; width:12px; height:12px; margin-right:7px; vertical-align:-2px; border:1px solid #ffffff55; }
    .grid { display:grid; width:100%; min-width:0; grid-template-columns:repeat(3,minmax(0,1fr)); border-top:1px solid #39433b; border-bottom:1px solid #39433b; }
    .panel { min-width:0; padding:18px; border-right:1px solid #39433b; overflow:hidden; }
    .panel:last-child { border-right:0; }
    .panel header { min-height:62px; }
    h2 { margin:0; font:650 16px/1.2 ui-sans-serif,system-ui,sans-serif; letter-spacing:0; }
    .panel p { margin:6px 0 0; color:#a9b5aa; font-size:11px; line-height:1.45; overflow-wrap:anywhere; }
    svg { display:block; width:100%; max-width:100%; min-width:0; aspect-ratio:420/330; background:#171d18; border:1px solid #39433b; }
    .obstacle-label { fill:#f0dba4; font-size:9px; }
    dl { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:6px 14px; margin:13px 0 0; }
    dl div { display:flex; justify-content:space-between; gap:8px; border-bottom:1px solid #2c352e; padding:4px 0; }
    dt { color:#a9b5aa; font-size:10px; }
    dd { margin:0; font-size:10px; color:#f4f1e8; }
    footer { display:flex; justify-content:space-between; gap:18px; padding-top:15px; color:#7f8c81; font-size:10px; }
    @media (max-width:900px) {
      .masthead { grid-template-columns:1fr; }
      .route { text-align:left; }
      .grid { grid-template-columns:1fr; }
      .panel { border-right:0; border-bottom:1px solid #39433b; }
      .panel:last-child { border-bottom:0; }
    }
    @media (max-width:600px) {
      main { padding:16px; }
      h1 { font-size:22px; }
      .legend { display:grid; grid-template-columns:1fr; gap:8px; }
      .grid { width:calc(100vw - 32px); max-width:calc(100vw - 32px); grid-template-columns:minmax(0,1fr); }
      .panel { width:calc(100vw - 32px); max-width:calc(100vw - 32px); padding:14px 0; }
      dl { grid-template-columns:minmax(0,1fr); }
      footer { flex-direction:column; gap:6px; }
    }
  </style>
</head>
<body>
  <main>
    <header class="masthead">
      <div>
        <h1>Reciprocal constructional packing</h1>
        <p class="status">Synthetic proxy · no anatomical admission</p>
      </div>
      <div class="route">requested ${escapeHtml(report.route.requested)}<br>effective ${escapeHtml(report.route.effective)}</div>
    </header>
    <ul class="legend">${legend}</ul>
    <div class="grid">${panels}</div>
    <footer>
      <span>White rings: hard semantic anchors</span>
      <span>Dark disk: fitted joint-clearance obstacle</span>
    </footer>
  </main>
  <script>
    document.documentElement.dataset.viewportWidth = String(window.innerWidth);
    document.documentElement.dataset.documentWidth = String(document.documentElement.scrollWidth);
  </script>
</body>
</html>`;
}

export async function writeConstructionalPackingWitness({
  outDir,
  source = createSyntheticHipCrossSection(),
  io: ioOverrides = {},
}) {
  const outputRoot = resolve(outDir);
  const io = { ...DEFAULT_IO, ...ioOverrides };
  let phase = 'prepare-output';
  const failureBase = {
    schema: 'kaminos.constructional-packing-witness-report.v0',
    status: 'failed',
    route: {
      requested: WITNESS_ROUTE,
      effective: null,
    },
    source: {
      id: source?.id || null,
      schema: source?.schema || null,
      authority: source?.authority?.kind || null,
      anatomicalAdmission: source?.authority?.anatomicalAdmission || null,
    },
  };
  try {
    await io.mkdir(outputRoot, { recursive: true });
    phase = 'solve-baseline';
    const baseline = solveConstructionalPacking(source);
    phase = 'solve-interior-pressure';
    const pressureResponse = relaxEnvelopeFromTargets({
      source,
      packing: baseline,
      targetEdits: [
        {
          id: 'grow-dorsal-extensor',
          compartmentId: 'dorsal-extensor',
          deltaShare: 0.09,
          authority: 'operator-authored',
        },
        {
          id: 'yield-connective-envelope',
          compartmentId: 'connective-envelope',
          deltaShare: -0.09,
          authority: 'operator-authored',
        },
      ],
    });
    const pressurePacking = solveConstructionalPacking(pressureResponse.source);
    phase = 'solve-exterior-compression';
    const exteriorResponse = applyEnvelopeEdits({
      source,
      edits: [
        {
          id: 'compress-posterior-flank',
          kind: 'radial-offset',
          angle: 0.18,
          amplitude: -0.14,
          angularWidth: 0.34,
          authority: 'operator-authored',
        },
      ],
    });
    const exteriorPacking = solveConstructionalPacking(exteriorResponse.source);
    const cases = [
      {
        id: 'baseline',
        title: 'Baseline packing',
        subtitle: 'Fixed envelope, stable semantic compartments, hard anchors.',
        source,
        packing: baseline,
      },
      {
        id: 'interior-pressure',
        title: 'Interior pressure',
        subtitle: 'Dorsal target grows; the analytical envelope responds locally.',
        source: pressureResponse.source,
        referenceSource: source,
        packing: pressurePacking,
      },
      {
        id: 'exterior-compression',
        title: 'Exterior compression',
        subtitle: 'Operator compresses the flank; the semantic interior repacks.',
        source: exteriorResponse.source,
        referenceSource: source,
        packing: exteriorPacking,
      },
    ];
    phase = 'validate-numerical-acceptance';
    assertAcceptedCases(cases);
    const report = {
      schema: 'kaminos.constructional-packing-witness-report.v0',
      status: 'complete',
      route: {
        requested: WITNESS_ROUTE,
        effective: WITNESS_ROUTE,
      },
      source: {
        id: source.id,
        schema: source.schema,
        authority: source.authority.kind,
        anatomicalAdmission: source.authority.anatomicalAdmission,
      },
      cases: cases.map(item => ({
        id: item.id,
        sourceId: item.source.id,
        metrics: caseMetrics(item.packing),
      })),
      ledgers: {
        interiorPressure: pressureResponse.ledger,
        exteriorCompression: exteriorResponse.ledger,
      },
      visualInspection: {
        status: 'pending-agent-inspection',
        artifact: 'index.html',
      },
      claims: {
        reciprocalPackingMechanism: 'supported-by-numerical-contract',
        anatomicalCorrectness: 'unassayed',
        threeDimensionalPacking: 'unassayed',
        generatorSurvival: 'unassayed',
      },
    };
    phase = 'write-supporting-artifacts';
    const supportingWrites = await Promise.allSettled([
      io.writeFile(
        resolve(outputRoot, 'baseline.json'),
        `${JSON.stringify(baseline, null, 2)}\n`,
      ),
      io.writeFile(
        resolve(outputRoot, 'interior-pressure.json'),
        `${JSON.stringify(pressurePacking, null, 2)}\n`,
      ),
      io.writeFile(
        resolve(outputRoot, 'exterior-compression.json'),
        `${JSON.stringify(exteriorPacking, null, 2)}\n`,
      ),
      io.writeFile(
        resolve(outputRoot, 'index.html'),
        renderHtml({ source, cases, report }),
      ),
    ]);
    const failedWrite = supportingWrites.find(result => result.status === 'rejected');
    if (failedWrite) throw failedWrite.reason;
    phase = 'publish-report';
    await writeJsonAtomically(io, resolve(outputRoot, 'report.json'), report);
    return {
      outDir: outputRoot,
      report,
    };
  } catch (error) {
    const failureReport = {
      ...failureBase,
      failurePhase: phase,
      lastTrustworthyEvidence: {
        phase: 'source-received',
        sourceId: source?.id || null,
        sourceSchema: source?.schema || null,
      },
      error: {
        name: error.name,
        message: error.message,
      },
    };
    let failureReportPath = resolve(outputRoot, 'report.json');
    try {
      if (phase === 'prepare-output') {
        failureReportPath = `${outputRoot}.failure-report.json`;
        await io.mkdir(dirname(failureReportPath), { recursive: true });
      } else {
        await io.mkdir(outputRoot, { recursive: true });
      }
      await writeJsonAtomically(io, failureReportPath, failureReport);
      error.failureReportPath = failureReportPath;
    } catch (reportError) {
      error.failureReportPath = null;
      error.failureReportError = reportError;
    }
    throw error;
  }
}

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args.set(token, '1');
    } else {
      args.set(token, next);
      index += 1;
    }
  }
  return args;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const args = parseArgs(process.argv.slice(2));
  const outDir =
    args.get('--out-dir') ||
    'artifacts/constructional-packing-cross-section-v0';
  const result = await writeConstructionalPackingWitness({ outDir });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export {
  admitExactElbowPackingVisualInspection,
  writeExactElbowPackingWitness,
} from './analytical-elbow-packing-witness.mjs';

export {
  admitExactElbowEnvelopeCouplingVisualInspection,
  writeExactElbowEnvelopeCouplingWitness,
} from './analytical-elbow-envelope-coupling-witness.mjs';
