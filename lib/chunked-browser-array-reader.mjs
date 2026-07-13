const IDENTITY_FIELDS = ['nonce', 'reportPath', 'firingId', 'runId'];

function assertSnapshotIdentity(actual, expected, label) {
  for (const field of IDENTITY_FIELDS) {
    if (actual?.[field] !== expected?.[field]) {
      throw new Error(`${label} snapshot identity changed at ${field}: expected ${expected?.[field] ?? 'missing'}, observed ${actual?.[field] ?? 'missing'}`);
    }
  }
}

function metadataExpression(snapshotExpression, arrayKey) {
  return `(() => {
    const snapshot = ${snapshotExpression};
    const rows = snapshot?.[${JSON.stringify(arrayKey)}];
    return {
      identity: snapshot?.identity || null,
      arrayPresent: Array.isArray(rows),
      totalLength: Array.isArray(rows) ? rows.length : null,
    };
  })()`;
}

function chunkExpression(snapshotExpression, arrayKey, start, end) {
  return `(() => {
    const snapshot = ${snapshotExpression};
    const rows = snapshot?.[${JSON.stringify(arrayKey)}];
    return {
      identity: snapshot?.identity || null,
      arrayPresent: Array.isArray(rows),
      totalLength: Array.isArray(rows) ? rows.length : null,
      start: ${start},
      end: ${end},
      rows: Array.isArray(rows) ? rows.slice(${start}, ${end}) : null,
    };
  })()`;
}

export async function readBrowserArrayInChunks({
  evaluateExpression,
  snapshotExpression,
  arrayKey,
  expectedCount,
  expectedIdentity,
  timeoutMs,
  label,
  chunkSize = 256,
}) {
  if (typeof evaluateExpression !== 'function') throw new Error(`${label} requires a browser evaluator`);
  if (!Number.isInteger(expectedCount) || expectedCount < 0) {
    throw new Error(`${label} declared an invalid row count: ${expectedCount}`);
  }
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error(`${label} declared an invalid transport chunk size: ${chunkSize}`);
  }

  const metadata = await evaluateExpression(metadataExpression(snapshotExpression, arrayKey), timeoutMs);
  assertSnapshotIdentity(metadata?.identity, expectedIdentity, label);
  if (!metadata?.arrayPresent) throw new Error(`${label} browser array is missing`);
  if (metadata.totalLength !== expectedCount) {
    throw new Error(`${label} browser length mismatch: expected ${expectedCount}, observed ${metadata.totalLength}`);
  }

  const values = [];
  for (let start = 0; start < expectedCount; start += chunkSize) {
    const end = Math.min(start + chunkSize, expectedCount);
    const chunk = await evaluateExpression(chunkExpression(snapshotExpression, arrayKey, start, end), timeoutMs);
    assertSnapshotIdentity(chunk?.identity, expectedIdentity, label);
    if (!chunk?.arrayPresent) throw new Error(`${label} browser array disappeared at rows ${start}-${end}`);
    if (chunk.totalLength !== expectedCount) {
      throw new Error(`${label} browser length changed at rows ${start}-${end}: expected ${expectedCount}, observed ${chunk.totalLength}`);
    }
    if (chunk.start !== start || chunk.end !== end || !Array.isArray(chunk.rows) || chunk.rows.length !== end - start) {
      throw new Error(`${label} returned a partial chunk at rows ${start}-${end}: received ${chunk?.rows?.length ?? 'missing'}`);
    }
    values.push(...chunk.rows);
  }
  if (values.length !== expectedCount) {
    throw new Error(`${label} reconstruction was partial: expected ${expectedCount}, received ${values.length}`);
  }
  return values;
}
