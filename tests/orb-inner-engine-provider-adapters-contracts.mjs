import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeOrbInnerEngineConceptBundle } from '../orb-inner-engine-concept-loop.mjs';
import { writeRgbaPng } from '../orb-inner-engine-core.js';

const root = new URL('..', import.meta.url).pathname;
const providerPath = join(root, 'orb-inner-engine-provider-adapters.mjs');

assert.ok(existsSync(providerPath), 'orb-inner-engine-provider-adapters.mjs must define provider registry/adapters');

const source = readFileSync(providerPath, 'utf8');
assert.match(source, /orb-inner-engine-provider-adapters-v0/, 'provider adapters name a stable identity');
assert.match(source, /createOrbInnerEngineProviderRegistry/, 'provider adapters export registry construction');
assert.match(source, /resolveOrbInnerEngineProviderCommand/, 'provider adapters export provider command resolution');
assert.match(source, /runOrbInnerEngineProviderRoute/, 'provider adapters export route execution');
assert.match(source, /local-image\.ideogram4/, 'provider adapters include Ideogram4');
assert.match(source, /local-video\.cosmos3-mlx\.t2v/, 'provider adapters include Cosmos3 text-to-video');
assert.match(source, /local-video\.cosmos3-mlx\.i2v/, 'provider adapters include Cosmos3 image-to-video');
assert.match(source, /local-image\.diffusion-fallback/, 'provider adapters include a discovered diffusion fallback slot');
assert.doesNotMatch(source, /shell:\s*true/, 'provider adapters must not require shell execution');

const {
  ORB_INNER_ENGINE_PROVIDER_ADAPTERS_IDENTITY,
  createOrbInnerEngineProviderRegistry,
  detectProviderBlockedImage,
  resolveOrbInnerEngineProviderCommand,
  runOrbInnerEngineProviderRoute,
} = await import(`${providerPath}?contract=${Date.now()}`);

assert.equal(ORB_INNER_ENGINE_PROVIDER_ADAPTERS_IDENTITY, 'orb-inner-engine-provider-adapters-v0');

function writeExecutable(path, text) {
  writeFileSync(path, text, { mode: 0o755 });
}

function fixtureProviderScript({ outputFlag = '--output', receiptFlag = '--receipt' } = {}) {
  return [
    "const fs = require('node:fs');",
    "const args = new Map();",
    "for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);",
    `const out = args.get('${outputFlag}');`,
    `const receipt = args.get('${receiptFlag}');`,
    "if (!out) process.exit(13);",
    "fs.writeFileSync(out, Buffer.from('89504e470d0a1a0a66616b652d706e67', 'hex'));",
    "if (receipt) fs.writeFileSync(receipt, JSON.stringify({ ok: true, argv: process.argv.slice(2), seed: args.get('--seed'), prompt: args.get('--prompt') || process.argv[2] }, null, 2));",
    "console.log(JSON.stringify({ ok: true, out }));",
    '',
  ].join('\n');
}

