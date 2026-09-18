import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLinearDispatch } from '../src/runtime-primitives.js';
import {
  SAM_BIASED_ONLINE_ATTENTION_WGSL,
  SAM_DECODER_MASKED_ONLINE_ATTENTION_WGSL,
  SAM_MASKED_ONLINE_ATTENTION_WGSL,
  SAM_ONLINE_ATTENTION_WGSL,
  onlineAttentionDispatch,
} from '../src/sam-online-attention-wgsl.js';

const kernelTokens = {
  'sam-detr-encoder': 'layernorm1:LayerNorm1 add-pos:AddPos self-q:SelfQ self-k:SelfK self-v:SelfV self-attention-softmax:SelfAttention self-output-linear:SelfOutput self-output-residual:SelfResidual layernorm2:LayerNorm2 cross-q:CrossQ cross-k:CrossK cross-v:CrossV cross-attention-softmax:CrossAttention cross-output-linear:CrossOutput cross-output-residual:CrossResidual layernorm3:LayerNorm3 mlp-fc1-relu:MlpFc1Relu mlp-fc2-linear:MlpFc2 mlp-fc2-residual:MlpResidual',
  'sam-detr-decoder': 'sine-box-position:Sine ref-point-head-1:Ref1 ref-point-head:Ref2 pad-query-position:PadPos box-rpb-x-hidden:RpbXHidden box-rpb-y-hidden:RpbYHidden box-rpb:Rpb self-add-pos:AddPos self-q:SelfQ self-k:SelfK self-v:SelfV self-attention-softmax:SelfAttn self-output:SelfOut self-residual:SelfResidual self-layernorm:SelfNorm text-add-pos:TextAddPos text-q:TextQ text-k:TextK text-v:TextV text-attention-softmax:TextAttn text-output:TextOut text-residual:TextResidual text-layernorm:TextNorm vision-add-pos:VisionAddPos vision-q:VisionQ vision-key-add-pos:VisionKeyAdd vision-k:VisionK vision-v:VisionV vision-attention-softmax:VisionAttn vision-output:VisionOut vision-residual:VisionResidual vision-layernorm:VisionNorm mlp-fc1:Mlp1 mlp-fc2:Mlp2 mlp-residual:MlpResidual mlp:MlpNorm slice-query:SliceQuery output-layernorm:OutputNorm box-head-1:BoxHead1 box-head-2:BoxHead2 box-head-3:BoxHead3 box-refinement:BoxRefine slice-presence:SlicePresence presence-layernorm:PresenceNorm presence-head:PresenceHead',
  'sam-pixel-decoder': 'upsample-add:upsampleAdd conv3x3:conv3x3_ groupnorm-stats:groupnormStats groupnorm-relu:groupnormRelu',
  'sam-mask-tail': 'mask-embedder-layer-0:maskEmbedderLayer0 mask-embedder-layer-1:maskEmbedderLayer1 mask-embedder-layer-2:maskEmbedderLayer2 instance-projection-1x1:instanceProjection decode-mask:decodeMask threshold-mask:thresholdMask',
};

const shaderClasses = {
  'sam-detr-encoder': {
    LAYERNORM: 'LayerNorm1 LayerNorm2 LayerNorm3', ADD: 'AddPos SelfResidual CrossResidual MlpResidual',
    LINEAR: 'SelfQ SelfK SelfV SelfOutput CrossQ CrossK CrossV CrossOutput MlpFc2',
    LINEAR_RELU: 'MlpFc1Relu', SAM_ONLINE_ATTENTION: 'SelfAttention', SAM_MASKED_ONLINE_ATTENTION: 'CrossAttention',
  },
  'sam-detr-decoder': {
    LAYERNORM: 'SelfNorm TextNorm VisionNorm MlpNorm OutputNorm PresenceNorm',
    ADD: 'AddPos SelfResidual TextAddPos TextResidual VisionAddPos VisionKeyAdd VisionResidual MlpResidual',
    LINEAR: 'Ref2 SelfQ SelfK SelfV SelfOut TextQ TextK TextV TextOut VisionQ VisionK VisionV VisionOut Mlp2 BoxHead3',
    LINEAR_RELU: 'Ref1 Mlp1 BoxHead1 BoxHead2', SAM_DECODER_MASKED_ONLINE_ATTENTION: 'SelfAttn TextAttn', SAM_BIASED_ONLINE_ATTENTION: 'VisionAttn',
    SINE_BOX: 'Sine', PAD_QUERY_POS: 'PadPos', RPB_AXIS_HIDDEN: 'RpbXHidden RpbYHidden', RPB_COMBINE: 'Rpb',
    SLICE_QUERIES: 'SliceQuery', BOX_APPLY: 'BoxRefine', SLICE_PRESENCE: 'SlicePresence', PRESENCE_HEAD: 'PresenceHead',
  },
  'sam-pixel-decoder': { UPSAMPLE_ADD: 'upsampleAdd', CONV3X3: 'conv3x3_', GROUPNORM_STATS: 'groupnormStats', GROUPNORM_RELU: 'groupnormRelu' },
  'sam-mask-tail': { LINEAR_RELU: 'maskEmbedderLayer0 maskEmbedderLayer1', LINEAR: 'maskEmbedderLayer2', INSTANCE_PROJECTION: 'instanceProjection', MASK_PROJECTION: 'decodeMask', THRESHOLD: 'thresholdMask' },
};

