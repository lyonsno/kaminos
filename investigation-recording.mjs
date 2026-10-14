const consumers = new Set();

// Sources emit after their ordinary operation applies. With no investigation
// attached, they can skip constructing the observation entirely.
export const investigationOperations = Object.freeze({
  get active() {return consumers.size > 0;},
  emit(operation) {
    for (const consume of consumers) consume(operation);
  },
});

export function createInvestigationRecording({id, source, initial, startingConditions,
  now = () => performance.now()}) {
  if (typeof id !== 'string' || !id) throw Error('Recording id is required');
  if (!source || !Object.keys(source).length) throw Error('Recording source is required');
  if (!initial || !startingConditions?.kind) throw Error('Recording starting conditions are required');
  const started = now();
  const state = structuredClone({schema: 'kaminos.investigation-recording.v1', id, source, initial,
    startingConditions, startedAt: new Date().toISOString(), status: 'recording', complete: true,
    operations: [], issues: []});
  let sequence = 0;
  const consume = operation => {
    const index = ++sequence;
    try {
      if (!operation || typeof operation.kind !== 'string' || !operation.kind
        || typeof operation.phase !== 'string' || !operation.phase
        || typeof operation.target !== 'string' || !operation.target
        || !Object.hasOwn(operation, 'effective')) {
        throw Error('Operation requires kind, phase, target and effective value');
      }
      const retained = structuredClone(operation);
      state.operations.push({...retained, actor: retained.actor ?? 'unattributed',
        sequence: index, elapsedMs: now() - started});
    } catch (error) {
      state.complete = false;
      state.issues.push({sequence: index, phase: 'record-operation', error: String(error)});
    }
  };
  consumers.add(consume);
  const snapshot = () => structuredClone({...state, sequence});
  return Object.freeze({
    id,
    snapshot,
    finish() {
      consumers.delete(consume);
      if (state.status === 'recording') {
        state.status = 'finished';
        state.finishedAt = new Date().toISOString();
      }
      return snapshot();
    },
  });
}
