import assert from 'node:assert/strict';

const WGSL_BUILTINS = new Set([
  'abs',
  'acos',
  'all',
  'any',
  'array',
  'atomicAdd',
  'atomicLoad',
  'atomicMax',
  'atomicMin',
  'atomicStore',
  'bitcast',
  'ceil',
  'clamp',
  'cosh',
  'cross',
  'dot',
  'exp',
  'exp2',
  'f32',
  'floor',
  'fract',
  'i32',
  'inverseSqrt',
  'length',
  'log',
  'log2',
  'max',
  'min',
  'mix',
  'normalize',
  'pow',
  'reflect',
  'select',
  'sign',
  'sinh',
  'smoothstep',
  'sqrt',
  'step',
  'storageBarrier',
  'tanh',
  'textureLoad',
  'textureSampleLevel',
  'textureStore',
  'transpose',
  'trunc',
  'u32',
  'vec2',
  'vec3',
  'vec4',
  'workgroupBarrier',
]);

const WGSL_CONTROL_FLOW = new Set([
  'for',
  'if',
  'loop',
  'switch',
  'while',
]);

const TEMPORAL_TOKEN = /\b(?:time|frame|canonicalPhaseTime)\b|\b[A-Za-z_]\w*_(?:time|frame)\b/i;
const PERIODIC_CALL = /\b(?:sin|cos|tan)\s*\(/;

function wgslFunction(source, name) {
  const start = source.indexOf(`fn ${name}(`);
  assert.notEqual(start, -1, `missing WGSL function ${name}`);
  const open = source.indexOf('{', start);
  assert.notEqual(open, -1, `missing WGSL body for ${name}`);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) {
        return {
          signature: source.slice(start, open),
          body: source.slice(open + 1, index),
        };
      }
    }
  }
  throw new Error(`unterminated WGSL body for ${name}`);
}

function functionCallees(body) {
  return [...body.matchAll(/\b([A-Za-z_]\w*)\s*(?:<[^>{};\n]+>)?\s*\(/g)]
    .map(match => match[1]);
}

export function assertTimeFreeWgslCallGraph(
  source,
  roots,
  { label = 'WGSL call graph', forbiddenCallees = [] } = {},
) {
  const visited = new Set();
  const active = new Set();
  const forbidden = new Set(forbiddenCallees);

  function visit(name, path) {
    if (WGSL_BUILTINS.has(name) || WGSL_CONTROL_FLOW.has(name) || visited.has(name)) return;
    assert.equal(active.has(name), false, `${label} contains a recursive helper cycle: ${[...path, name].join(' -> ')}`);
    active.add(name);
    const fn = wgslFunction(source, name);
    assert.doesNotMatch(fn.signature, TEMPORAL_TOKEN, `${label} helper ${name} must not accept temporal authority`);
    assert.doesNotMatch(fn.body, TEMPORAL_TOKEN, `${label} helper ${name} must not read temporal globals or tokens`);
    assert.doesNotMatch(fn.body, PERIODIC_CALL, `${label} helper ${name} must not introduce explicit periodic behavior`);
    for (const callee of functionCallees(fn.body)) {
      assert.equal(
        forbidden.has(callee),
        false,
        `${label} helper ${name} must not call forbidden helper ${callee}`,
      );
      if (!WGSL_BUILTINS.has(callee) && !WGSL_CONTROL_FLOW.has(callee)) visit(callee, [...path, name]);
    }
    active.delete(name);
    visited.add(name);
  }

  for (const root of roots) visit(root, []);
  return Object.freeze([...visited].sort());
}