function expectedDomains(route, s, index) {
  const result = {};
  const add = (names, total, size = 64, dispatch = undefined) => {
    for (const name of names.split(' ')) result[name] = { total, size, dispatch };
  };
  const b = s.batch, c = s.channels, q = b * s.queryTokens, h = b * (s.queryTokens + 1);
  if (route === 'sam-detr-encoder') {
    add('layernorm1 layernorm2 layernorm3', b * s.spatialTokens);
    add('add-pos self-q self-k self-v self-output-linear self-output-residual cross-q cross-output-linear cross-output-residual mlp-fc2-linear mlp-fc2-residual', b * s.spatialTokens * c);
    add('self-attention-softmax cross-attention-softmax', b * s.spatialTokens * c, 64, [s.spatialTokens, s.heads, b]);
    add('cross-k cross-v', b * s.promptTokens * c);
    add('mlp-fc1-relu', b * s.spatialTokens * s.mlpHidden);
  } else if (route === 'sam-detr-decoder') {
    add('sine-box-position', q * c * 2);
    add('ref-point-head-1 ref-point-head slice-query box-head-1 box-head-2', q * c);
    add('pad-query-position self-add-pos self-q self-k self-v self-output self-residual text-add-pos text-q text-output text-residual vision-add-pos vision-q vision-output vision-residual mlp-fc2 mlp-residual', h * c);
    add('self-attention-softmax text-attention-softmax vision-attention-softmax', h * c, 64, [s.queryTokens + 1, s.heads, b]);
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
  if (route === 'sam-detr-encoder') bindings.kernelBase = evaluate(run.match(/const kernelBase = ([^;]+);/)[1]);
  if (route === 'sam-detr-decoder') bindings.k = evaluate(run.match(/const k = ([^;]+);/)[1]);
  const shaders = {
    SAM_ONLINE_ATTENTION_WGSL,
    SAM_MASKED_ONLINE_ATTENTION_WGSL,
    SAM_DECODER_MASKED_ONLINE_ATTENTION_WGSL,
    SAM_BIASED_ONLINE_ATTENTION_WGSL,
  };
  for (const [, name, expression] of source.matchAll(/const (\w+_WGSL) = (`[^]*?`|\w+_WGSL\.replace\([^\n]+\));/g)) {
    shaders[name] = new Function(...Object.keys(shaders), `return ${expression};`)(...Object.values(shaders));
  }
  const registeredShaders = {};
  const registrations = route === 'sam-detr-encoder' ? /addLinearKernel\('([^']+)', (\w+_WGSL),/g
    : route === 'sam-detr-decoder' ? /addKernel\((k\('[^']+'\)), (\w+_WGSL),/g
      : route === 'sam-pixel-decoder' ? /kernels\[(`[^`]+`)\] = \{ code: (\w+_WGSL),/g
        : /\b(\w+): \{ code: (\w+_WGSL),/g;
  for (const [, expression, shader] of run.matchAll(registrations)) {
    const kernel = route === 'sam-detr-encoder' ? `${bindings.kernelBase}${expression}`
      : route === 'sam-mask-tail' ? expression : evaluate(expression);
    assert.ok(!registeredShaders[kernel], `${route}: duplicate kernel ${kernel}`);
    assert.ok(shaders[shader], `${kernel}: missing shader ${shader}`);
    registeredShaders[kernel] = { shaderName: shader, code: shaders[shader] };
  }
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
  bindings.onlineAttentionDispatch = onlineAttentionDispatch;
  const expected = expectedDomains(route, shape, index), observed = {};
  const tokens = Object.fromEntries(kernelTokens[route].split(' ').map(pair => pair.split(':')));
  const expectedShaders = Object.fromEntries(Object.entries(shaderClasses[route]).flatMap(([shader, kernels]) => kernels.split(' ').map(kernel => [kernel, `${shader}_WGSL`])));
  assert.deepEqual(Object.keys(expectedShaders).sort(), Object.values(tokens).sort(), `${route}: shader/domain coverage`);
  assert.deepEqual(Object.keys(tokens).sort(), Object.keys(expected).sort(), `${route}: kernel/domain coverage`);
  const phases = [...run.matchAll(/\{ name: (`[^`]+`|'[^']+'), kernel: (.+?), dispatch: (.+?), yieldAfter: true \}/g)];
  assert.equal(phases.length, [...run.matchAll(/dispatch:/g)].length, `${route}: every production dispatch must be inspected`);
  for (const [, nameExpression, kernelExpression, dispatchExpression] of phases) {
    const fullName = evaluate(nameExpression);
    const name = route === 'sam-mask-tail' ? fullName : fullName.replace(/^(detr-encoder|detr-decoder|pixel)-/, '').replace(/-\d+$/, '');
    assert.ok(expected[name], `${route}: unknown phase ${fullName}`);
    assert.ok(!observed[name], `${route}: duplicate ${fullName}`);
    const prefix = route === 'sam-pixel-decoder' ? 'pixel' : route.slice(4);
    assert.equal(fullName, route === 'sam-mask-tail' ? name : `${prefix}-${name}-${index}`, `${fullName}: phase identity`);
    const kernel = evaluate(kernelExpression);
    const expectedKernel = route.startsWith('sam-detr-') ? `layer${index}${tokens[name]}`
      : route === 'sam-pixel-decoder' ? `${tokens[name]}${index}` : tokens[name];
    assert.equal(kernel, expectedKernel, `${fullName}: kernel identity`);
    assert.equal(registeredShaders[kernel]?.shaderName, expectedShaders[tokens[name]], `${kernel}: registered shader identity`);
    const workgroup = registeredShaders[kernel]?.code.match(/@workgroup_size\((\d+)\)/);
    assert.ok(workgroup, `${kernel}: registered workgroup size`);
    assert.equal(Number(workgroup[1]), expected[name].size, `${kernel}: workgroup class`);
    logicalTotal = undefined;
    const dispatch = [].concat(evaluate(dispatchExpression));
    const { total, size, dispatch: nativeDispatch } = expected[name];
    if (nativeDispatch) {
      assert.deepEqual(dispatch, nativeDispatch, `${fullName}: native query/head/batch grid`);
      assert.equal(dispatch[0] * dispatch[1] * dispatch[2] * (shape.channels / shape.heads), total, `${fullName}: logical output domain`);
    } else {
      assert.equal(size === 1 ? dispatch.reduce((a, b) => a * b, 1) : logicalTotal, total, `${fullName}: logical domain`);
      assert.deepEqual(dispatch, createLinearDispatch(total, { workgroupSize: size, maxWorkgroupsPerDimension: 65535 }), `${fullName}: grid`);
      const capacity = dispatch.reduce((a, b) => a * b, size);
      assert.ok(capacity >= total && capacity - total < size * (dispatch.length > 1 ? dispatch[0] : 1), `${fullName}: tail coverage`);
    }
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
      const swapped = source
        .replace('name: `detr-encoder-layernorm1-${layerIndex}`, kernel: `${kernelBase}LayerNorm1`, dispatch: workgroups(spatialTokenCount, input.device)', 'name: `detr-encoder-add-pos-${layerIndex}`, kernel: `${kernelBase}LayerNorm1`, dispatch: workgroups(totalEncoder, input.device)')
        .replace('name: `detr-encoder-add-pos-${layerIndex}`, kernel: `${kernelBase}AddPos`, dispatch: workgroups(totalEncoder, input.device)', 'name: `detr-encoder-layernorm1-${layerIndex}`, kernel: `${kernelBase}AddPos`, dispatch: workgroups(spatialTokenCount, input.device)');
      assert.notEqual(swapped, source);
      assert.throws(() => checkProduction(route, swapped, shape), /kernel identity/);
      const swappedRegistrations = source
        .replace("addLinearKernel('LayerNorm1', LAYERNORM_WGSL", "addLinearKernel('AddPos', LAYERNORM_WGSL")
        .replace("addLinearKernel('AddPos', ADD_WGSL", "addLinearKernel('LayerNorm1', ADD_WGSL");
      assert.notEqual(swappedRegistrations, source);
      assert.throws(() => checkProduction(route, swappedRegistrations, shape), /registered shader identity/);
      const wrongIndex = source.replace('detr-encoder-layernorm1-${layerIndex}', 'detr-encoder-layernorm1-99');
      assert.throws(() => checkProduction(route, wrongIndex, shape), /phase identity/);
      const wrongWorkgroup = source.replace('@workgroup_size(64)', '@workgroup_size(1)');
      assert.throws(() => checkProduction(route, wrongWorkgroup, shape), /workgroup class/);
      const bad = source.replace('workgroups(totalMlpHidden, input.device)', 'workgroups(totalEncoder, input.device)');
      assert.notEqual(bad, source);
      assert.throws(() => checkProduction(route, bad, shape), /mlp-fc1-relu-0: logical domain/);
    }
  }
}
console.log('SAM named production dispatch domains and under-dispatch counterexamples passed');
