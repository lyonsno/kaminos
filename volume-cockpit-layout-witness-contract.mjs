import assert from 'node:assert/strict';
import { existsSync, renameSync, rmSync, writeFileSync } from 'node:fs';

export class TerminalWitnessError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TerminalWitnessError';
  }
}

export async function navigateWithBrowserDiagnostics(socket, url) {
  await socket.call('Page.enable');
  await socket.call('Runtime.enable');
  await socket.call('Log.enable');
  await socket.call('Page.navigate', { url });
}

export function summarizeBrowserEvent(event, fallbackSequence = null) {
  const witnessIdentity = {
    sequence: event.witnessSequence ?? fallbackSequence,
    phase: event.witnessPhase ?? null,
  };
  if (event.method === 'Runtime.exceptionThrown') {
    const details = event.params?.exceptionDetails || {};
    return {
      ...witnessIdentity,
      method: event.method,
      text: details.exception?.description || details.text || null,
      url: details.url || null,
      lineNumber: details.lineNumber ?? null,
      columnNumber: details.columnNumber ?? null,
    };
  }
  if (event.method === 'Log.entryAdded') {
    return {
      ...witnessIdentity,
      method: event.method,
      level: event.params?.entry?.level || null,
      text: event.params?.entry?.text || null,
      url: event.params?.entry?.url || null,
    };
  }
  return {
    ...witnessIdentity,
    method: event.method,
    type: event.params?.type || null,
    args: (event.params?.args || []).map(argument => argument.value ?? argument.description ?? null),
  };
}

export function firstBrowserFailure(events) {
  return events.map(summarizeBrowserEvent).find(event => (
    event.method === 'Runtime.exceptionThrown'
    || (event.method === 'Log.entryAdded' && event.level === 'error')
    || (event.method === 'Runtime.consoleAPICalled' && event.type === 'error')
  )) || null;
}

export function terminalLayoutReceiptFailure(receipt) {
  if (!receipt) return null;
  if (receipt.status === 'failed') {
    return {
      phase: receipt.phase || 'unknown',
      reason: receipt.reason || 'layout initialization failed',
    };
  }
  if (
    receipt.layoutIdentity === 'kaminos.volume.cockpit-layout.v1'
    && (
      receipt.persistenceAvailable === false
      || receipt.fallbackApplied === true
      || receipt.persistenceFailureReason != null
    )
  ) {
    return {
      phase: receipt.phase || 'complete',
      reason: receipt.persistenceFailureReason || receipt.reason || 'layout persistence unavailable',
    };
  }
  return null;
}

export function evaluateInitialLayoutAdmission(state, browserEvents) {
  const browserFailure = firstBrowserFailure(browserEvents);
  if (browserFailure) {
    throw new TerminalWitnessError(`browser initialization failed: ${JSON.stringify(browserFailure)}`);
  }
  const receiptFailure = terminalLayoutReceiptFailure(state.receipt);
  if (receiptFailure) {
    throw new TerminalWitnessError(
      `layout receipt failed at ${receiptFailure.phase}: ${receiptFailure.reason}`,
    );
  }
  if (state.receipt?.layoutIdentity !== 'kaminos.volume.cockpit-layout.v1') return null;
  if (!/saved|loaded/.test(state.status)) return null;
  return state;
}

function isExpectedLayoutStoreBlock(event) {
  return (
    event.method === 'Log.entryAdded'
    && event.level === 'error'
    && String(event.url || '').includes('/api/volume-cockpit-layouts')
    && String(event.text || '').includes('ERR_BLOCKED_BY_CLIENT')
  );
}

export function expectedLayoutStoreBlockSequencesInSlice(events, {
  startSequence,
  endSequence,
}) {
  return events.map(summarizeBrowserEvent).filter(event => (
    event.sequence >= startSequence
    && event.sequence < endSequence
    && isExpectedLayoutStoreBlock(event)
  )).map(event => event.sequence);
}

