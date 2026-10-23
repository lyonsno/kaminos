export function checkExternalApp(record) {
  const problems = [];
  if (record.gpuErrors.length) problems.push(`WebGPU errors: ${record.gpuErrors[0]}`);
  if (!/no-weights-here/.test(record.failedLoad ?? '')) problems.push(`a load from a base without weights should fail naming it, got ${record.failedLoad}`);
  if (!(record.first.greenStd > 5)) problems.push(`the first image looks blank (green std ${record.first.greenStd})`);
  if (!/multiples of 16/.test(record.invalidRequest ?? '')) problems.push(`a 100 x 100 request should fail, got ${record.invalidRequest}`);
  if (!(record.second.greenStd > 5)) problems.push('the second image looks blank');
  if (!record.second.textCached) problems.push('the second generation should reuse the cached prompt encoding');
  if (!/destroyed/.test(record.afterDestroy ?? '')) problems.push(`a destroyed pipeline should refuse, got ${record.afterDestroy}`);
  if (record.deviceAfterDestroy?.join() !== '1,2,3,4') problems.push('the device should still work after destroy');
  for (const event of ['step', 'preview']) if (!record.events.some(e => event in e)) problems.push(`no ${event} progress reported`);
  for (const seed of [1, 2]) {
    const run = record.events.find(e => e.seed === seed && 'cooperativeDuties' in e);
    if (!(run?.cooperativeDuties > 0)) problems.push(`generation ${seed} did not execute cooperative duties`);
    if (!(run?.frames > 0)) problems.push(`generation ${seed} did not service foreground frames`);
  }
  if (record.paused?.status !== 'paused' || record.resumed?.status !== 'running'
      || record.pausedFrame?.status !== 'completed') problems.push('pause, foreground frame, and resume were not exercised');
  if (record.routesAfterRuns !== 0 || record.afterRuns?.phase !== 'idle' || record.afterRuns?.error !== null) {
    problems.push('generation did not leave a clean reusable application');
  }
  if (record.app?.ownership?.device !== 'borrowed') problems.push('the application did not borrow the host device');
  return problems;
}
