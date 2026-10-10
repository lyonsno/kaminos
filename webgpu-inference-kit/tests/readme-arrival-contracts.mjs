import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import * as kit from '../src/index.js';

const packageRoot = new URL('../', import.meta.url);
const readPackageFile = relativePath => readFile(new URL(relativePath, packageRoot), 'utf8');
const readRepoFile = relativePath => readFile(new URL(`../../${relativePath}`, import.meta.url), 'utf8');

const [readme, packageJson, rootReadme, samDemoGuide] = await Promise.all([
  readPackageFile('README.md'),
  readPackageFile('package.json').then(JSON.parse),
  readRepoFile('README.md'),
  readPackageFile('docs/sam-semantic-demo.md'),
]);

const section = (copy, heading) => {
  const start = copy.indexOf(`${heading}\n`);
  assert.notEqual(start, -1, `${heading} section must exist`);
  const end = copy.indexOf('\n## ', start + heading.length);
  return copy.slice(start, end === -1 ? copy.length : end);
};

const passage = (copy, startNeedle, endNeedle) => {
  const start = copy.indexOf(startNeedle);
  assert.notEqual(start, -1, `SAM passage must contain ${startNeedle}`);
  const end = endNeedle === null ? copy.length : copy.indexOf(endNeedle, start);
  assert.notEqual(end, -1, `SAM passage must end at ${endNeedle}`);
  return copy.slice(start, end);
};

const withClaim = (copy, anchor, claim) => {
  assert.ok(copy.includes(anchor), `fixture anchor must exist: ${anchor}`);
  return copy.replace(anchor, `${anchor} ${claim}`);
};

const assertSurfaceSemantics = (name, copy, patterns) => {
  for (const [label, pattern] of patterns) {
    assert.match(copy, pattern, `${name} must preserve ${label}`);
  }
};

const assertNoSamOverclaim = (name, copy) => {
  const overclaims = [
    ['presentation/frame/latency guarantee', /\b(?:guarantees?|maintains?|sustains?|delivers?)\b.{0,100}\b(?:\d+\s*fps|frames? per second|frame[- ]?(?:pacing|latency|budget)|presentation cadence|responsive presentation)\b/i],
    ['adaptive or preemptive scheduling', /\b(?:adaptively budgets?|preempts|(?:provides?|delivers?|supports?|uses?)\b.{0,80}\badaptive frame[- ]?budget(?:ing)?)\b/i],
    ['video or tracking support', /\b(?:supports?|provides?)\b.{0,60}\b(?:video tracking|tracking across)\b/i],
    ['broad semantic or native-resolution quality', /\b(?:guarantees?|delivers?|provides?|supports?|achieves?|is)\b.{0,100}\b(?:semantically accurate|broad semantic accuracy|native-resolution (?:quality|universality)|native resolution)\b/i],
    ['general throughput guarantee', /\b(?:guarantees?|delivers?|provides?)\b.{0,100}\b(?:streaming\s+)?throughput\b/i],
  ];
  for (const [label, pattern] of overclaims) {
    assert.doesNotMatch(copy, pattern, `${name} must not claim ${label}`);
  }
};

