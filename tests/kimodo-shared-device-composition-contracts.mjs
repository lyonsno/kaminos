import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const indexSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const volumeSource = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');

assert.equal(
  packageJson.dependencies?.['@kaminos/webgpu-inference-kit'],
  '^0.1.52',
  'the shared-device composition is pinned to the published kit surface Cranial currently supports',
);

assert.match(
  volumeSource,
  /export\s+async\s+function\s+requestKaminosSharedWebGpuDevice/,
  'Kaminos exposes one host-owned WebGPU device acquisition seam',
);
assert.doesNotMatch(
  volumeSource,
  /maxStorageBuffersIn(?:Fragment|Vertex)Stage/,
  'the composed descriptor contains only real WebGPU limit names that the public kit can validate on the acquired device',
);
assert.match(
  volumeSource,
  /configuredSharedGpuContext\?\.device[\s\S]*Shared Pyro GPU context queue does not belong/,
  'the volume renderer consumes the injected device and rejects a foreign queue',
);
assert.match(
  volumeSource,
  /function\s+setForegroundOpportunityRequester[\s\S]*foreground frame is still pending/,
  'the volume renderer can move its ordinary frame loop behind producer-granted foreground opportunities',
);
assert.match(
  volumeSource,
  /foregroundGpuContext\(\)[\s\S]*device[\s\S]*queue:\s*device\?\.queue/,
  'the composition can prove the effective ordinary renderer device and exact queue',
);

assert.match(
  indexSource,
  /composition_module_url[\s\S]*sharedGpuDeviceRequirements[\s\S]*requestKaminosSharedWebGpuDevice/,
  'the host loads declarative composition requirements before acquiring its device',
);
assert.match(
  indexSource,
  /new\s+THREE\.WebGPURenderer\(\{[^}]*device:\s*sharedGpu\.device/,
  'the ordinary Three renderer is constructed on the host shared device',
);
assert.match(
  indexSource,
  /sharedGpuContext:\s*sharedGpu/,
  'the native flame prototype receives the same host device',
);
assert.match(
  indexSource,
  /mountKaminosSharedDeviceComposition\(\{[^}]*compositionModule[^}]*prototype:\s*volumePrototype[^}]*sharedGpu[^}]*host:\s*compositionHost/,
  'the composition module receives the effective shared-device host rather than acquiring a fallback device',
);

console.log('Kimodo shared-device composition contracts passed');
