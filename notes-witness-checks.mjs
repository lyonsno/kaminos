// Checks notes-witness.mjs relies on, kept apart so each can be tested against
// the failure it is meant to catch (tests/notes-witness-checks.mjs).

// Follow-ups count as delivered by the note ids `wait` handed to the agent and
// the log receipted for it, never by text that appears in a printed thread:
// `wait` shows a delivered note with its whole thread, undelivered notes too.
export function followUpsDelivered({waitResult, events, agent, ids}) {
  const claimed = new Set((waitResult?.notes ?? []).map(note => note.id));
  const receipted = new Set(events.filter(event => event.type === 'delivered' && event.recipient === agent).flatMap(event => event.notes ?? []));
  const missing = ids.filter(id => !claimed.has(id));
  const unreceipted = ids.filter(id => claimed.has(id) && !receipted.has(id));
  return {ok: missing.length === 0 && unreceipted.length === 0, claimed: [...claimed], missing, unreceipted};
}