const assertSamPublicClaims = ({ rootReadme: root, packageReadme, samDemoGuide: guide }) => {
  const rootSection = section(root, '## WebGPU Inference Kit');
  const packageSection = section(packageReadme, '## One Runtime, Different Models');
  const surfaces = {
    'root README': passage(rootSection, '| [SAM 3]', '\n\nThe package includes'),
    'package README': passage(packageSection, '| [SAM 3]', '\n\n```text'),
    'SAM demo guide': guide,
  };

  // The READMEs are reader-facing summaries; the witness detail (bit-exact cold/warm outputs, the
  // empty negative control, boundary semantics) is held on the SAM guide below. Every surface must
  // present the image detector, never a SAM 3.1 or video result.
  assert.match(packageReadme, /SAM 3 image detector/i, 'package README must identify the image detector');
  assert.match(guide, /SAM 3 image detector/i, 'SAM demo guide must identify the image detector');
  assert.match(surfaces['root README'], /object instances in an uploaded image from a text prompt/i, 'root README must describe the image detector');
  for (const name of ['root README', 'package README']) {
    assert.doesNotMatch(surfaces[name], /SAM 3\.1|\bvideo\b/i, `${name} must not imply a SAM 3.1 video result`);
  }
  assert.match(guide, /SAM 3\.1 tracking primitives[\s\S]*do not exercise a video/i, 'image evidence must remain distinct from tracking primitives');

  assertSurfaceSemantics('root README', surfaces['root README'], [
    ['an image-plus-text mask result', /masks from an image and text prompt/i],
    ['a complete browser WebGPU route', /complete browser WebGPU route/i],
    ['persistent model resources', /persistent model package/i],
    ['cached image features', /cached image features/i],
    ['queued prompts', /queued prompts/i],
    ['same-device foreground submissions', /same-device foreground submissions/i],
  ]);
  assertSurfaceSemantics('package README', surfaces['package README'], [
    ['an image-plus-text mask result', /masks from an image and text prompt/i],
    ['a complete browser WebGPU route', /complete browser WebGPU route/i],
    ['persistent authenticated model resources', /authenticated persistent model resources/i],
    ['cached image features', /cached image features/i],
    ['queued requests', /queued semantic requests/i],
    ['same-device foreground submissions at phase boundaries', /same-device foreground submissions at phase boundaries/i],
  ]);
  assertSurfaceSemantics('SAM demo guide', surfaces['SAM demo guide'], [
    ['an image-plus-text browser WebGPU route', /image and text prompt[\s\S]*in browser WebGPU/i],
    ['persistent authenticated model resources', /authenticated host views[\s\S]*persistent GPU weights/i],
    ['cached image features', /reuses its image features/i],
    ['queued requests', /registered session route's queue/i],
    ['same-device foreground submissions at existing boundaries', /exact device and queue[\s\S]*existing model boundaries/i],
    ['exact cold/warm four-instance witness equality', /cold and warm retained the same four instances and were bit-exact/i],
    ['an exactly empty negative control', /negative control retained no candidate and produced exact-zero mask and logit output/i],
  ]);

  for (const [name, copy] of Object.entries(surfaces)) assertNoSamOverclaim(name, copy);
  const combined = Object.values(surfaces).join('\n');
  assert.doesNotMatch(combined, /In development: SAM/i);
  assert.doesNotMatch(combined, /foreground rendering is the next integration target/i);
};

assert.equal(typeof kit.createWebGpuInferenceSession, 'function');
assert.match(
  section(readme, '## Quick Look'),
  /from ["']@kaminos\/webgpu-inference-kit\/core["']/,
  'the first model-neutral example must use the core entrypoint',
);
assert.match(readme, /createWebGpuInferenceSession/);
assert.match(readme, /registerRoute/);
assert.match(readme, /route\.enqueue/);
assert.match(readme, /job\.completion/);
assert.match(readme, /completion\.status === ['"]succeeded['"]/);
assert.match(readme, /Ports can adopt a common application-facing shape/);
const modelRows = readme.split('\n').filter(line => line.startsWith('| ['));
for (const repo of ['moge-webgpu', 'sf3d-webgpu', 'sharp-webgpu', 'kimodo-webgpu']) {
  const rows = modelRows.filter(line => line.includes(`https://github.com/lyonsno/${repo})`));
  assert.equal(rows.length, 1, `${repo} must have one model-family row`);
  const columns = rows[0].split('|').slice(1, -1).map(value => value.trim());
  assert.equal(columns.length, 3, `${repo} must name the port, output, and integration`);
  assert.ok(columns.every(Boolean), `${repo} must populate every column`);
}
assert.match(modelRows.find(line => line.includes('/kimodo-webgpu)')), /text embeddings.*external server/i);
assertSamPublicClaims({ rootReadme, packageReadme: readme, samDemoGuide });
const contradictoryClaims = [
  {
    name: 'same-sentence while-clause frame guarantee',
    field: 'rootReadme',
    value: rootReadme.replace(
      'usage and performance measurements.',
      'usage and performance measurements, while SAM guarantees 60 FPS during inference.',
    ),
    expected: /presentation|frame|latency/i,
  },
  {
    name: 'same-sentence comma-less frame guarantee',
    field: 'rootReadme',
    value: rootReadme.replace(
      'usage and performance measurements.',
      'usage and performance measurements but SAM guarantees 60 FPS during inference.',
    ),
    expected: /presentation|frame|latency/i,
  },
  {
    name: 'same-sentence frame guarantee',
    field: 'rootReadme',
    value: rootReadme.replace(
      'usage and performance measurements.',
      'usage and performance measurements, and SAM guarantees 60 FPS during inference.',
    ),
    expected: /presentation|frame|latency/i,
  },
  {
    name: 'same-sentence disclaimer and video-tracking claim',
    field: 'samDemoGuide',
    value: samDemoGuide.replace(
      'or a throughput guarantee.',
      'or a throughput guarantee, but SAM supports video tracking across arbitrary clips.',
    ),
    expected: /video|tracking/i,
  },
  {
    name: 'root-README frame guarantee',
    field: 'rootReadme',
    value: withClaim(rootReadme, 'See its guide for model setup, usage and performance measurements.', 'SAM guarantees 60 FPS during inference.'),
    expected: /presentation|frame|latency/i,
  },
  {
    name: 'package adaptive/preemptive scheduling claim',
    field: 'packageReadme',
    value: withClaim(readme, 'caches image features across prompts.', 'SAM adaptively budgets every frame and preempts submitted GPU dispatches.'),
    expected: /adaptive|preemptive/i,
  },
  {
    name: 'demo video-tracking claim',
    field: 'samDemoGuide',
    value: withClaim(samDemoGuide, '## Evidence Boundary', 'SAM supports video tracking across arbitrary clips.'),
    expected: /video|tracking/i,
  },
  {
    name: 'root broad semantic/native-resolution claim',
    field: 'rootReadme',
    value: withClaim(rootReadme, 'See its guide for model setup, usage and performance measurements.', 'SAM is semantically accurate across arbitrary images and prompts at native resolution.'),
    expected: /semantic|native-resolution/i,
  },
  {
    name: 'package general-throughput claim',
    field: 'packageReadme',
    value: withClaim(readme, 'caches image features across prompts.', 'SAM guarantees streaming throughput for every supported model package.'),
    expected: /throughput/i,
  },
];
for (const fixture of contradictoryClaims) {
  const surfaces = { rootReadme, packageReadme: readme, samDemoGuide };
  surfaces[fixture.field] = fixture.value;
  assert.throws(
    () => assertSamPublicClaims(surfaces),
    fixture.expected,
    `${fixture.name} must fail even when approved phrases remain`,
  );
}
assert.doesNotMatch(readme, /These ports share a common application-facing shape/);
assert.doesNotMatch(readme, /That firing exercises the architecture.*persistent model resources/);

assert.doesNotMatch(readme, /\b(?:loadModelPort|LoadedModel|ModelRun)\b/);
assert.doesNotMatch(readme, /^## Receipt And Evidence Layer$/m);

assert.equal(packageJson.version, '0.1.56');
assert.ok(packageJson.files.includes('docs'), 'published package must include linked documentation');
assert.ok(packageJson.files.includes('examples'), 'published package must include the runnable example');

const integrationReference = await readPackageFile('docs/integration-reference.md');
assert.match(integrationReference, /^# @kaminos\/webgpu-inference-kit$/m);
assert.match(integrationReference, /^## Start Here When Porting A Long Model$/m);
assert.ok(readme.length < integrationReference.length, 'README must compress rather than duplicate the advanced manual');

const localLinks = [...readme.matchAll(/\]\(([^)]+)\)/g)]
  .map(match => match[1])
  .filter(target => !/^(?:[a-z]+:|#)/i.test(target));
assert.ok(localLinks.includes('./docs/integration-reference.md'));
assert.ok(localLinks.includes('./docs/getting-started.md'));
for (const target of localLinks) {
  await access(fileURLToPath(new URL(target, new URL('README.md', packageRoot))));
}

console.log('README arrival contracts passed');
