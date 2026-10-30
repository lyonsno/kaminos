// Report admission checks; speed is reported separately from numerical parity.
export function validateCausalAttentionReport(report, tokens) {
  if (report.route !== 'KleinTextEncoder.attention' || report.rows?.length !== tokens.length) throw Error('missing or wrong attention route/rows');
  for (const [i, r] of report.rows.entries()) {
    if (r.tokens !== tokens[i] || r.errors?.length !== 0 || r.nonFinite !== 0 || !(r.relL2 < 1e-4) || !(r.oracleMaxAbs < 0.002)) throw Error('attention parity/route mismatch');
    if (r.outputElements?.length !== 2 || r.outputElements.some(n => n !== r.tokens * 32 * 128)) throw Error('missing/partial attention output');
    if (r.variants?.length !== 2 || r.variants[0].mode !== 'materialized' || r.variants[1].mode !== 'causal-tiled') throw Error('wrong attention modes');
    const keys = r.variants[1].pipelineKeys;
    if (!keys?.some(k => k.endsWith('-causal-scores')) || (r.tokens % 4 === 0 && !keys.some(k => k.endsWith('-causal-values')))) throw Error('candidate kernel missing');
  }
}
