import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createTargetOrbShellCompositionFixture,
} from './orb-shell-composition-core.js';

const DEFAULT_XRAY_ID = 'cranial-depth-enema-yielding-route-xray';

function parseCliArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args.set(arg, '1');
      continue;
    }
    args.set(arg, next);
    index += 1;
  }
  return args;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatInteger(value) {
  return Number.isFinite(value) ? new Intl.NumberFormat('en-US').format(value) : String(value ?? 'unknown');
}

function labelForKey(key) {
  const labels = {
    package: 'Package',
    packageVersion: 'Package Version',
    mainCommit: 'Main Commit',
    sharpRouteId: 'SHARP Route',
    phaseProgramSchema: 'Phase Program Schema',
    phaseProgramRunSchema: 'Phase Program Run Schema',
    schedulerVerificationReceiptSchema: 'Scheduler Receipt Schema',
    primitive: 'Primitive',
    phaseProgramFields: 'Phase Program Fields',
    schedulerFields: 'Scheduler Fields',
    observedBoundaries: 'Observed Boundaries',
    routeStageBoundary: 'Route Stage Boundary',
    source: 'Source',
    routeEvidence: 'Route Evidence',
    valid: 'Valid',
    gaussianCount: 'Gaussian Count',
    schedulerVerificationState: 'Scheduler Verification',
    scheduler: 'Scheduler',
    contentionPastGaussianPostSpn: 'Contended Post-SPN',
    accelerationClaim: 'Acceleration Claim',
    lamellarGeometryImpact: 'Lamellar Geometry Impact',
    failureEvidence: 'Failure Evidence',
    currentUse: 'Current Use',
    geometryImpact: 'Geometry Impact',
    disposition: 'Disposition',
  };
  return labels[key] || String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, letter => letter.toUpperCase());
}

function compactObjectRows(object) {
  return Object.entries(object || {})
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => ({
      key: labelForKey(key),
      value: typeof value === 'object' ? JSON.stringify(value) : String(value),
    }));
}

function findCranialXray(inventory, xrayId = DEFAULT_XRAY_ID) {
  const xray = inventory?.externalRouteXrays?.find(record => record.id === xrayId);
  if (!xray) {
    throw new Error(`Cranial yielding route x-ray missing from procedural architecture inventory: ${xrayId}`);
  }
  if (!xray.routeIdentity?.sharpRouteId || !xray.routeIdentity?.phaseProgramSchema) {
    throw new Error(`Cranial yielding route x-ray is missing route identity: ${xrayId}`);
  }
  if (!xray.positiveSmokeEvidence || !xray.evidenceBoundary) {
    throw new Error(`Cranial yielding route x-ray is missing evidence or boundary sections: ${xrayId}`);
  }
  return xray;
}