const outDir = mkdtempSync(join(tmpdir(), 'kaminos-provider-adapters-'));
try {
  const ideogramRoot = join(outDir, 'mlx-ideogram4');
  const cosmosRoot = join(outDir, 'cosmos3-mlx');
  mkdirSync(ideogramRoot, { recursive: true });
  mkdirSync(cosmosRoot, { recursive: true });
  writeExecutable(join(ideogramRoot, 'generate.py'), fixtureProviderScript({ outputFlag: '--output', receiptFlag: '--receipt' }));
  writeExecutable(join(cosmosRoot, 'txt2video.py'), fixtureProviderScript({ outputFlag: '--output', receiptFlag: '--receipt' }));
  writeExecutable(join(cosmosRoot, 'img2video.py'), fixtureProviderScript({ outputFlag: '--output', receiptFlag: '--receipt' }));

  const registry = createOrbInnerEngineProviderRegistry({
    ideogramRoot,
    cosmosRoot,
    pythonCommand: process.execPath,
    diffusionRoots: [join(outDir, 'missing-diffusion')],
  });

  assert.equal(registry.identity, 'orb-inner-engine-provider-adapters-v0');
  const providers = new Map(registry.providers.map(provider => [provider.id, provider]));
  assert.equal(providers.get('local-image.ideogram4').status, 'configured');
  assert.equal(providers.get('local-image.ideogram4').mediaKind, 'image');
  assert.equal(providers.get('local-image.ideogram4').outputExtension, 'png');
  assert.equal(providers.get('local-image.ideogram4').defaultArgs.preset, 'V4_DEFAULT_20');
  assert.equal(providers.get('local-video.cosmos3-mlx.t2v').status, 'configured');
  assert.equal(providers.get('local-video.cosmos3-mlx.t2v').mediaKind, 'video');
  assert.equal(providers.get('local-video.cosmos3-mlx.t2v').outputExtension, 'mp4');
  assert.equal(providers.get('local-video.cosmos3-mlx.i2v').status, 'configured');
  assert.equal(providers.get('local-image.diffusion-fallback').status, 'unconfigured');

  const ideogramCommand = resolveOrbInnerEngineProviderCommand({
    registry,
    providerId: 'local-image.ideogram4',
  });
  assert.equal(ideogramCommand.ok, true);
  assert.equal(ideogramCommand.providerId, 'local-image.ideogram4');
  assert.equal(ideogramCommand.mediaKind, 'image');
  assert.equal(ideogramCommand.outputExtension, 'png');
  assert.equal(ideogramCommand.command, process.execPath);
  assert.ok(ideogramCommand.timeoutMs >= 900000, 'Ideogram route must not inherit the short generic timeout');
  assert.ok(ideogramCommand.args.includes('--adapter'));
  assert.ok(ideogramCommand.args.includes('ideogram4'));
  assert.ok(ideogramCommand.args.includes('--prompt'));
  assert.ok(ideogramCommand.args.includes('{prompt}'));
  assert.ok(ideogramCommand.args.includes('--negative'));
  assert.ok(ideogramCommand.args.includes('{negative}'));
  assert.ok(ideogramCommand.args.includes('--seed'));
  assert.ok(ideogramCommand.args.includes('{seed}'));
  assert.ok(ideogramCommand.args.includes('--out'));
  assert.ok(ideogramCommand.args.includes('{output}'));
  assert.ok(ideogramCommand.args.includes('--preset'));
  assert.ok(ideogramCommand.args.includes('V4_DEFAULT_20'));

  const bundle = writeOrbInnerEngineConceptBundle({
    outDir,
    coreSeed: 'molten-heartfucker-core-contract',
    conceptSeed: 'provider-contract',
    conceptCount: 1,
  });

  const ideogramRun = runOrbInnerEngineProviderRoute({
    bundleRoot: bundle.bundleRoot,
    registry,
    providerId: 'local-image.ideogram4',
  });
  assert.equal(ideogramRun.ok, true);
  assert.equal(ideogramRun.status, 'complete');
  const ideogramRecords = JSON.parse(readFileSync(ideogramRun.recordsPath, 'utf8'));
  assert.equal(ideogramRecords.identity, 'orb-inner-engine-provider-route-records-v0');
  assert.equal(ideogramRecords.providerId, 'local-image.ideogram4');
  assert.equal(ideogramRecords.mediaKind, 'image');
  assert.match(ideogramRecords.startedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(ideogramRecords.endedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(ideogramRecords.durationMs >= 0, 'provider route envelope records duration');
  assert.equal(ideogramRecords.records.length, 1);
  assert.equal(ideogramRecords.records[0].status, 'complete');
  assert.match(ideogramRecords.records[0].startedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(ideogramRecords.records[0].endedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(ideogramRecords.records[0].durationMs >= 0, 'provider route item records duration');
  assert.match(ideogramRecords.records[0].outputImagePath, /\.png$/);
  assert.ok(existsSync(ideogramRecords.records[0].providerReceiptPath), 'provider adapter writes native receipt path');
  assert.equal(readFileSync(ideogramRecords.records[0].outputImagePath).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const nativeReceipt = JSON.parse(readFileSync(ideogramRecords.records[0].providerReceiptPath, 'utf8'));
  assert.match(nativeReceipt.seed, /^[0-9]+$/, 'adapter converts arbitrary concept seed to numeric provider seed');
  assert.doesNotThrow(() => JSON.parse(nativeReceipt.prompt), 'adapter passes documented JSON prompt string to native Ideogram route');
  const nativePrompt = JSON.parse(nativeReceipt.prompt);
  assert.ok(nativePrompt.prompt.includes('contained radial molten engine core'), 'adapter preserves the positive prompt in JSON prompt field');
  assert.ok(nativePrompt.negative_prompt.includes('flat orange disk'), 'adapter preserves negative prompt in JSON negative_prompt field');
  assert.ok(!nativeReceipt.prompt.includes('Avoid:'), 'adapter must not inject negative prompt as visible natural-language content');

  const cosmosRun = runOrbInnerEngineProviderRoute({
    bundleRoot: bundle.bundleRoot,
    registry,
    providerId: 'local-video.cosmos3-mlx.t2v',
  });
  assert.equal(cosmosRun.ok, true);
  const cosmosRecords = JSON.parse(readFileSync(cosmosRun.recordsPath, 'utf8'));
  assert.equal(cosmosRecords.providerId, 'local-video.cosmos3-mlx.t2v');
  assert.equal(cosmosRecords.mediaKind, 'video');
  assert.ok(cosmosRecords.durationMs >= 0, 'Cosmos provider envelope records duration');
  assert.ok(cosmosRecords.records[0].durationMs >= 0, 'Cosmos provider item records duration');
  assert.match(cosmosRecords.records[0].outputImagePath, /\.mp4$/);
  assert.ok(cosmosRecords.records[0].argv.includes('--frames'));
  assert.ok(cosmosRecords.records[0].argv.includes('8'));
  assert.ok(cosmosRecords.records[0].argv.includes('--steps'));
  assert.ok(cosmosRecords.records[0].argv.includes('4'));

  const missingRun = runOrbInnerEngineProviderRoute({
    bundleRoot: bundle.bundleRoot,
    registry,
    providerId: 'local-image.diffusion-fallback',
  });
  assert.equal(missingRun.ok, false);
  assert.equal(missingRun.status, 'unconfigured');
  const missingRecords = JSON.parse(readFileSync(missingRun.recordsPath, 'utf8'));
  assert.equal(missingRecords.providerId, 'local-image.diffusion-fallback');
  assert.ok(missingRecords.durationMs >= 0, 'unconfigured provider envelope records duration');
  assert.ok(missingRecords.records.every(record => record.failurePhase === 'configuration'));
  assert.ok(missingRecords.records.every(record => record.durationMs >= 0));

  const blockedSource = join(outDir, 'blocked-card.png');
  const width = 256;
  const height = 256;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 0;
    rgba[i + 1] = 0;
    rgba[i + 2] = 0;
    rgba[i + 3] = 255;
  }
  for (let y = 112; y < 144; y++) {
    for (let x = 38; x < 218; x++) {
      if ((x + y) % 5 !== 0) {
        const i = (y * width + x) * 4;
        rgba[i] = 238;
        rgba[i + 1] = 238;
        rgba[i + 2] = 238;
      }
    }
  }
  writeRgbaPng(blockedSource, { width, height, rgba });
  const blockProbe = detectProviderBlockedImage(blockedSource);
  assert.equal(blockProbe.blocked, true, 'blocked-card heuristic catches black safety-card style output');

  const grayBlockedSource = join(outDir, 'gray-blocked-card.png');
  const grayRgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < grayRgba.length; i += 4) {
    grayRgba[i] = 128;
    grayRgba[i + 1] = 128;
    grayRgba[i + 2] = 128;
    grayRgba[i + 3] = 255;
  }
  for (let y = 112; y < 144; y++) {
    for (let x = 38; x < 218; x++) {
      if ((x + y) % 5 !== 0) {
        const i = (y * width + x) * 4;
        grayRgba[i] = 238;
        grayRgba[i + 1] = 238;
        grayRgba[i + 2] = 238;
      }
    }
  }
  writeRgbaPng(grayBlockedSource, { width, height, rgba: grayRgba });
  const grayBlockProbe = detectProviderBlockedImage(grayBlockedSource);
  assert.equal(grayBlockProbe.blocked, true, 'blocked-card heuristic catches gray safety-card style output');
  assert.equal(grayBlockProbe.failurePhase, 'provider-blocked-output');

  const blankSource = join(outDir, 'blank-neutral-output.png');
  const blankRgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < blankRgba.length; i += 4) {
    blankRgba[i] = 174;
    blankRgba[i + 1] = 166;
    blankRgba[i + 2] = 146;
    blankRgba[i + 3] = 255;
  }
  writeRgbaPng(blankSource, { width, height, rgba: blankRgba });
  const blankProbe = detectProviderBlockedImage(blankSource);
  assert.equal(blankProbe.blocked, true, 'output heuristic catches blank low-variance neutral provider output');
  assert.equal(blankProbe.failurePhase, 'provider-blank-output');

  const blockedRoot = join(outDir, 'blocked-ideogram');
  mkdirSync(blockedRoot, { recursive: true });
  writeExecutable(join(blockedRoot, 'generate.py'), [
    "const fs = require('node:fs');",
    "const args = new Map();",
    "for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);",
    `fs.copyFileSync(${JSON.stringify(blockedSource)}, args.get('--output'));`,
    "fs.writeFileSync(args.get('--receipt'), JSON.stringify({ ok: true, seed: args.get('--seed'), prompt: args.get('--prompt') }, null, 2));",
    "console.log(JSON.stringify({ ok: true, blockedFixture: true }));",
    '',
  ].join('\n'));
  const blockedRegistry = createOrbInnerEngineProviderRegistry({
    ideogramRoot: blockedRoot,
    cosmosRoot,
    pythonCommand: process.execPath,
    diffusionRoots: [],
  });
  const blockedBundle = writeOrbInnerEngineConceptBundle({
    outDir: join(outDir, 'blocked-bundle'),
    coreSeed: 'molten-heartfucker-core-contract',
    conceptSeed: 'provider-blocked-contract',
    conceptCount: 1,
  });
  const blockedRun = runOrbInnerEngineProviderRoute({
    bundleRoot: blockedBundle.bundleRoot,
    registry: blockedRegistry,
    providerId: 'local-image.ideogram4',
  });
  assert.equal(blockedRun.ok, false);
  assert.equal(blockedRun.status, 'failed');
  const blockedRecords = JSON.parse(readFileSync(blockedRun.recordsPath, 'utf8'));
  assert.equal(blockedRecords.records[0].failurePhase, 'provider-blocked-output');
  assert.equal(blockedRecords.records[0].providerBlockDetection.blocked, true);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
