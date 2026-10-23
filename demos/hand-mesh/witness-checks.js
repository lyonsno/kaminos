export function verifyHandDemoReport(report, expectedRoot) {
  const failures = [];
  if (report.runtime?.source?.repoRoot !== expectedRoot || !report.runtime?.source?.commit) failures.push('wrong or missing source root/revision');
  if (report.input?.kind !== 'retained-camera-video' || !report.input.sha256) failures.push('missing retained input identity');
  if (!report.playback?.verifiedBlob || report.playback.sha256 !== report.input?.sha256 || !(report.playback.byteLength > 0)) failures.push('browser playback is not bound to the retained input');
  const loaded = report.steps?.find(row => row.name === 'import')?.state;
  if (loaded?.identity?.backend !== 'webgpu-local' || loaded?.identity?.mobrecon?.backend !== 'webgpu-local' || loaded?.identity?.detector?.backend !== 'webgpu-local' || loaded?.viewerBackend !== 'webgpu') failures.push('wrong or missing effective WebGPU route');
  if (!loaded?.identity?.mobrecon?.bundleSha256 || !loaded?.identity?.detector?.bundleSha256) failures.push('missing effective model identities');
  const live = report.steps?.find(row => row.name === 'live')?.state;
  if (!(live?.received > 0 && live.running && live.visible)) failures.push('no displayed live mesh');
  const miss = report.steps?.find(row => row.name === 'miss')?.state;
  if (!(miss?.misses > 0 && miss.presentation === 'no-hand' && !miss.visible && miss.lastTimings?.mobreconMs === 0)) failures.push('miss did not skip reconstruction');
  for (const name of ['reacquire', 'stop', 'reload', 'restart', 'cancel-pending', 'invalid-import', 'corrupt-import', 'camera-failure', 'mobile']) if (!report.steps?.some(row => row.name === name)) failures.push(`missing step ${name}`);
  if (report.steps?.find(row => row.name === 'reload')?.state?.source !== 'browser-storage') failures.push('models were not restored from browser storage');
  const stopped = report.steps?.find(row => row.name === 'stop')?.state;
  if (stopped?.running || stopped?.cameraState !== 'off' || stopped?.visible) failures.push('camera/mesh not stopped');
  if (report.errors?.length || report.error) failures.push('browser/witness errors');
  if (!report.browserClosed) failures.push('browser did not close');
  return failures;
}
