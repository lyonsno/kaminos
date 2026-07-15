function requirePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer`);
  return value;
}

export async function readCompleteChunkedJsonEvidence({
  metadata,
  chunkCharacters,
  readChunk,
  onProgress = () => {},
} = {}) {
  if (!metadata || typeof metadata !== 'object') throw new Error('chunked JSON evidence metadata is required');
  if (typeof metadata.transportId !== 'string' || metadata.transportId.length === 0) {
    throw new Error('chunked JSON evidence transport identity is required');
  }
  const totalCharacters = requirePositiveInteger(metadata.totalCharacters, 'chunked JSON evidence total characters');
  const requestedChunkCharacters = requirePositiveInteger(chunkCharacters, 'chunked JSON evidence chunk characters');
  if (typeof readChunk !== 'function') throw new Error('chunked JSON evidence readChunk must be a function');
  if (typeof onProgress !== 'function') throw new Error('chunked JSON evidence onProgress must be a function');

  const chunks = [];
  let completedCharacters = 0;
  let chunkCount = 0;
  onProgress({
    transportId: metadata.transportId,
    totalCharacters,
    completedCharacters,
    chunkCount,
    passed: false,
  });
  while (completedCharacters < totalCharacters) {
    const length = Math.min(requestedChunkCharacters, totalCharacters - completedCharacters);
    const fragment = await readChunk({ offset: completedCharacters, length });
    if (!fragment || typeof fragment !== 'object') throw new Error(`chunked JSON evidence fragment ${chunkCount} is missing`);
    if (fragment.transportId !== metadata.transportId) {
      throw new Error(`chunked JSON evidence transport identity changed at chunk ${chunkCount}`);
    }
    if (fragment.offset !== completedCharacters) {
      throw new Error(`chunked JSON evidence offset mismatch at chunk ${chunkCount}`);
    }
    if (fragment.totalCharacters !== totalCharacters) {
      throw new Error(`chunked JSON evidence total changed at chunk ${chunkCount}`);
    }
    if (typeof fragment.payload !== 'string' || fragment.payload.length === 0) {
      throw new Error(`chunked JSON evidence payload is blank at chunk ${chunkCount}`);
    }
    if (fragment.payload.length > length || completedCharacters + fragment.payload.length > totalCharacters) {
      throw new Error(`chunked JSON evidence payload exceeds the requested range at chunk ${chunkCount}`);
    }
    chunks.push(fragment.payload);
    completedCharacters += fragment.payload.length;
    chunkCount += 1;
    onProgress({
      transportId: metadata.transportId,
      totalCharacters,
      completedCharacters,
      chunkCount,
      passed: false,
    });
  }

  const raw = chunks.join('');
  if (raw.length !== totalCharacters || completedCharacters !== totalCharacters) {
    throw new Error('chunked JSON evidence assembly is partial');
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`chunked JSON evidence parse failed: ${error.message}`);
  }
  const transport = Object.freeze({
    schema: 'kaminos.chunked-json-evidence-transport.v0',
    transportId: metadata.transportId,
    totalCharacters,
    completedCharacters,
    chunkCharacters: requestedChunkCharacters,
    chunkCount,
    passed: true,
  });
  onProgress(transport);
  return Object.freeze({ value, transport });
}