export function auditBrowserEvents(events, {
  allowedExpectedLayoutStoreBlockSequences = [],
} = {}) {
  const observed = events.map(summarizeBrowserEvent);
  const allowedSequences = new Set(allowedExpectedLayoutStoreBlockSequences);
  const allowed = observed.filter(event => (
    allowedSequences.has(event.sequence) && isExpectedLayoutStoreBlock(event)
  ));
  const rejected = observed.filter(event => (
    event.method === 'Runtime.exceptionThrown'
    || (event.method === 'Log.entryAdded' && event.level === 'error')
    || (event.method === 'Runtime.consoleAPICalled' && event.type === 'error')
  ) && !allowed.includes(event));
  if (rejected.length > 0) {
    throw new TerminalWitnessError(`browser event audit failed: ${JSON.stringify(rejected)}`);
  }
  return {
    observedEventCount: observed.length,
    allowedExpectedFailureCount: allowed.length,
    rejectedFailureCount: rejected.length,
    allowed,
    events: observed,
  };
}

export function assertAuthoredLayoutRestored({ authored, reloaded }) {
  assert.equal(reloaded.layout?.layoutId, authored.layoutId, 'reload restored the wrong layout identity');
  assert.equal(reloaded.layout?.label, authored.layoutLabel, 'reload lost the authored layout label');
  const renamedGroup = reloaded.groups.find(group => group.id === authored.renamedGroupId);
  const sourceGroup = reloaded.groups.find(group => group.id === authored.sourceGroupId);
  const targetGroup = reloaded.groups.find(group => group.id === authored.targetGroupId);
  assert.equal(renamedGroup?.label, authored.groupLabel, 'reload lost the authored group label');
  assert.ok(sourceGroup, 'reload lost the moved control source group');
  assert.ok(targetGroup, 'reload lost the moved control target group');
  assert.equal(
    sourceGroup.controls.includes(authored.movedControlId),
    false,
    'reload restored the moved control to its source group',
  );
  assert.equal(
    targetGroup.controls.includes(authored.movedControlId),
    true,
    'reload lost the moved control from its target group',
  );
  assert.deepEqual(reloaded.controls, authored.controls, 'reload changed canonical control values');
  return {
    layoutId: authored.layoutId,
    layoutLabel: authored.layoutLabel,
    renamedGroupId: authored.renamedGroupId,
    groupLabel: authored.groupLabel,
    movedControlId: authored.movedControlId,
    sourceGroupId: authored.sourceGroupId,
    targetGroupId: authored.targetGroupId,
  };
}

export function initializeScreenshotEvidence({ path, runId }) {
  assert.ok(runId, 'screenshot evidence requires a run identity');
  const partialPath = `${path}.${runId}.partial`;
  return {
    runId,
    path,
    partialPath,
    produced: false,
    published: false,
    admitted: false,
  };
}

export function prepareScreenshotEvidence(optionsOrEvidence) {
  const evidence = optionsOrEvidence.partialPath
    ? optionsOrEvidence
    : initializeScreenshotEvidence(optionsOrEvidence);
  rmSync(evidence.path, { force: true });
  rmSync(evidence.partialPath, { force: true });
  return evidence;
}

export function stageScreenshotEvidence(evidence, bytes) {
  assert.equal(evidence.published, false, 'cannot stage an already published screenshot');
  writeFileSync(evidence.partialPath, bytes);
  return { ...evidence, produced: true };
}

export function publishScreenshotEvidence(evidence) {
  assert.equal(evidence.produced, true, 'cannot publish a screenshot that was not produced');
  assert.equal(existsSync(evidence.partialPath), true, 'staged screenshot is missing');
  renameSync(evidence.partialPath, evidence.path);
  return { ...evidence, published: true, admitted: true };
}

export function rejectScreenshotEvidence(evidence) {
  if (!evidence) return null;
  rmSync(evidence.partialPath, { force: true });
  rmSync(evidence.path, { force: true });
  return { ...evidence, published: false, admitted: false };
}
