#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  SAM3_MASK_DECODER_ISLAND_ROUTE_ID,
  createSam3MaskProjectionCpuOracle,
} from '../src/index.js';

const SCHEMA = 'kaminos.sam3-mask-island-oracle-packet.v0';

function usage() {
  return `Usage: node tools/sam-mask-island-oracle-packet.mjs --out-dir <dir> [shape/options]

Options:
  --out-dir <dir>                    Output directory for tensor packet files.
  --batch <n>                        Batch size. Default: 1.
  --mask-tokens <n>                  Mask token count. Default: 1.
  --channels <n>                     Projection channel count. Default: 2.
  --height <n>                       Output height. Default: 2.
  --width <n>                        Output width. Default: 2.
  --source-image-artifact-id <id>    Source image artifact id.
  --source-image-sha256 <sha256>     Source image hash.
  --prompt <text>                    Prompt text for receipt identity.
  --model <id>                       Oracle model id. Default: mlx-community/sam3-bf16.
`;
}

function parseArgs(argv) {
  const out = {
    batch: 1,
    maskTokens: 1,
    channels: 2,
    height: 2,
    width: 2,
    model: 'mlx-community/sam3-bf16',
    prompt: '',
    sourceImageArtifactId: null,
    sourceImageSha256: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === '--help' || key === '-h') {
      console.log(usage());
      process.exit(0);
    }
    if (!key.startsWith('--')) throw new Error(`unexpected argument: ${key}`);
    if (value == null || value.startsWith('--')) throw new Error(`${key} requires a value`);
    index += 1;

    switch (key) {
      case '--out-dir':
        out.outDir = resolve(value);
        break;
      case '--batch':
        out.batch = Number.parseInt(value, 10);
        break;
      case '--mask-tokens':
        out.maskTokens = Number.parseInt(value, 10);
        break;
      case '--channels':
        out.channels = Number.parseInt(value, 10);
        break;
      case '--height':
        out.height = Number.parseInt(value, 10);
        break;
      case '--width':
        out.width = Number.parseInt(value, 10);
        break;
      case '--source-image-artifact-id':
        out.sourceImageArtifactId = value;
        break;
      case '--source-image-sha256':
        out.sourceImageSha256 = value;
        break;
      case '--prompt':
        out.prompt = value;
        break;
      case '--model':
        out.model = value;
        break;
      default:
        throw new Error(`unknown option: ${key}`);
    }
  }

  if (!out.outDir) throw new Error('--out-dir is required');
  if (!out.sourceImageArtifactId) throw new Error('--source-image-artifact-id is required');
  if (!out.sourceImageSha256) throw new Error('--source-image-sha256 is required');
  for (const field of ['batch', 'maskTokens', 'channels', 'height', 'width']) {
    if (!Number.isInteger(out[field]) || out[field] <= 0) throw new Error(`--${field} must be a positive integer`);
  }

  return out;
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function bytesOfTypedArray(array) {
  return Buffer.from(array.buffer, array.byteOffset, array.byteLength);
}

function syntheticHyperInput(shape) {
  const values = new Float32Array(shape.batch * shape.maskTokens * shape.channels);
  for (let index = 0; index < values.length; index += 1) {
    const channel = index % shape.channels;
    values[index] = channel % 2 === 0 ? channel + 1 : -(channel + 1) / 2;
  }
  return values;
}

function syntheticUpscaledEmbedding(shape) {
  const values = new Float32Array(shape.batch * shape.channels * shape.height * shape.width);
  const hw = shape.height * shape.width;
  for (let batch = 0; batch < shape.batch; batch += 1) {
    for (let channel = 0; channel < shape.channels; channel += 1) {
      for (let spatial = 0; spatial < hw; spatial += 1) {
        const index = ((batch * shape.channels + channel) * hw) + spatial;
        values[index] = (batch + 1) * 0.25 + (channel + 1) * 0.5 + spatial;
      }
    }
  }
  return values;
}

