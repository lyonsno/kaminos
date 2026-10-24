export function admitFrozenStdResult(result, expected) {
  const backend = result?.backend;
  if (backend?.vendor !== 'apple' || !backend.architecture?.includes('metal') || backend.isFallbackAdapter !== false)
    throw Error('native Apple Metal adapter required');
  if (result.shaderSha256 !== expected.shaderSha256) throw Error('effective shader differs');
  const keys = new Set(expected.caseIds.flatMap(id => Array.from({ length: expected.repeats }, (_, trial) => `${id}:${trial}`)));
  if (result.rows?.length !== keys.size) throw Error('incomplete or extra observations');
  let exact = true, maxAbs = 0;
  for (const row of result.rows) {
    if (!keys.delete(`${row.id}:${row.trial}`)) throw Error('unexpected or duplicate observation');
    for (const field of ['actual', 'expected']) if (!Array.isArray(row[field]) || row[field].length !== 2 || !row[field].every(Number.isFinite))
      throw Error('two finite standard deviations required');
    for (let i = 0; i < 2; i++) { exact &&= row.actual[i] === row.expected[i]; maxAbs = Math.max(maxAbs, Math.abs(row.actual[i] - row.expected[i])); }
  }
  return { exact, maxAbs, observations: result.rows.length };
}
