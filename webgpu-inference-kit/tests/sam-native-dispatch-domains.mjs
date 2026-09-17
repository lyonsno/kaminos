import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLinearDispatch } from '../src/runtime-primitives.js';

function expectedDomains(route, s, index) {
  const result = {};
  const add = (names, total, size = 64) => {
    for (const name of names.split(' ')) result[name] = { total, size };
  };
  const b = s.batch, c = s.channels, q = b * s.queryTokens, h = b * (s.queryTokens + 1);
  if (route === 'sam-detr-encoder') {
    add('layernorm1 layernorm2 layernorm3', b * s.spatialTokens);
    add('add-pos self-q self-k self-v self-attention-softmax self-output-linear self-output-residual cross-q cross-attention-softmax cross-output-linear cross-output-residual mlp-fc2-linear mlp-fc2-residual', b * s.spatialTokens * c);
    add('cross-k cross-v', b * s.promptTokens * c);
    add('mlp-fc1-relu', b * s.spatialTokens * s.mlpHidden);
  } else if (route === 'sam-detr-decoder') {
    add('sine-box-position', q * c * 2);
    add('ref-point-head-1 ref-point-head slice-query box-head-1 box-head-2', q * c);
    add('pad-query-position self-add-pos self-q self-k self-v self-attention-softmax self-output self-residual text-add-pos text-q text-attention-softmax text-output text-residual vision-add-pos vision-q vision-attention-softmax vision-output vision-residual mlp-fc2 mlp-residual', h * c);
    add('box-rpb-x-hidden', q * s.width * c);
    add('box-rpb-y-hidden', q * s.height * c);
    add('box-rpb', h * s.heads * s.spatialTokens);
    add('self-layernorm text-layernorm vision-layernorm mlp', h);
    add('text-k text-v', b * s.promptTokens * c);
    add('vision-key-add-pos vision-k vision-v', b * s.spatialTokens * c);
    add('mlp-fc1', h * s.mlpHidden);
    add('output-layernorm', q);
    add('box-head-3 box-refinement', q * 4);
    add('slice-presence', b * c);
    add('presence-layernorm', b);
    add('presence-head', b, 1);
  } else if (route === 'sam-pixel-decoder') {
    const level = s.levels[s.levels.length - 2 - index];
    add('upsample-add conv3x3 groupnorm-relu', b * level.height * level.width * c);
    add('groupnorm-stats', b * s.groups, 1);
  } else {
    add('mask-embedder-layer-0 mask-embedder-layer-1 mask-embedder-layer-2', b * s.maskTokens * c);
    add('instance-projection-1x1', b * c * s.height * s.width);
    add('decode-mask threshold-mask', b * s.maskTokens * s.height * s.width);
  }
  return result;
}