async function writeTensor(outDir, file, array) {
  const bytes = bytesOfTypedArray(array);
  const path = join(outDir, file);
  await writeFile(path, bytes);
  return {
    file,
    path,
    sha256: sha256(bytes),
    byteLength: bytes.byteLength,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const shape = {
    batch: args.batch,
    maskTokens: args.maskTokens,
    channels: args.channels,
    height: args.height,
    width: args.width,
  };

  await mkdir(args.outDir, { recursive: true });

  const hyperInput = syntheticHyperInput(shape);
  const upscaledEmbedding = syntheticUpscaledEmbedding(shape);
  const oracle = createSam3MaskProjectionCpuOracle({
    hyperInput,
    upscaledEmbedding,
    shape,
  });

  const written = {
    hyperInput: await writeTensor(args.outDir, 'hyper-input.f32.bin', hyperInput),
    upscaledEmbedding: await writeTensor(args.outDir, 'upscaled-embedding.f32.bin', upscaledEmbedding),
    expectedMaskLogits: await writeTensor(args.outDir, 'expected-mask-logits.f32.bin', oracle.maskLogits),
    expectedBinaryMask: await writeTensor(args.outDir, 'expected-binary-mask.u32.bin', oracle.binaryMask),
  };

  const promptHash = sha256(Buffer.from(args.prompt, 'utf8'));
  const staticWeights = {
    artifactId: 'sam3-weights:none-mask-projection-oracle-boundary',
    sha256: sha256(Buffer.from('sam3-mask-projection-threshold:no-static-decoder-weights', 'utf8')),
    role: 'none',
    reason: 'synthetic mask projection boundary has no static decoder weights',
  };
  const manifest = {
    schema: SCHEMA,
    routeId: SAM3_MASK_DECODER_ISLAND_ROUTE_ID,
    mode: 'synthetic',
    boundary: 'sam3-mask-projection-threshold',
    createdAt: new Date().toISOString(),
    model: {
      id: args.model,
      role: 'oracle-upstream',
    },
    prompt: {
      text: args.prompt,
      sha256: promptHash,
    },
    sourceImage: {
      artifactId: args.sourceImageArtifactId,
      sha256: args.sourceImageSha256,
    },
    staticWeights,
    shape,
    claims: {
      fullSam3BrowserExecution: false,
      upstream: 'synthetic-oracle',
      browserExecutedStages: ['decode-mask', 'threshold-mask'],
    },
    tensors: [
      {
        role: 'hyper-input',
        file: written.hyperInput.file,
        sha256: written.hyperInput.sha256,
        dtype: 'float32',
        shape: [shape.batch, shape.maskTokens, shape.channels],
        layout: 'B,T,C',
        byteLength: written.hyperInput.byteLength,
      },
      {
        role: 'upscaled-embedding',
        file: written.upscaledEmbedding.file,
        sha256: written.upscaledEmbedding.sha256,
        dtype: 'float32',
        shape: [shape.batch, shape.channels, shape.height, shape.width],
        layout: 'B,C,H,W',
        byteLength: written.upscaledEmbedding.byteLength,
      },
      {
        role: 'expected-mask-logits',
        file: written.expectedMaskLogits.file,
        sha256: written.expectedMaskLogits.sha256,
        dtype: 'float32',
        shape: [shape.batch, shape.maskTokens, shape.height, shape.width],
        layout: 'B,T,H,W',
        byteLength: written.expectedMaskLogits.byteLength,
      },
      {
        role: 'expected-binary-mask',
        file: written.expectedBinaryMask.file,
        sha256: written.expectedBinaryMask.sha256,
        dtype: 'uint32',
        shape: [shape.batch, shape.maskTokens, shape.height, shape.width],
        layout: 'B,T,H,W',
        byteLength: written.expectedBinaryMask.byteLength,
      },
    ],
  };

  const manifestPath = join(args.outDir, 'tensor-manifest.json');
  const receiptPath = join(args.outDir, 'oracle-receipt.json');
  const receipt = {
    ok: true,
    schema: 'kaminos.sam3-mask-island-oracle-receipt.v0',
    routeId: SAM3_MASK_DECODER_ISLAND_ROUTE_ID,
    mode: 'synthetic',
    boundary: manifest.boundary,
    model: manifest.model,
    prompt: manifest.prompt,
    sourceImage: manifest.sourceImage,
    staticWeights: manifest.staticWeights,
    shape,
    outputs: {
      tensorManifest: manifestPath,
      hyperInput: written.hyperInput.path,
      upscaledEmbedding: written.upscaledEmbedding.path,
      expectedMaskLogits: written.expectedMaskLogits.path,
      expectedBinaryMask: written.expectedBinaryMask.path,
    },
  };

  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2), 'utf8');
  console.log(JSON.stringify(receipt, null, 2));
}

main().catch(error => {
  console.error(error.stack || `${error}`);
  process.exit(1);
});