export function buildCranialYieldingRouteHumanWitness(inventory, options = {}) {
  const xray = findCranialXray(inventory, options.xrayId);
  const routeIdentity = {
    package: xray.routeIdentity.package,
    packageVersion: xray.routeIdentity.packageVersion,
    mainCommit: xray.routeIdentity.mainCommit,
    sharpRouteId: xray.routeIdentity.sharpRouteId,
    phaseProgramSchema: xray.routeIdentity.phaseProgramSchema,
    phaseProgramRunSchema: xray.routeIdentity.phaseProgramRunSchema,
    schedulerVerificationReceiptSchema: xray.routeIdentity.schedulerVerificationReceiptSchema,
  };
  const positiveEvidence = {
    source: xray.positiveSmokeEvidence.source,
    routeEvidence: xray.positiveSmokeEvidence.routeEvidence,
    valid: xray.positiveSmokeEvidence.valid,
    gaussianCount: xray.positiveSmokeEvidence.gaussianCount,
    schedulerVerificationState: xray.positiveSmokeEvidence.schedulerVerificationState,
    scheduler: xray.positiveSmokeEvidence.scheduler,
  };
  const boundaries = {
    contentionPastGaussianPostSpn: xray.evidenceBoundary.contentionPastGaussianPostSpn,
    accelerationClaim: xray.evidenceBoundary.accelerationClaim,
    lamellarGeometryImpact: xray.evidenceBoundary.lamellarGeometryImpact,
    failureEvidence: xray.evidenceBoundary.failureEvidence,
  };

  return {
    schema: 'CranialYieldingRouteHumanWitness',
    mode: 'operator-legible-cranial-yielding-route-xray-v0',
    title: 'Cranial Yielding Route X-Ray',
    sourceXrayId: xray.id,
    sourceDiaulos: xray.sourceDiaulos,
    generatedAt: new Date().toISOString(),
    summary: {
      verdict: 'usable-yielding-substrate-not-geometry-progress',
      operatorRead: 'Cranial landed a real cooperative WebGPU phase-program yielding route; Lamellar has not consumed it for shell geometry yet.',
    },
    routeIdentity,
    yieldingContract: {
      primitive: xray.yieldingContract?.primitive,
      phaseProgramFields: xray.yieldingContract?.phaseProgramFields || [],
      schedulerFields: xray.yieldingContract?.schedulerFields || [],
      observedBoundaries: xray.yieldingContract?.observedBoundaries || [],
      routeStageBoundary: xray.yieldingContract?.routeStageBoundary,
    },
    positiveEvidence,
    boundaries,
    lamellarImpact: {
      currentUse: xray.evidenceBoundary.currentUse,
      geometryImpact: xray.evidenceBoundary.lamellarGeometryImpact,
      disposition: xray.xrayDisposition,
    },
    proves: [
      `The phase-program route identity is visible locally as ${routeIdentity.phaseProgramSchema}.`,
      `The SHARP route identity is visible as ${routeIdentity.sharpRouteId}.`,
      `The yielding contract exposes ${xray.yieldingContract?.primitive || 'a cooperative yield primitive'} and observed ${xray.yieldingContract?.observedBoundaries?.join(', ') || 'phase boundaries'}.`,
      `The positive smoke produced ${formatInteger(positiveEvidence.gaussianCount)} Gaussians with scheduler verification ${positiveEvidence.schedulerVerificationState}.`,
    ],
    doesNotProve: [
      'It does not prove Lamellar shell geometry is better, correct, or coupled to this route.',
      'It does not prove acceleration; no speedup claim is made here.',
      'The contended post-SPN path remains unproven.',
      'It does not decide the lower-socket tongue or aperture-termination architecture problem.',
    ],
    sourceReceipts: [...(xray.sourceReceipts || [])],
  };
}

function renderDefinitionList(rows) {
  return rows.map(row => `
        <div class="kv-row">
          <dt>${escapeHtml(row.key)}</dt>
          <dd>${escapeHtml(row.value)}</dd>
        </div>`).join('');
}

function renderList(items) {
  return (items || []).map(item => `<li>${escapeHtml(item)}</li>`).join('');
}

