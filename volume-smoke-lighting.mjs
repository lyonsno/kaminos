// One incident-light consumer for both the fine and exterior camera march.
// Material coefficients and direct camera emission are independent of selection.
export const SMOKE_INCIDENT_WGSL = `
fn smokeIncidentAt(p:vec3<f32>,extinction:f32)->vec3<f32>{
  return joinedSmokeIncidentAt(p,extinction);
}
`;

export function selectSmokeLightingShader(code, route) {
  const expressions = {
    point: 'joinedSmokeIncidentAt(p,extinction) + scenePointIncident(p)',
    // This producer returns zero outside its represented domain. Selecting it
    // does not grant exterior illumination or introduce a legacy ambient fill.
    distributed: 'distributedMeanIncident(p)',
  };
  if (!Object.hasOwn(expressions,route)) throw new Error(`unknown smoke lighting route: ${route}`);
  if (code.split(SMOKE_INCIDENT_WGSL).length !== 2) {
    throw new Error('smoke incident selector requires exactly one consumer definition');
  }
  return code.replace(SMOKE_INCIDENT_WGSL, SMOKE_INCIDENT_WGSL.replace(
    'joinedSmokeIncidentAt(p,extinction)', expressions[route]));
}
