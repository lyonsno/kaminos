// CPU reference/portable sampler. A GPU sampler can implement the generation
// driver's same callback contract without reading full logits back to the CPU.
export function sampleToken(logits, {
  temperature = 1, topK = 0, topP = 1, minP = 0,
  presencePenalty = 0, frequencyPenalty = 0, repetitionPenalty = 1,
  penaltyTokenIds = [], random = Math.random,
} = {}) {
  if (!logits || !Number.isSafeInteger(logits.length) || logits.length < 1) throw new TypeError('logits must be a nonempty numeric array');
  for (const [name, value] of Object.entries({ temperature, topP, minP, presencePenalty, frequencyPenalty, repetitionPenalty })) {
    if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  }
  if (temperature < 0 || !Number.isSafeInteger(topK) || topK < 0 || topP <= 0 || topP > 1 || minP < 0 || minP > 1 || repetitionPenalty <= 0) {
    throw new RangeError('invalid sampling parameters');
  }
  if (typeof random !== 'function') throw new TypeError('random must be a function');
  const counts = new Map();
  for (const id of penaltyTokenIds) {
    if (!Number.isSafeInteger(id) || id < 0 || id >= logits.length) throw new RangeError('penalty token ID outside logits vocabulary');
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  let best = -1, maximum = -Infinity;
  const candidates = [];
  for (let id = 0; id < logits.length; id++) {
    let score = logits[id];
    if (typeof score !== 'number' || Number.isNaN(score) || score === Infinity) throw new TypeError(`invalid logits at token ${id}`);
    if (score === -Infinity) continue;
    const count = counts.get(id) ?? 0;
    if (count) {
      score = score < 0 ? score * repetitionPenalty : score / repetitionPenalty;
      score -= presencePenalty + frequencyPenalty * count;
    }
    if (!Number.isFinite(score)) throw new RangeError('sampling penalties overflowed logits');
    if (score > maximum) { maximum = score; best = id; }
    candidates.push({ id, score, weight: 0 });
  }
  if (best < 0) throw new RangeError('logits contain no selectable token');
  if (temperature === 0) return best;
  // Explicit order: penalties -> temperature -> top-k -> min-p -> top-p.
  // Stable token-ID tie breaking makes seeded output reproducible on this path.
  candidates.sort((a, b) => b.score - a.score || a.id - b.id);
  const selected = topK > 0 ? candidates.slice(0, topK) : candidates;
  let total = 0;
  const filtered = [];
  for (const candidate of selected) {
    candidate.weight = Math.exp((candidate.score - maximum) / temperature);
    if (candidate.weight < minP) continue; // maximum weight is exactly one
    total += candidate.weight; filtered.push(candidate);
  }
  let cumulative = 0, count = filtered.length;
  if (topP < 1) {
    for (let i = 0; i < filtered.length; i++) {
      cumulative += filtered[i].weight;
      if (cumulative >= topP * total) { count = i + 1; total = cumulative; break; }
    }
  }
  const draw = random();
  if (!Number.isFinite(draw) || draw < 0 || draw >= 1) throw new RangeError('random must return a number in [0, 1)');
  const threshold = draw * total;
  cumulative = 0;
  for (let i = 0; i < count; i++) {
    cumulative += filtered[i].weight;
    if (threshold < cumulative) return filtered[i].id;
  }
  return filtered[count - 1].id; // floating-point endpoint rounding
}

// Mulberry32, with explicit uint32 seed. No seed or draw state is shared across requests.
export function createSeededRandom(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) throw new RangeError('seed must be a uint32');
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
