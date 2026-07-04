import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const packageJsonPath = join(root, 'package.json');
const lockPath = join(root, 'package-lock.json');

assert.ok(existsSync(packageJsonPath), 'Kaminos must declare a package manifest for browser WebGPU kit dependency resolution');
assert.ok(existsSync(lockPath), 'Kaminos must lock @kaminos/webgpu-inference-kit for portable local smokes');

const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const packageLock = JSON.parse(readFileSync(lockPath, 'utf8'));
const dependencyVersion = packageJson.dependencies?.['@kaminos/webgpu-inference-kit'];

assert.equal(packageJson.type, 'module', 'Kaminos package manifest keeps Node contract tests on ESM');
assert.ok(dependencyVersion, 'Kaminos declares @kaminos/webgpu-inference-kit as a runtime dependency');
assert.match(dependencyVersion, /0\.1\.5/, 'Kaminos pins the published kit version consumed by the browser route producer');
assert.equal(packageLock.packages?.['node_modules/@kaminos/webgpu-inference-kit']?.version, '0.1.5', 'package lock resolves the published kit version');

const kit = await import('@kaminos/webgpu-inference-kit');
assert.equal(kit.WEBGPU_INFERENCE_KIT_VERSION, '0.1.5');
assert.equal(kit.MOGE_DEPTH_NORMAL_ROUTE_ID, 'moge.depth-normal.webgpu-local.v0');
assert.equal(typeof kit.createMogeDepthNormalRouteDefinition, 'function');
assert.equal(typeof kit.createMogeDepthNormalRouteReceipt, 'function');
assert.equal(typeof kit.createRouteInvocationRequest, 'function');
assert.equal(typeof kit.createRouteWorkerResult, 'function');
assert.equal(typeof kit.validateRouteWorkerResult, 'function');
assert.equal(typeof kit.classifyWebGpuRouteWorkerResultEvidence, 'function');
