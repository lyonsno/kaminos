import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const smoke = readFileSync(new URL('../sf3d-shared-device-smoke.mjs', import.meta.url), 'utf8');

test('same-device inference smoke records one unobscured active-scene frame with its source and flame sample', () => {
  assert.ok(smoke.includes('report.inferenceStartedAt=Date.now()'));
  assert.ok(smoke.includes('report.inferenceCapture={at:new Date().toISOString(),sourceCommit:report.sourceCommit,inferenceStatus:sample.infer'));
  assert.ok(smoke.includes("const sceneFrame='during-inference.png'"));
  assert.ok(smoke.includes("content:'#sf3d-hud { display: none !important; }'"));
  assert.ok(smoke.includes("if(!report.inferenceCapture)report.errors.push('inference-time scene capture missing')"));
});