export function renderCranialYieldingRouteHumanWitnessHtml(witness) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(witness.title)}</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #090b0c;
        --panel: #14191b;
        --panel-2: #1d2427;
        --text: #e7ecef;
        --muted: #a8b4bb;
        --line: #38454b;
        --good: #8fe3bd;
        --warn: #f1c27d;
        --cyan: #7dd8f4;
      }
      body {
        margin: 0;
        min-height: 100vh;
        background: radial-gradient(circle at top left, #182023, var(--bg) 44rem);
        color: var(--text);
        font: 15px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main {
        width: min(1040px, calc(100vw - 40px));
        margin: 0 auto;
        padding: 32px 0 48px;
      }
      header {
        border-bottom: 1px solid var(--line);
        padding-bottom: 18px;
        margin-bottom: 20px;
      }
      h1, h2 {
        margin: 0;
        letter-spacing: 0;
      }
      h1 {
        font-size: 32px;
        line-height: 1.1;
      }
      h2 {
        font-size: 18px;
        margin-bottom: 12px;
      }
      .subtitle {
        color: var(--muted);
        margin: 10px 0 0;
        max-width: 780px;
      }
      .verdict {
        display: inline-block;
        margin-top: 14px;
        padding: 6px 10px;
        border: 1px solid var(--warn);
        color: var(--warn);
        background: rgb(241 194 125 / 0.08);
        border-radius: 6px;
        font-weight: 700;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 16px;
      }
      section {
        background: color-mix(in srgb, var(--panel) 88%, transparent);
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 16px;
      }
      .wide {
        grid-column: 1 / -1;
      }
      dl {
        margin: 0;
      }
      .kv-row {
        display: grid;
        grid-template-columns: minmax(170px, 0.36fr) minmax(0, 1fr);
        gap: 18px;
        padding: 8px 0;
        border-top: 1px solid rgb(255 255 255 / 0.07);
      }
      .kv-row:first-child {
        border-top: 0;
      }
      dt {
        color: var(--muted);
        font-weight: 700;
        min-width: 0;
        overflow-wrap: anywhere;
      }
      dd {
        margin: 0;
        min-width: 0;
        overflow-wrap: anywhere;
      }
      ul {
        margin: 0;
        padding-left: 20px;
      }
      li + li {
        margin-top: 7px;
      }
      .good h2 {
        color: var(--good);
      }
      .warn h2 {
        color: var(--warn);
      }
      .cyan h2 {
        color: var(--cyan);
      }
      code {
        color: var(--cyan);
      }
      @media (max-width: 780px) {
        .grid {
          grid-template-columns: 1fr;
        }
        .kv-row {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <h1>${escapeHtml(witness.title)}</h1>
        <p class="subtitle">${escapeHtml(witness.summary.operatorRead)}</p>
        <div class="verdict">${escapeHtml(witness.summary.verdict)}</div>
      </header>
      <div class="grid">
        <section class="cyan">
          <h2>Route Identity</h2>
          <dl>${renderDefinitionList(compactObjectRows(witness.routeIdentity))}</dl>
        </section>
        <section class="cyan">
          <h2>Yielding Contract</h2>
          <dl>${renderDefinitionList([
            { key: labelForKey('primitive'), value: witness.yieldingContract.primitive },
            { key: labelForKey('phaseProgramFields'), value: witness.yieldingContract.phaseProgramFields.join(', ') },
            { key: labelForKey('schedulerFields'), value: witness.yieldingContract.schedulerFields.join(', ') },
            { key: labelForKey('observedBoundaries'), value: witness.yieldingContract.observedBoundaries.join(', ') },
            { key: labelForKey('routeStageBoundary'), value: witness.yieldingContract.routeStageBoundary },
          ])}</dl>
        </section>
        <section class="good">
          <h2>What This Proves</h2>
          <ul>${renderList(witness.proves)}</ul>
        </section>
        <section class="warn">
          <h2>What This Does Not Prove</h2>
          <ul>${renderList(witness.doesNotProve)}</ul>
        </section>
        <section>
          <h2>Positive Evidence</h2>
          <dl>${renderDefinitionList([
            ...compactObjectRows({
              ...witness.positiveEvidence,
              gaussianCount: formatInteger(witness.positiveEvidence.gaussianCount),
            }).filter(row => row.key !== labelForKey('scheduler')),
            { key: labelForKey('scheduler'), value: JSON.stringify(witness.positiveEvidence.scheduler) },
          ])}</dl>
        </section>
        <section class="warn">
          <h2>Boundaries</h2>
          <dl>${renderDefinitionList(compactObjectRows(witness.boundaries))}</dl>
        </section>
        <section>
          <h2>Lamellar Impact</h2>
          <dl>${renderDefinitionList(compactObjectRows(witness.lamellarImpact))}</dl>
        </section>
        <section>
          <h2>Source Receipts</h2>
          <ul>${renderList(witness.sourceReceipts)}</ul>
        </section>
      </div>
    </main>
  </body>
</html>
`;
}

export function writeCranialYieldingRouteHumanWitness({ inventory, htmlPath, jsonPath } = {}) {
  if (!htmlPath) throw new Error('writeCranialYieldingRouteHumanWitness requires htmlPath');
  if (!jsonPath) throw new Error('writeCranialYieldingRouteHumanWitness requires jsonPath');
  const witness = buildCranialYieldingRouteHumanWitness(inventory);
  const html = renderCranialYieldingRouteHumanWitnessHtml(witness);
  mkdirSync(dirname(htmlPath), { recursive: true });
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(htmlPath, html);
  writeFileSync(jsonPath, `${JSON.stringify(witness, null, 2)}\n`);
  return {
    schema: 'CranialYieldingRouteHumanWitnessWrite',
    htmlPath,
    jsonPath,
    witness,
  };
}

function isMainModule() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  const args = parseCliArgs(process.argv.slice(2));
  const htmlPath = resolve(args.get('--out') || '/tmp/kaminos-cranial-yielding-route-xray.html');
  const jsonPath = resolve(args.get('--json') || '/tmp/kaminos-cranial-yielding-route-xray.json');
  const fixture = createTargetOrbShellCompositionFixture({
    variantId: args.get('--variant') || 'wide-cup',
    variationSeed: Number(args.get('--seed') || 6),
    variationLeafCount: Number(args.get('--leaves') || 11),
  });
  const result = writeCranialYieldingRouteHumanWitness({
    inventory: fixture.proceduralArchitectureInventory,
    htmlPath,
    jsonPath,
  });
  process.stdout.write(`${JSON.stringify({
    schema: result.schema,
    htmlPath: result.htmlPath,
    jsonPath: result.jsonPath,
    verdict: result.witness.summary.verdict,
  }, null, 2)}\n`);
}
