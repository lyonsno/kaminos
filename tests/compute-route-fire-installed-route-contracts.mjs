import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const routeDir = join(root, 'routes', 'sharp-image-to-splat-live-v0');
const routeManifestPath = join(routeDir, 'kaminos-route.json');

assert.ok(existsSync(routeManifestPath), 'Kaminos ships an installed SHARP route package manifest');
const routeManifest = JSON.parse(readFileSync(routeManifestPath, 'utf8'));
assert.equal(routeManifest.schema, 'kaminos.installed-route-package.v0');
assert.equal(routeManifest.runtime, 'kaminos-installed-route');
assert.equal(routeManifest.entrypoint, 'pipeline-witness.mjs');
assert.equal(routeManifest.adapterEntrypoint, 'scripts/run-sharp-webgpu-adapter.mjs');
assert.equal(routeManifest.pipelineManifest, 'pipelines/asset-pipelines.json');
assert.ok(existsSync(join(routeDir, routeManifest.entrypoint)), 'installed route has its pipeline witness entrypoint');
assert.ok(existsSync(join(routeDir, routeManifest.adapterEntrypoint)), 'installed route has its browser adapter entrypoint');
assert.ok(existsSync(join(routeDir, routeManifest.pipelineManifest)), 'installed route has its local pipeline manifest');

const kit = await import('../webgpu-inference-kit/src/index.js');
assert.equal(typeof kit.createSharpImageToSplatRouteDefinition, 'function');
const definition = kit.createSharpImageToSplatRouteDefinition();
assert.equal(definition.schema, 'kaminos.webgpu-route-definition.v0');
assert.equal(definition.routeId, 'sharp.image-to-splat.webgpu-local.v0');
assert.equal(definition.worker?.pipelineRouteId, 'adapter.sharp-image-to-splat-live.v0');
assert.ok(definition.requiredOutputRoles.includes('splat-candidate'));
