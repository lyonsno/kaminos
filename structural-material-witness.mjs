#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  STRUCTURAL_MATERIAL_ROUTE,
  buildStructuralMaterialWitnessScenario,
  renderStructuralMaterialSvg,
} from './structural-material-core.js';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1] ?? '');
}

const outArg = args.get('--out') || 'artifacts/structural-material-witness/proxy-plane-fracture.svg';
const out = resolve(outArg);
const reportArg = args.get('--report') || outArg.replace(/\.svg$/i, '.json');
const reportPath = resolve(reportArg);
const scenario = buildStructuralMaterialWitnessScenario({
  magnitude: Number(args.get('--magnitude') || 1.35),
  forceY: Number(args.get('--force-y') || 0.5),
});

const panels = [
  renderStructuralMaterialSvg(scenario.states.initial, { title: 'initial notched proxy', width: 420, height: 300 }),
  renderStructuralMaterialSvg(scenario.states.cracked, { title: 'same force: stress-threshold crack', width: 420, height: 300 }),
  renderStructuralMaterialSvg(scenario.states.control, { title: 'unnotched control under same force', width: 420, height: 300 }),
  renderStructuralMaterialSvg(scenario.states.bound, { title: 'binding repairs local connectivity', width: 420, height: 300 }),
];

const panelBodies = panels.map((svg, index) => {
  const x = index % 2 === 0 ? 0 : 440;
  const y = index < 2 ? 0 : 320;
  return `<g transform="translate(${x},${y})">${svg.replace(/<svg[^>]*>|<\/svg>/g, '')}</g>`;
}).join('\n');

const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="860" height="620" viewBox="0 0 860 620">
  <rect width="860" height="620" fill="#0b0d12"/>
  ${panelBodies}
</svg>`;

const report = {
  schema: scenario.schema,
  requestedRoute: STRUCTURAL_MATERIAL_ROUTE,
  effectiveRoute: scenario.effectiveRoute,
  solverAuthority: scenario.solverAuthority,
  geometryAuthority: scenario.geometryAuthority,
  output: outArg,
  reportPath: reportArg,
  summaries: scenario.summaries,
  claimBoundary: 'deterministic coarse structural graph witness; not engineering-exact fracture prediction',
};

mkdirSync(dirname(out), { recursive: true });
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(out, sheet);
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  ok: true,
  requestedRoute: STRUCTURAL_MATERIAL_ROUTE,
  effectiveRoute: scenario.effectiveRoute,
  out,
  report: reportPath,
  crackedBrokenBonds: scenario.summaries.cracked.brokenBondCount,
  controlBrokenBonds: scenario.summaries.control.brokenBondCount,
  repairedBonds: scenario.summaries.bound.repairedBondCount,
}, null, 2));
