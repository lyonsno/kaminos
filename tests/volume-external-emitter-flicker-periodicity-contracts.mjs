import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertTimeFreeWgslCallGraph } from './helpers/wgsl-time-free-callgraph.mjs';
import { balancedWgslBlock, wgslCallCount } from './helpers/wgsl-guard-ownership.mjs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');

function normalizeWgslStatement(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function assertExternalEmitterFlickerRetired(source) {
  const influence = balancedWgslBlock(source, 'fn externalEmitterInfluence(', {
    label: 'generic external-emitter influence',
  });
  const injection = balancedWgslBlock(source, 'fn applyExternalEmitterInjection(', {
    label: 'generic external-emitter injection wrapper',
  });
  assertTimeFreeWgslCallGraph(
    source,
    ['externalEmitterInfluence'],
    {
      label: 'generic external-emitter influence graph',
      forbiddenCallees: ['hash31'],
    },
  );
  assert.doesNotMatch(
    influence,
    /\b(?:flicker|jitter|pulse|oscillat|random)\w*\b/i,
    'generic external emitters must not retain hidden modulation vocabulary',
  );
  assert.match(
    influence,
    /let strength = max\(0\.0, emitter\.end_strength\.w\);[\s\S]*?let falloff = exp\([\s\S]*?\* strength\s*\* ageFade\s*\* isActiveEmitter\s*;\s*let w = falloff;/,
    'generic external emitters must apply authored strength through spatial and lifetime falloff without hidden attenuation',
  );
  const directCarrierStart = influence.indexOf('let w = falloff;');
  assert.notEqual(directCarrierStart, -1, 'generic external-emitter direct carrier marker must remain discoverable');
  const directCarrierTail = influence.slice(directCarrierStart);
  const actualAccumulations = [...directCarrierTail.matchAll(
    /\b(result\.(?:material|fire|micro|velocity)(?:\.[xyzw])?)\s*(\+=|-=|\*=|\/=|=)\s*([^;]+);/g,
  )].map(match => normalizeWgslStatement(`${match[1]} ${match[2]} ${match[3]};`));
  const expectedAccumulations = [
    'result.material.x = max(result.material.x, emitter.material.x * w);',
    'result.material.y = max(result.material.y, emitter.material.y * w);',
    'result.material.z = max(result.material.z, emitter.material.z * w);',
    'result.material.w = max(result.material.w, emitter.detail_lifetime.x * w);',
    'result.fire.x = max(result.fire.x, emitter.material.w * w);',
    'result.fire.y = max(result.fire.y, emitter.material.w * w * 0.42);',
    'result.fire.z = max(result.fire.z, emitter.detail_lifetime.x * w * 0.82);',
    'result.micro.x = max(result.micro.x, emitter.detail_lifetime.x * w * 0.72);',
    'result.micro.y = max(result.micro.y, emitter.detail_lifetime.x * w * 0.42 + emitter.material.w * w * 0.12);',
    'result.micro.z = max(result.micro.z, emitter.material.w * w * 0.60);',
    'result.micro.w = max(result.micro.w, emitter.material.w * w * 0.22);',
    'result.velocity = result.velocity + vec4<f32>(emitter.velocity_age.xyz * w, w);',
  ].map(normalizeWgslStatement);
  assert.deepEqual(
    actualAccumulations,
    expectedAccumulations,
    'every external-emitter accumulation must consume direct unattenuated w',
  );
  assert.doesNotMatch(
    directCarrierTail,
    /\b(?:let|var)\s+[A-Za-z_]\w*(?:\s*:\s*[A-Za-z_]\w*(?:\s*<[^;=]+>)?)?\s*=\s*result\s*;/,
    'the returned external-emitter carrier must not escape through a mutable result alias',
  );
  assert.doesNotMatch(
    directCarrierTail,
    /\bresult\s*(?:=|\+=|-=|\*=|\/=)/,
    'the returned external-emitter carrier must not be replaced after direct accumulation',
  );
  assert.match(
    directCarrierTail,
    /\breturn\s+result\s*;\s*}$/,
    'the external-emitter influence must return the enumerated result directly',
  );
  assert.match(
    injection,
    /^fn applyExternalEmitterInjection\(influence: ExternalEmitterInfluence\) -> ExternalEmitterInfluence \{\s*return influence;\s*\}$/,
    'the external-emitter injection wrapper must preserve the influence without hidden post-attenuation',
  );
  assert.equal(
    wgslCallCount(source, 'externalEmitterInfluence'),
    1,
    'the main fluid kernel must own exactly one generic external-emitter influence evaluation',
  );
  assert.match(
    source,
    /applyExternalEmitterInjection\(externalEmitterInfluence\(p\)\)/,
    'the main fluid kernel must not pass a clock into generic external-emitter influence',
  );
  assert.match(
    source,
    /const MAIN_FLUID_EXTERNAL_CARRIER_HIDDEN_FLICKER_STRATEGY_RETIRED = 'retired-hidden-external-emitter-flicker-v0';/,
    'the structural ledger must name hidden external-carrier flicker retirement',
  );
  assert.match(
    source,
    /const externalCarrierHiddenFlickerEvaluationsPerEmitterCell = 0;/,
    'the cost ledger must report zero hidden flicker evaluations per external-emitter cell',
  );
  for (const projection of [
    /state\.mainFluidExternalCarrierHiddenFlickerStrategy = mainFluidExternalCarrierHiddenFlickerStrategy;/,
    /state\.externalCarrierHiddenFlickerEvaluationsPerEmitterCell = externalCarrierHiddenFlickerEvaluationsPerEmitterCell;/,
    /mainFluidExternalCarrierHiddenFlickerStrategy: state\.mainFluidExternalCarrierHiddenFlickerStrategy/,
    /externalCarrierHiddenFlickerEvaluationsPerEmitterCell: state\.externalCarrierHiddenFlickerEvaluationsPerEmitterCell/,
  ]) {
    assert.match(source, projection, 'public runtime/debug receipts must preserve the hidden-flicker retirement ledger');
  }
  const publicEvaluationProjections = [...source.matchAll(
    /externalCarrierHiddenFlickerEvaluationsPerEmitterCell:\s*([^,\n}]+)/g,
  )].map(match => match[1].trim());
  assert.deepEqual(
    publicEvaluationProjections,
    [
      'state.externalCarrierHiddenFlickerEvaluationsPerEmitterCell',
      'state.externalCarrierHiddenFlickerEvaluationsPerEmitterCell',
    ],
    'both public projections must independently preserve the authoritative zero-work state',
  );
}

