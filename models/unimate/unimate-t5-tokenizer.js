// SentencePiece unigram tokenizer for Flan-T5, as UniMate's T5Conditioner
// tokenizes text (T5Tokenizer: nmt_nfkc normalization, extra whitespace removed,
// "▁" word-boundary marker with a leading one, Viterbi segmentation over piece
// scores, an unknown character becomes <unk>, and </s> is appended).
//
// The model's precompiled nmt_nfkc character map is approximated by Unicode
// NFKC plus SentencePiece's whitespace handling; the contract test checks the
// result against the Python tokenizer.

const SPACE = '▁';

export function createT5Tokenizer({ pieces, scores, unk_id: unkId, eos_id: eosId = 1 }) {
  const vocab = new Map();
  pieces.forEach((p, i) => { if (i > 2) vocab.set(p, i); });  // ids 0..2 are <pad>, </s>, <unk>
  const maxLen = pieces.reduce((m, p) => Math.max(m, [...p].length), 0);
  const unkScore = Math.min(...scores) - 10;                     // SentencePiece kUnkPenalty

  function normalize(text) {
    // NFKC, control characters to spaces, collapse runs of whitespace, trim.
    const t = text.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    return t ? SPACE + t.replace(/ /g, SPACE) : '';
  }

  function encode(text) {
    const s = [...normalize(text)];
    const n = s.length;
    const best = new Float64Array(n + 1).fill(-Infinity);
    const back = new Array(n + 1);
    best[0] = 0;
    for (let i = 0; i < n; i++) {
      if (best[i] === -Infinity) continue;
      let matched = false;
      let piece = '';
      for (let j = i; j < Math.min(n, i + maxLen); j++) {
        piece += s[j];
        const id = vocab.get(piece);
        if (id === undefined) continue;
        matched = matched || j === i;
        const score = best[i] + scores[id];
        if (score > best[j + 1]) { best[j + 1] = score; back[j + 1] = [i, id]; }
      }
      if (!matched) {
        const score = best[i] + unkScore;
        if (score > best[i + 1]) { best[i + 1] = score; back[i + 1] = [i, unkId]; }
      }
    }
    const ids = [];
    for (let k = n; k > 0; k = back[k][0]) ids.push(back[k][1]);
    ids.reverse();
    // Consecutive unknowns collapse into one <unk>, as SentencePiece does.
    const merged = ids.filter((id, i) => !(id === unkId && ids[i - 1] === unkId));
    return [...merged, eosId];
  }

  return { encode, normalize };
}
