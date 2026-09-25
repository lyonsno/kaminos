import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const hostStart = html.indexOf('  compositionHost = {');
const hostEnd = html.indexOf('\n\n  function animate()', hostStart);
assert.ok(hostStart >= 0 && hostEnd > hostStart, 'composition scene host is defined before the app loop');
const hostSource = html.slice(hostStart, hostEnd);
const makeHost = new Function('sharedGpu', 'renderer', 'controls', 'renderPipeline', `
  let foregroundServiceActive = false;
  let insideForegroundFrame = false;
  let sceneFrameCount = 0;
  ${hostSource}
  return compositionHost;
`);
const device = { queue: {} };
const events = [];
const host = makeHost(
  { device },
  { backend: { device: {} } },
  { update() { events.push('controls'); } },
  { render() { events.push('scene'); } },
);
assert.equal(host.device, device, 'host scheduling is bound to the same provisioned device');
assert.throws(() => host.runForegroundFrame(() => {}), /invalid foreground scene frame state/);
host.setForegroundServiceActive(true);
const result = host.runForegroundFrame(() => {
  events.push('flame');
  assert.throws(() => host.runForegroundFrame(() => {}), /invalid foreground scene frame state/);
  return { status: 'submitted', renderer: 'ordinary-volume' };
});
assert.deepEqual(events, ['controls', 'flame', 'scene']);
assert.equal(result.sceneFrameCount, 1);
assert.equal(result.sceneAuthority, 'three-render-returned-inside-service-not-presentation');

assert.match(html, /if \(!foregroundServiceActive && mainRendererNeeded/,
  'the ordinary app loop cannot race a producer-owned scene/flame opportunity');
assert.match(html, /mountComposition\(\{[\s\S]*?sharedGpu,[\s\S]*?host: compositionHost/,
  'composition modules receive the app-owned same-device frame host');

console.log('shared-device composition host contracts passed');