const failFirst = [];
try {
  assertExternalEmitterFlickerRetired(core);
} catch (error) {
  failFirst.push(error.message);
}
assert.deepEqual(
  failFirst,
  [],
  `generic external-emitter hidden flicker remains active: ${failFirst.join(' | ')}`,
);

const falseClosureMutations = [
  [
    'restored direct time-hash flicker',
    source => source
      .replace('fn externalEmitterInfluence(p: vec3<f32>)', 'fn externalEmitterInfluence(p: vec3<f32>, time: f32)')
      .replace('    let w = falloff;', '    let flicker = 0.82 + 0.18 * hash31(vec3<f32>(f32(i), time, t));\n    let w = falloff * flicker;')
      .replace('externalEmitterInfluence(p))', 'externalEmitterInfluence(p, time))'),
    /helper externalEmitterInfluence must not accept temporal authority/,
  ],
  [
    'helper-hidden time modulation',
    source => source
      .replace(
        'fn externalEmitterInfluence(',
        'fn hiddenExternalCarrierGain(i: u32, t: f32) -> f32 { return 0.82 + 0.18 * fract(u.cameraPos_time.w + f32(i) + t); }\n\nfn externalEmitterInfluence(',
      )
      .replace('    let w = falloff;', '    let w = falloff * hiddenExternalCarrierGain(i, t);'),
    /helper hiddenExternalCarrierGain must not read temporal globals or tokens/,
  ],
  [
    'helper-hidden spatial hash attenuation',
    source => source
      .replace(
        'fn externalEmitterInfluence(',
        'fn hiddenExternalCarrierGain(i: u32, t: f32) -> f32 { return 0.82 + 0.18 * hash31(vec3<f32>(f32(i), t, 0.0)); }\n\nfn externalEmitterInfluence(',
      )
      .replace('    let w = falloff;', '    let w = falloff * hiddenExternalCarrierGain(i, t);'),
    /helper hiddenExternalCarrierGain must not call forbidden helper hash31/,
  ],
  [
    'constant authored-strength attenuation',
    source => source.replace('    let w = falloff;', '    let w = falloff * 0.82;'),
    /must apply authored strength through spatial and lifetime falloff without hidden attenuation/,
  ],
  [
    'post-falloff carrier alias attenuation',
    source => source
      .replace('    let w = falloff;', '    let w = falloff;\n    let carrierWeight = w * 0.82;')
      .replaceAll(' * w', ' * carrierWeight')
      .replace('emitter.velocity_age.xyz * carrierWeight, w)', 'emitter.velocity_age.xyz * carrierWeight, carrierWeight)'),
    /every external-emitter accumulation must consume direct unattenuated w/,
  ],
  [
    'compound post-accumulation attenuation',
    source => source.replace(
      `    result.velocity = result.velocity + vec4<f32>(emitter.velocity_age.xyz * w, w);
  }
  return result;`,
      `    result.velocity = result.velocity + vec4<f32>(emitter.velocity_age.xyz * w, w);
  }
  result.material *= 0.82;
  result.fire *= 0.82;
  result.micro *= 0.82;
  result.velocity *= 0.82;
  return result;`,
    ),
    /every external-emitter accumulation must consume direct unattenuated w/,
  ],
  [
    'mutable returned-result alias attenuation',
    source => source.replace(
      `    result.velocity = result.velocity + vec4<f32>(emitter.velocity_age.xyz * w, w);
  }
  return result;`,
      `    result.velocity = result.velocity + vec4<f32>(emitter.velocity_age.xyz * w, w);
  }
  var returnedCarrier = result;
  returnedCarrier.material *= 0.82;
  return returnedCarrier;`,
    ),
    /returned external-emitter carrier must not escape through a mutable result alias/,
  ],
  [
    'helper-mediated return attenuation',
    source => source
      .replace(
        'fn externalEmitterInfluence(',
        'fn attenuateReturnedCarrier(value: ExternalEmitterInfluence) -> ExternalEmitterInfluence { var scaled = value; scaled.material *= 0.82; return scaled; }\n\nfn externalEmitterInfluence(',
      )
      .replace(
        `    result.velocity = result.velocity + vec4<f32>(emitter.velocity_age.xyz * w, w);
  }
  return result;`,
        `    result.velocity = result.velocity + vec4<f32>(emitter.velocity_age.xyz * w, w);
  }
  return attenuateReturnedCarrier(result);`,
      ),
    /influence must return the enumerated result directly/,
  ],
  [
    'helper-copy-back return attenuation',
    source => source
      .replace(
        'fn externalEmitterInfluence(',
        'fn attenuateReturnedCarrier(value: ExternalEmitterInfluence) -> ExternalEmitterInfluence { var scaled = value; scaled.material *= 0.82; return scaled; }\n\nfn externalEmitterInfluence(',
      )
      .replace(
        `    result.velocity = result.velocity + vec4<f32>(emitter.velocity_age.xyz * w, w);
  }
  return result;`,
        `    result.velocity = result.velocity + vec4<f32>(emitter.velocity_age.xyz * w, w);
  }
  result = attenuateReturnedCarrier(result);
  return result;`,
      ),
    /returned external-emitter carrier must not be replaced after direct accumulation/,
  ],
  [
    'typed mutable alias copy-back attenuation',
    source => source.replace(
      `    result.velocity = result.velocity + vec4<f32>(emitter.velocity_age.xyz * w, w);
  }
  return result;`,
      `    result.velocity = result.velocity + vec4<f32>(emitter.velocity_age.xyz * w, w);
  }
  var returnedCarrier: ExternalEmitterInfluence = result;
  returnedCarrier.material *= 0.82;
  result = returnedCarrier;
  return result;`,
    ),
    /returned external-emitter carrier must not escape through a mutable result alias/,
  ],
  [
    'pre-falloff authored-strength attenuation',
    source => source.replace(
      'let strength = max(0.0, emitter.end_strength.w);',
      'let strength = max(0.0, emitter.end_strength.w) * 0.82;',
    ),
    /must apply authored strength through spatial and lifetime falloff without hidden attenuation/,
  ],
  [
    'post-influence wrapper attenuation',
    source => source.replace(
      `fn applyExternalEmitterInjection(influence: ExternalEmitterInfluence) -> ExternalEmitterInfluence {
  return influence;
}`,
      `fn applyExternalEmitterInjection(influence: ExternalEmitterInfluence) -> ExternalEmitterInfluence {
  var attenuated = influence;
  attenuated.material = attenuated.material * 0.82;
  attenuated.fire = attenuated.fire * 0.82;
  attenuated.micro = attenuated.micro * 0.82;
  attenuated.velocity = attenuated.velocity * 0.82;
  return attenuated;
}`,
    ),
    /injection wrapper must preserve the influence without hidden post-attenuation/,
  ],
  [
    'restored hidden flicker cost',
    source => source.replace(
      'const externalCarrierHiddenFlickerEvaluationsPerEmitterCell = 0;',
      'const externalCarrierHiddenFlickerEvaluationsPerEmitterCell = 1;',
    ),
    /cost ledger must report zero hidden flicker evaluations per external-emitter cell/,
  ],
  [
    'first public zero-work projection drift',
    source => source.replace(
      'externalCarrierHiddenFlickerEvaluationsPerEmitterCell: state.externalCarrierHiddenFlickerEvaluationsPerEmitterCell,',
      'externalCarrierHiddenFlickerEvaluationsPerEmitterCell: 1,',
    ),
    /both public projections must independently preserve the authoritative zero-work state/,
  ],
  [
    'second public zero-work projection drift',
    source => {
      const needle = 'externalCarrierHiddenFlickerEvaluationsPerEmitterCell: state.externalCarrierHiddenFlickerEvaluationsPerEmitterCell,';
      const first = source.indexOf(needle);
      const second = source.indexOf(needle, first + needle.length);
      assert.ok(second > first, 'second public projection mutation requires two live projections');
      return `${source.slice(0, second)}externalCarrierHiddenFlickerEvaluationsPerEmitterCell: 1,${source.slice(second + needle.length)}`;
    },
    /both public projections must independently preserve the authoritative zero-work state/,
  ],
];

