export function incidentLightBatchTimestampWrites(querySet, repeat, repeats) {
  if (!Number.isInteger(repeat) || !Number.isInteger(repeats) || repeats < 1 || repeat < 0 || repeat >= repeats) {
    throw new RangeError('invalid incident-light batch repetition');
  }
  if (repeat !== 0 && repeat !== repeats - 1) return undefined;
  return {
    querySet,
    ...(repeat === 0 ? { beginningOfPassWriteIndex: 0 } : {}),
    ...(repeat === repeats - 1 ? { endOfPassWriteIndex: 1 } : {}),
  };
}
