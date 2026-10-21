import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { dirname, resolve } from 'node:path';
import { canonicalSam3IdentityJson } from '../src/sam-browser-package-manifest.js';
import { readSafetensorsHeader, convertTensor, sha256, hashFile } from './sam-model.mjs';

// Release engineering: derive portable conversion mappings from an accepted export.
// Hash equality establishes the mapping, including exporter-only reshapes.
const { values } = parseArgs({ options: { checkpoint: { type: 'string' }, package: { type: 'string' }, out: { type: 'string' } } });
if (!values.checkpoint || !values.package || !values.out) throw new Error('--checkpoint, --package and --out are required');
const modelPackage = JSON.parse(await readFile(values.package, 'utf8'));
if (await hashFile(values.checkpoint) !== modelPackage.staticWeights.sha256) throw new Error('checkpoint differs from accepted package');
const header = await readSafetensorsHeader(values.checkpoint);
const wanted = new Set(modelPackage.weights.map(row => row.sha256));
const byDigest = new Map();
for (const name of Object.keys(header.tensors).sort()) {
  if (name === '__metadata__') continue;
  const digest = sha256(await convertTensor(values.checkpoint, header, name));
  if (wanted.has(digest) && !byDigest.has(digest)) byDigest.set(digest, name);
}
const tensors = {};
for (const weight of modelPackage.weights) {
  const name = byDigest.get(weight.sha256);
  if (!name) throw new Error(`no exact checkpoint tensor for ${weight.role}`);
  tensors[weight.file] = name;
}
const invocation = { schema: 'kaminos.sam3-browser-invocation.v0', prompt: { text: '', sha256: sha256('') },
  sourceImage: { runtimeOwner: 'caller', resolution: [1008, 1008], resize: { owner: 'browser',
    targetResolution: [1008, 1008], algorithm: 'pillow-12-fixed-point-bilinear-v0' } },
  postprocess: { scoreThreshold: 0.5, nms: true, nmsIouThreshold: 0.5, nmsKind: 'mlx-vlm-greedy-box-nms' } };
invocation.invocationId = `sam3-invocation:${sha256(canonicalSam3IdentityJson({ prompt: invocation.prompt,
  sourceImage: invocation.sourceImage, postprocess: invocation.postprocess }))}`;
const clip = 'https://huggingface.co/openai/clip-vit-base-patch32/resolve/3d74acf9a28c67741b2f4f2ea7635f0aaf6f0268';
const recipe = { schema: 'kaminos.sam3-portable-model-recipe.v1', checkpoint: {
  url: 'https://huggingface.co/mlx-community/sam3-bf16/resolve/dfe573c3171dbcfda8399c650d9135afa7e94592/model.safetensors',
  sha256: modelPackage.staticWeights.sha256 }, modelPackage, tensors,
  assets: [ { ...modelPackage.promptTokenizer.vocab, url: `${clip}/vocab.json` },
    { ...modelPackage.promptTokenizer.merges, url: `${clip}/merges.txt` },
    { file: 'SAM-LICENSE.txt', url: 'https://raw.githubusercontent.com/facebookresearch/sam3/7f473cfd983d5eb43040ff608f66bff0d7bdcb53/LICENSE',
      sha256: 'sha256:4dea99bfaa016e21bc860d73f344236bd1e5c4977d1a9a8fd32f822b500ae1be' },
    { file: 'CLIP-LICENSE.txt', url: 'https://raw.githubusercontent.com/openai/CLIP/d05afc436d78f1c48dc0dbf8e5980a9d471f35f6/LICENSE',
      sha256: 'sha256:987e63b32f6c89ff5160e429458a872ff048e6860b590a3912e938f9da8f14db' } ],
  root: { schema: 'kaminos.sam3-detector-stack-image-fpn-neck-real-boundary-packet.v0',
    routeId: 'sam3.detr-encoder.phase-program.webgpu-local.v0', mode: 'mlx-detector-stack-image-fpn-neck-export',
    boundary: 'sam3-browser-local-image-preprocess-patch-embed-vit-prefix-full-backbone-fpn-neck-detector-stack-phase-program' },
  invocation, provenance: { sourceModelPackageSha256: await hashFile(values.package),
    conversion: 'BF16 to F32, exact accepted export SHA-256 for every weight; no model execution' } };
await mkdir(dirname(resolve(values.out)), { recursive: true });
await writeFile(values.out, JSON.stringify(recipe, null, 2));
console.log(JSON.stringify({ status: 'complete', recipe: resolve(values.out), weights: Object.keys(tensors).length,
  modelPackageId: modelPackage.packageId }));
