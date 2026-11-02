export function adjudicatePupExpansion(actual, expected) {
  if (!actual || actual.prompt !== expected.prompt || JSON.stringify(actual.inputIds) !== JSON.stringify([...expected.inputIds])) throw new Error('wrong PUP input');
  if (actual.tokenizerSha256 !== expected.tokenizerSha256 || actual.systemPromptsSha256 !== expected.systemPromptsSha256) throw new Error('wrong PUP assets');
  for (const key of ['temperature', 'topK', 'topP', 'minP', 'presencePenalty', 'maxNewTokens']) if (actual.settings?.[key] !== expected.settings[key]) throw new Error(`wrong PUP setting ${key}`);
  if (JSON.stringify(actual.settings.eosTokenIds) !== JSON.stringify(expected.settings.eosTokenIds)) throw new Error('wrong PUP stop policy');
  const output = actual.output;
  if (!output || output.finishReason !== 'eos' || !expected.settings.eosTokenIds.includes(output.stopTokenId)
    || output.promptTokenCount !== expected.inputIds.length || !Array.isArray(output.tokenIds) || !output.tokenIds.length
    || output.generatedTokenCount !== output.tokenIds.length + 1 || typeof output.text !== 'string' || !output.text.trim()
    || !Array.isArray(actual.stream) || actual.stream.some(x => typeof x !== 'string') || actual.stream.join('') !== output.text) throw new Error('partial/blank/inconsistent PUP expansion');
  return { inputTokens: output.promptTokenCount, generatedTokens: output.generatedTokenCount, finishReason: output.finishReason };
}
