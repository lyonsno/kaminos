import {SphericalHarmonics3, Vector3} from './three.core.js';

export function validateLightingReport(report) {
  if (report?.schema !== 'kaminos.inferred-lighting.v1' || report.status !== 'complete') {
    throw Error('A complete inferred-lighting report is required');
  }
  if (!report.checkpointSha256 || !report.sourceRevision || !report.effectiveDevice ||
      !report.environmentSha256 || !report.input?.image?.startsWith('data:image/png;base64,')) {
    throw Error('Lighting source and effective-route identity are required');
  }
  for (const name of ['estimated', 'reference']) {
    const sh = report.lights?.[name]?.sh;
    if (!Array.isArray(sh) || sh.length !== 9 || sh.some(row => !Array.isArray(row) || row.length !== 3 || row.some(v => !Number.isFinite(v)))) {
      throw Error(`${name}: expected nine finite RGB SH coefficients`);
    }
  }
  return report;
}

export function validateLightingSuite(suite) {
  if (suite?.schema !== 'kaminos.inferred-lighting-suite.v1' || suite.status !== 'complete' || !suite.cases?.length) {
    throw Error('A complete lighting suite is required');
  }
  const ids = new Set();
  for (const entry of suite.cases) {
    if (!entry.id || ids.has(entry.id)) throw Error('Lighting case ids must be unique');
    if (entry.status !== 'complete' || !entry.reportUrl || !entry.label || !entry.environmentSha256) throw Error('Each lighting case must be complete and source-identified');
    ids.add(entry.id);
  }
  return suite;
}

export function makeDiffuseEvaluator(coefficients, reflectance = .5) {
  const sh = new SphericalHarmonics3();
  coefficients.forEach((v, i) => sh.coefficients[i].fromArray(v));
  const direction = new Vector3(), irradiance = new Vector3(), up = new Vector3(0, 1, 0);
  return (normal, exposure = 0, yaw = 0) => {
    direction.fromArray(normal).applyAxisAngle(up, -yaw);
    sh.getIrradianceAt(direction, irradiance);
    const gain = reflectance / Math.PI * 2 ** exposure;
    return irradiance.toArray().map(v => Math.max(0, v * gain));
  };
}
