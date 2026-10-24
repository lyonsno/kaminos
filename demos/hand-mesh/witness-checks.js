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
  const required = ['reacquire', 'stop', 'reload', 'restart', 'cancel-pending', 'camera-failure', 'mobile'];
  if (!report.setup) required.push('invalid-import', 'corrupt-import');
  for (const name of required) if (!report.steps?.some(row => row.name === name)) failures.push(`missing step ${name}`);
  const expectedSource = report.setup ? 'local-server' : 'browser-storage';
  if (report.steps?.find(row => row.name === 'reload')?.state?.source !== expectedSource) failures.push(`models were not restored from ${expectedSource}`);
  if (report.setup) {
    if (!['prepared', 'serving'].includes(report.setup.status) || report.setup.revision !== report.runtime?.source?.commit || report.runtime?.source?.kind !== 'verified-client-download' || !report.setup.client?.manifest?.sha256 || report.setup.client.manifest.sha256 !== report.runtime.source.manifestSha256) failures.push('setup/runtime source identity mismatch');
    if (loaded?.source !== 'local-server') failures.push('setup did not automatically load its own prepared models');
    if (report.setup.modelBundles?.['mobrecon.bin'] !== loaded?.identity?.mobrecon?.bundleSha256 || report.setup.modelBundles?.['hand-detector.bin'] !== loaded?.identity?.detector?.bundleSha256) failures.push('setup/browser model identity mismatch');
  }
  const stopped = report.steps?.find(row => row.name === 'stop')?.state;
  if (stopped?.running || stopped?.cameraState !== 'off' || stopped?.visible) failures.push('camera/mesh not stopped');
  if (report.errors?.length || report.error) failures.push('browser/witness errors');
  if (!report.browserClosed) failures.push('browser did not close');
  return failures;
}
