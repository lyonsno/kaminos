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

function abortableAdmission(admission, signal) {
  if (!signal) return admission;
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', abort);
    const abort = () => {
      cleanup();
      try { checkAbort(signal); } catch (error) { reject(error); }
    };
    signal.addEventListener('abort', abort, { once: true });
    // Keep handlers attached even after abort: a borrowed control may later
    // admit/reject the parked no-op. It must neither resume model work nor
    // produce an unhandled rejection after this request has disposed its state.
    Promise.resolve(admission).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    if (signal.aborted) abort();
  });
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
    if (control) await abortableAdmission(control.runDuty(() => checkAbort(signal)), signal);
    checkAbort(signal);
  };
  let state, allocated = false, result, failure, failed = false;
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
  } catch (error) { failure = error; failed = true; }
  if (allocated) {
    try { await model.disposeState(state); }
    catch (error) {
      if (failed) throw new AggregateError([failure, error], 'generation and state cleanup failed');
      throw error;
    }
  }
  if (failed) throw failure;
  return result;
}

/** Persistent, caller-owned cache over the same generation loop. Each request
 * supplies the COMPLETE intended token prefix. Only an exact extension reuses
 * state; edits, shorter prefixes and capacity changes replay the full input.
 * Cache identity follows tokens actually consumed by the model, not emitted
 * tokens. In particular the final sampled token/EOS is still pending in input.
 * The adapter must support append(ids,state,context), and state owns all hybrid
 * memory (KV, recurrent and convolution), not just attention keys and values.
 */
export function createGenerationSession({ model, capacity, control = null,
  now = () => performance.now() } = {}) {
  for (const name of ['createState', 'prefill', 'append', 'decode', 'disposeState']) {
    if (typeof model?.[name] !== 'function') throw new TypeError(`model.${name} is required`);
  }
  positiveInteger(capacity, 'capacity');
  if (typeof now !== 'function') throw new TypeError('now must be a function');
  let state, prefix = [], logits, active = null, controller = null, closing = null, closed = false;
  let valid = false;
  const lifetime = new AbortController();
  async function retire() {
    valid = false; prefix = []; logits = undefined;
    if (state !== undefined) { await model.disposeState(state); state = undefined; }
  }
  function generate(options = {}) {
    if (closed) return Promise.reject(new Error('generation session is closed'));
    if (active || closing) return Promise.reject(new Error('generation session is busy'));
    controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, lifetime.signal, ...(options.signal ? [options.signal] : [])]);
    const started = now(), usage = { cacheAction: 'prefill', reusedInputTokens: 0, evaluatedInputTokens: 0,
      inputMs: 0, decodeMs: 0, decodeCalls: 0, firstTokenMs: null };
    let touched = false;
    // Borrowing adapter prevents the one-shot loop from retiring successful
    // request state. The session is its sole owner and retires on failure/reset.
    const adapter = {
      async createState({ capacity: requested, control: effectiveControl }) {
        touched = true;
        if (state !== undefined && (!valid || requested !== capacity)) { usage.cacheAction = 'rebuild'; await retire(); }
        capacity = requested;
        if (state === undefined) state = await model.createState({ capacity, signal: lifetime.signal, control: effectiveControl });
        return state;
      },
      async prefill(ids, _, context) {
        const start = now();
        try {
          const matches = valid && prefix.length <= ids.length && prefix.every((id,i) => id === ids[i]);
          if (valid && !matches) {
            usage.cacheAction = 'rebuild'; await retire();
            state = await model.createState({ capacity, signal: lifetime.signal, control: context.control });
          }
          const reused = matches ? prefix.length : 0;
          usage.reusedInputTokens = reused; usage.evaluatedInputTokens = ids.length - reused;
          if (matches) {
            usage.cacheAction = reused === ids.length ? 'logits' : 'append';
            if (reused < ids.length) logits = await model.append(ids.slice(reused), state, context);
          } else logits = await model.prefill(ids, state, context);
          prefix = [...ids]; valid = true;
          return logits;
        } finally { usage.inputMs += now() - start; }
      },
      async decode(id, _, context) {
        const start = now();
        try { logits = await model.decode(id, state, context); prefix.push(id); return logits; }
        finally { usage.decodeMs += now() - start; usage.decodeCalls++; }
      },
      async disposeState() {},
    };
    const run = async () => {
      try {
        const result = await generateTokens({ ...options, model: adapter, capacity: options.capacity ?? capacity,
          control: options.control ?? control, signal,
          onToken: async (id,index) => {
            if (usage.firstTokenMs === null) usage.firstTokenMs = now() - started;
            if (options.onToken) await options.onToken(id,index);
          },
        });
        return { ...result, usage: { ...usage, cachedTokens: prefix.length, capacity, totalMs: now() - started } };
      } catch (error) {
        if (touched) {
          try { await retire(); }
          catch (cleanup) { throw new AggregateError([error,cleanup], 'generation session and cleanup failed'); }
        }
        throw error;
      }
    };
    active = run().finally(() => { active = null; controller = null; });
    return active;
  }
  function stop(dispose) {
    if (dispose) { closed = true; lifetime.abort('generation session disposed'); }
    if (closing) return closing;
    controller?.abort(dispose ? 'generation session disposed' : 'generation session reset');
    closing = (async () => {
      if (active) await active.catch(() => {});
      await retire();
    })().finally(() => { closing = null; });
    return closing;
  }
  return { generate, reset: () => stop(false), dispose: () => stop(true),
    snapshot: () => ({ closed, busy: Boolean(active || closing), capacity, cachedTokens: valid ? prefix.length : 0 }) };
}
