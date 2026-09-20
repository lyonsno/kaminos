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

export function encodeIncidentLightBatch(lightField, encoder, fluidIndex, querySet, repeats) {
  for (let repeat = 0; repeat < repeats; repeat++) {
    lightField.encode(encoder, fluidIndex, incidentLightBatchTimestampWrites(querySet, repeat, repeats));
  }
}
