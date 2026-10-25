function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive safe integer`);
}
function tokenId(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('token ID must be a non-negative safe integer');
}
function checkAbort(signal) {
  if (!signal?.aborted) return;
  throw Object.assign(new Error(String(signal.reason?.message ?? signal.reason ?? 'generation stopped')), { name: 'AbortError' });
}

/**
 * One request over model-owned state. prefill(ids,state) predicts the first new
 * token; decode(id,state) consumes one selected token and predicts the next.
 * Both return opaque logits consumed by sample(). disposeState must settle
 * outstanding model work before releasing its state. Weights stay model-owned.
 * The model uses the supplied control for its leaf GPU duties too; wrapping a
 * whole prefill/decode in runDuty here would block those sub-token pause points.
 */
export async function generateTokens({ model, inputIds, capacity, maxNewTokens,
  eosTokenIds = [], sample, signal = null, control = null, onToken = null,
} = {}) {
  for (const method of ['createState', 'prefill', 'decode', 'disposeState']) {
    if (typeof model?.[method] !== 'function') throw new TypeError(`model.${method} is required`);
  }
  if (!inputIds || typeof inputIds[Symbol.iterator] !== 'function') throw new TypeError('inputIds must be iterable');
  const prompt = Array.from(inputIds);
  if (!prompt.length) throw new RangeError('inputIds must contain a prompt token');
  prompt.forEach(tokenId);
  positiveInteger(capacity, 'capacity'); positiveInteger(maxNewTokens, 'maxNewTokens');
  if (prompt.length > capacity) throw new RangeError('prompt exceeds generation state capacity');
  const eos = new Set(eosTokenIds); eos.forEach(tokenId);
  if (typeof sample !== 'function') throw new TypeError('sample callback is required');
  if (onToken != null && typeof onToken !== 'function') throw new TypeError('onToken must be a function');
  if (control != null && typeof control.runDuty !== 'function') throw new TypeError('control.runDuty is required');
  const gate = async () => {
    checkAbort(signal);
    if (control) await control.runDuty(() => {});
    checkAbort(signal);
  };
  let state, allocated = false, result, failure;
  try {
    await gate();
    state = await model.createState({ capacity, signal, control }); allocated = true;
    await gate();
    let logits = await model.prefill(prompt, state, { signal, control });
    let consumed = prompt.length;
    const generated = [];
    for (let i = 0; i < maxNewTokens; i++) {
      await gate();
      const id = await sample(logits, { generatedTokenIds: generated, signal, control });
      tokenId(id); checkAbort(signal);
      const base = { tokenIds: generated, finishReason: 'length', stopTokenId: null,
        promptTokenCount: prompt.length, generatedTokenCount: i + 1 };
      if (eos.has(id)) { result = { ...base, finishReason: 'eos', stopTokenId: id }; break; }
      generated.push(id);
      if (onToken) await onToken(id, i);
      checkAbort(signal);
      if (i + 1 === maxNewTokens) { result = base; break; }
      // The last cache position still predicts one token; only feeding that
      // selected token back would exceed capacity. No input/output truncation.
      if (consumed === capacity) { result = { ...base, finishReason: 'capacity' }; break; }
      await gate();
      logits = await model.decode(id, state, { signal, control }); consumed++;
    }
  } catch (error) { failure = error; }
  if (allocated) {
    try { await model.disposeState(state); }
    catch (error) {
      if (failure) throw new AggregateError([failure, error], 'generation and state cleanup failed');
      throw error;
    }
  }
  if (failure) throw failure;
  return result;
}
