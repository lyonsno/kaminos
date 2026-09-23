import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const exporter = await readFile(new URL('../tools/trellis-dinov3-mlx-reference.py', import.meta.url), 'utf8');
assert.match(exporter, /ea8dc2863c51be0a264bab82070e3e8836b02d51/, 'reference exporter must pin the inspected DINOv3 snapshot');
assert.match(exporter, /dcb2e45127cccbf1601e5f42fef165eea275c8e5213197e8dcf3f48822718179/, 'reference exporter must pin the checkpoint bytes');
assert.match(exporter, /135ecd23e34a70b6fbed8b083fdecb319b7e3a54e3d849258bbe4ddcf1783bb5/, 'reference exporter must pin the model config bytes');
assert.match(exporter, /960c41d1f3a7778b936365769a2d90550b318a6c0a53a0296957adacfe5e0dd7/, 'reference exporter must pin the preprocessing config bytes');
assert.match(exporter, /float32/, 'reference export must record and enforce the matched f32 precision');
assert.match(exporter, /patch_embeddings[\s\S]*prefix_hidden_states[\s\S]*block0_hidden_states/, 'reference packet must expose patch, prefix, and complete block-zero outputs');
assert.match(exporter, /rgb\.resize\(\(512, 512\), Image\.LANCZOS\)/, 'reference preprocessing must pin native TRELLIS 512 Lanczos behavior');
assert.match(exporter, /model\.layers\[0\]\(prefix_hidden_states,[\s\S]*model\.num_prefix_tokens/, 'reference packet must execute one whole DINOv3 transformer block');
assert.match(exporter, /"sha256": sha256_bytes\(payload\)/, 'every exported tensor must retain byte identity');

console.log('TRELLIS DINOv3 checkpoint prefix/block contracts passed');