function checkProduction(route, source, shape, index = 0) {
  const run = source.slice(source.indexOf('export async function runSam3'));
  const bindings = { shape, index, layerIndex: index, input: { device: { limits: { maxComputeWorkgroupsPerDimension: 65535 } } } };
  const evaluate = code => new Function(...Object.keys(bindings), `return (${code});`)(...Object.values(bindings));
  for (const name of ['maskTailElementCount', 'maskElementCount', 'levelElementCount']) {
    const helper = source.match(new RegExp(`function ${name}\\([^]*?\\n}`));
    if (helper) bindings[name] = evaluate(helper[0]);
  }
  const names = {
    'sam-detr-encoder': ['totalEncoder', 'totalPrompt', 'spatialTokenCount', 'promptTokenCount', 'totalMlpHidden'],
    'sam-detr-decoder': ['hiddenTokens', 'queryTokens', 'spatialTokens', 'promptTokens', 'hiddenTotal', 'queryTotal', 'promptTotal', 'spatialTotal', 'mlpTotal', 'sineTotal', 'boxTotal', 'rpbTotal'],
    'sam-pixel-decoder': ['targetLevel', 'total'],
    'sam-mask-tail': ['spatial', 'maskTailTotal', 'maskTotal'],
  }[route];
  for (const name of names) {
    const declaration = run.match(new RegExp(`const ${name} = ([^;]+);`, 'g'));
    assert.ok(declaration?.length, `${route}: missing production ${name}`);
    // Pixel setup repeats the same declaration in allocation and phase loops.
    const expressions = [...new Set(declaration)];
    assert.equal(expressions.length, 1, `${route}: ambiguous production ${name}`);
    bindings[name] = evaluate(expressions[0].slice(`const ${name} = `.length, -1));
  }
  let logicalTotal;
  const helper = source.match(/function workgroups\([^]*?\n}/)[0];
  const workgroups = new Function('createLinearDispatch', `${helper}; return workgroups;`)(createLinearDispatch);
  bindings.workgroups = (total, device) => { logicalTotal = total; return workgroups(total, device); };
  const expected = expectedDomains(route, shape, index), observed = {};
  const phases = [...run.matchAll(/\{ name: (`[^`]+`|'[^']+'), kernel: [^\n]+?dispatch: (.+?), yieldAfter: true \}/g)];
  assert.equal(phases.length, [...run.matchAll(/dispatch:/g)].length, `${route}: every production dispatch must be inspected`);
  for (const [, nameExpression, dispatchExpression] of phases) {
    const fullName = evaluate(nameExpression);
    const name = route === 'sam-mask-tail' ? fullName : fullName.replace(/^(detr-encoder|detr-decoder|pixel)-/, '').replace(/-\d+$/, '');
    assert.ok(expected[name], `${route}: unknown phase ${fullName}`);
    assert.ok(!observed[name], `${route}: duplicate ${fullName}`);
    logicalTotal = undefined;
    const dispatch = [].concat(evaluate(dispatchExpression));
    const { total, size } = expected[name];
    assert.equal(size === 1 ? dispatch.reduce((a, b) => a * b, 1) : logicalTotal, total, `${fullName}: logical domain`);
    assert.deepEqual(dispatch, createLinearDispatch(total, { workgroupSize: size, maxWorkgroupsPerDimension: 65535 }), `${fullName}: grid`);
    const capacity = dispatch.reduce((a, b) => a * b, size);
    assert.ok(capacity >= total && capacity - total < size * (dispatch.length > 1 ? dispatch[0] : 1), `${fullName}: tail coverage`);
    observed[name] = true;
  }
  assert.deepEqual(Object.keys(observed).sort(), Object.keys(expected).sort(), `${route}: complete phase set`);
}

for (const route of ['sam-detr-encoder', 'sam-detr-decoder', 'sam-pixel-decoder', 'sam-mask-tail']) {
  const source = readFileSync(new URL(`../src/${route}-phase-program.js`, import.meta.url), 'utf8');
  for (const [height, width, batch] of [[16, 16, 1], [72, 72, 1], [9, 13, 2]]) {
    const shape = { batch, height, width, channels: 256, spatialTokens: height * width, queryTokens: 200, maskTokens: 200, promptTokens: 32, mlpHidden: 2048, heads: 8, groups: 32,
      levels: [4, 2, 1].map(scale => ({ height: height * scale, width: width * scale })) };
    if (route === 'sam-mask-tail') { shape.height *= 4; shape.width *= 4; }
    for (const index of route === 'sam-pixel-decoder' ? [0, 1] : [0, 5]) checkProduction(route, source, shape, index);
    if (route === 'sam-mask-tail') {
      const bad = source.replace("kernel: 'decodeMask', dispatch: workgroups(maskTotal, input.device)", "kernel: 'decodeMask', dispatch: workgroups(shape.batch, input.device)");
      assert.notEqual(bad, source);
      assert.throws(() => checkProduction(route, bad, shape), /decode-mask: logical domain/);
    }
    if (route === 'sam-detr-encoder') {
      const bad = source.replace('workgroups(totalMlpHidden, input.device)', 'workgroups(totalEncoder, input.device)');
      assert.notEqual(bad, source);
      assert.throws(() => checkProduction(route, bad, shape), /mlp-fc1-relu-0: logical domain/);
    }
  }
}
console.log('SAM named production dispatch domains and under-dispatch counterexamples passed');