const acceptedFalseClosures = [];
for (const [name, mutate, expectedFailure] of falseClosureMutations) {
  const mutated = mutate(core);
  assert.notEqual(mutated, core, `${name} mutation must alter the reviewed source`);
  try {
    assertExternalEmitterFlickerRetired(mutated);
    acceptedFalseClosures.push(name);
  } catch (error) {
    assert.match(error.message, expectedFailure, `${name} must fail on its intended boundary`);
  }
}
assert.deepEqual(acceptedFalseClosures, [], 'the external-emitter boundary must reject every false-closure mutation');

const switchFixture = `
fn carrierLeaf(value: f32) -> f32 { return value; }
fn carrierRoot(value: u32) -> f32 {
  switch(value) {
    case 0u: { return carrierLeaf(0.0); }
    default: { return carrierLeaf(1.0); }
  }
}`;
assert.deepEqual(
  assertTimeFreeWgslCallGraph(switchFixture, ['carrierRoot']),
  ['carrierLeaf', 'carrierRoot'],
  'WGSL switch syntax is ignored while real callees remain under recursive authority',
);
const temporalSwitchFixture = switchFixture.replace(
  'fn carrierLeaf(value: f32) -> f32 { return value; }',
  'fn carrierLeaf(value: f32) -> f32 { return value + u.cameraPos_time.w; }',
);
assert.throws(
  () => assertTimeFreeWgslCallGraph(temporalSwitchFixture, ['carrierRoot']),
  /helper carrierLeaf must not read temporal globals or tokens/,
  'switch handling cannot hide temporal authority inside a real reachable helper',
);

console.log('volume external emitter carrier: hidden time/hash flicker retired and authored strength preserved');
