#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as volumeCore from '../volume-core.js';
import { balancedWgslBlock } from './helpers/wgsl-guard-ownership.mjs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const cockpit = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const witness = readFileSync(new URL('../volume-witness.mjs', import.meta.url), 'utf8');

function resolveIntegerExpression(expression, aliases) {
  let expanded = expression.trim();
  for (let pass = 0; pass < 8; pass += 1) {
    const next = expanded.replace(/\b[A-Za-z_]\w*\b/g, name => (
      aliases.has(name) ? `(${aliases.get(name)})` : name
    ));
    if (next === expanded) break;
    expanded = next;
  }
  if (!/^[0-9+\-*/()\s]+$/.test(expanded)) return null;
  const value = Function(`"use strict"; return (${expanded});`)();
  return Number.isInteger(value) ? value : null;
}

function resolveSimpleIdentifierAlias(expression) {
  let candidate = expression
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .trim();
  while (candidate.startsWith('(') && candidate.endsWith(')')) {
    let depth = 0;
    let outerPairClosesAtEnd = false;
    for (let index = 0; index < candidate.length; index += 1) {
      if (candidate[index] === '(') depth += 1;
      if (candidate[index] === ')') depth -= 1;
      if (depth === 0) {
        outerPairClosesAtEnd = index === candidate.length - 1;
        break;
      }
    }
    if (!outerPairClosesAtEnd) break;
    candidate = candidate.slice(1, -1).trim();
  }
  return /^[A-Za-z_]\w*$/.test(candidate) ? candidate : null;
}

function assertCanonicalRetiredPackedComponent(source) {
  const updateUniforms = balancedWgslBlock(source, 'function updateUniforms(now)', {
    label: 'updateUniforms',
  });
  const aliases = new Map(
    [...updateUniforms.matchAll(/\b(?:const|let|var)\s+([A-Za-z_]\w*)\s*=\s*([^;]+);/g)]
      .map(match => [match[1], match[2]]),
  );
  const uniformBases = new Set(['uniforms']);
  for (let pass = 0; pass < 8; pass += 1) {
    let changed = false;
    for (const [name, expression] of aliases) {
      const base = resolveSimpleIdentifierAlias(expression);
      if (base && uniformBases.has(base) && !uniformBases.has(name)) {
        uniformBases.add(name);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const retiredWrites = [...updateUniforms.matchAll(/\b([A-Za-z_]\w*)\s*\[([^\]]+)\]\s*(?:\+=|-=|\*=|\/=|=)\s*([^;]+);/g)]
    .filter(match => uniformBases.has(match[1]))
    .map(match => ({ index: resolveIntegerExpression(match[2], aliases), value: match[3].trim() }))
    .filter(write => write.index === 73);
  assert.equal(retiredWrites.length, 1, 'retired Canonical packed component must have exactly one CPU write');
  assert.equal(
    retiredWrites[0].value,
    'CANONICAL_ANALYTIC_MOTION_RETIRED_UNIFORM_VALUE',
    'the sole retired Canonical packed-component write must use the zero-authority constant',
  );

  const accesses = [...source.matchAll(/canonical_render_motion_controls\s*(\.[A-Za-z]+|\[[^\]]+\])/g)]
    .map(match => match[1].replace(/\s+/g, ''));
  const packedControlTokenCount = [...source.matchAll(/\bcanonical_render_motion_controls\b/g)].length;
  assert.ok(accesses.length > 0, 'Canonical packed control consumers must remain discoverable');
  assert.equal(
    packedControlTokenCount,
    accesses.length + 1,
    'Canonical packed controls may appear bare only in their one ABI declaration',
  );
  for (const access of accesses) {
    assert.ok(
      ['.x', '.z', '.w'].includes(access),
      `retired Canonical packed component cannot be consumed through ${access}`,
    );
  }
}

assert.equal(
  volumeCore.CANONICAL_ANALYTIC_MOTION_RETIREMENT_IDENTITY,
  'retired-analytic-canonical-motion-v0',
  'the removed Canonical analytic motion clock has one stable retirement identity',
);
assert.equal(
  typeof volumeCore.canonicalMotionCompatibilityReceipt,
  'function',
  'legacy animated/frozen requests resolve through an explicit compatibility receipt',
);
assert.equal(
  typeof volumeCore.canonicalSourceControlSignature,
  'function',
  'Canonical source reset authority is independently testable',
);

for (const requested of ['animated', 'frozen', 'garbage']) {
  const receipt = volumeCore.canonicalMotionCompatibilityReceipt(requested);
  assert.equal(receipt.identity, 'retired-analytic-canonical-motion-v0');
  assert.equal(receipt.effective, 'retired');
  assert.equal(receipt.uniformValue, 0);
  assert.equal(receipt.requested, requested === 'frozen' ? 'frozen' : 'animated');
}

const signatureControls = {
  volumeScene: 'canonical_plume',
  inputRadius: 0.08,
  flowRate: 1.9,
  canonicalSourceMode: 'buoyant_bottom',
  canonicalContentMode: 'smoke',
  canonicalSourceY: -0.82,
  canonicalSourceInjection: 0,
  canonicalBuoyancy: 1,
};
assert.equal(
  volumeCore.canonicalSourceControlSignature({ ...signatureControls, canonicalMotionMode: 'animated' }),
  volumeCore.canonicalSourceControlSignature({ ...signatureControls, canonicalMotionMode: 'frozen' }),
  'legacy Canonical motion requests cannot reset transported fluid state',
);

assert.doesNotMatch(
  core.match(/export function canonicalSourceControlSignature[\s\S]*?^}/m)?.[0] || '',
  /canonicalMotionMode|normalizeCanonicalMotionMode/,
  'Canonical source reset authority excludes the retired motion request',
);
assert.match(
  core,
  /uniforms\[73\]\s*=\s*CANONICAL_ANALYTIC_MOTION_RETIRED_UNIFORM_VALUE\s*;/,
  'the former motion uniform slot remains reserved at an explicit zero value',
);
assertCanonicalRetiredPackedComponent(core);
assert.match(
  core,
  /motionRetirementIdentity:\s*canonicalMotionReceipt\.identity/,
  'runtime debug state reports the retirement identity',
);
assert.match(
  core,
  /requestedRetiredMotionMode:\s*canonicalMotionReceipt\.requested/,
  'runtime debug state labels the legacy value as a request, not effective motion',
);
assert.doesNotMatch(
  core,
  /\bmotionMode:\s*normalizeCanonicalMotionMode/,
  'runtime debug state cannot echo a legacy request as effective motion',
);

assert.match(
  cockpit,
  /volume-canonical-motion-mode-state">retired</,
  'the operator readout defaults to the honest retired state',
);
assert.match(
  cockpit,
  /motionStrategy\s*\|\|\s*'retired'/,
  'the operator readout consumes the retirement receipt rather than animated/frozen',
);
assert.doesNotMatch(
  cockpit,
  /volume-canonical-motion-mode-state'\)\.textContent\s*=\s*[^;]*motionMode/,
  'the operator readout cannot present the legacy request as effective motion',
);

assert.match(
  witness,
  /expectedCanonicalMotionRetirementIdentity/,
  'the live witness names the Canonical motion retirement contract',
);
assert.match(
  witness,
  /requestedRetiredMotionMode/,
  'the live witness verifies legacy request custody separately from effective state',
);
assert.doesNotMatch(
  witness,
  /canonicalPlumeControls\?\.motionMode/,
  'the witness cannot certify animated/frozen as an effective Canonical mode',
);

const restoredSignatureAuthority = core.replace(
  '    normalizeCanonicalContentMode(snapshot.canonicalContentMode),',
  '    normalizeCanonicalMotionMode(snapshot.canonicalMotionMode),\n    normalizeCanonicalContentMode(snapshot.canonicalContentMode),',
);
assert.notEqual(restoredSignatureAuthority, core, 'the reset-authority false-closure mutation must alter source');
assert.match(
  restoredSignatureAuthority.match(/export function canonicalSourceControlSignature[\s\S]*?^}/m)?.[0] || '',
  /canonicalMotionMode/,
  'the barrier detects a restored legacy motion reset dependency',
);

const nonzeroUniformAuthority = core.replace(
  'uniforms[73] = CANONICAL_ANALYTIC_MOTION_RETIRED_UNIFORM_VALUE;',
  'uniforms[73] = canonicalMotionModeValue(controlsSnapshot.canonicalMotionMode);',
);
assert.notEqual(nonzeroUniformAuthority, core, 'the uniform false-closure mutation must alter source');
assert.doesNotMatch(
  nonzeroUniformAuthority,
  /uniforms\[73\]\s*=\s*CANONICAL_ANALYTIC_MOTION_RETIRED_UNIFORM_VALUE\s*;/,
  'the barrier detects restored GPU authority in the reserved slot',
);

const aliasedPackedAuthority = core
  .replace(
    'uniforms[73] = CANONICAL_ANALYTIC_MOTION_RETIRED_UNIFORM_VALUE;',
    `uniforms[73] = CANONICAL_ANALYTIC_MOTION_RETIRED_UNIFORM_VALUE;
    const restoredCanonicalMotionSlot = 72 + 1;
    uniforms[restoredCanonicalMotionSlot] = canonicalMotionModeValue(controlsSnapshot.canonicalMotionMode);`,
  )
  .replace(
    'let canonicalContentMode = clamp(u.canonical_render_motion_controls.z, 0.0, 2.0);',
    `let restoredCanonicalMotionAuthority = u.canonical_render_motion_controls.g;
  let canonicalContentMode = clamp(u.canonical_render_motion_controls.z, 0.0, 2.0) * (1.0 - restoredCanonicalMotionAuthority);`,
  );
assert.notEqual(aliasedPackedAuthority, core, 'the aliased packed-component false-closure mutation must alter source');
assert.throws(
  () => assertCanonicalRetiredPackedComponent(aliasedPackedAuthority),
  /must have exactly one CPU write/,
  'the barrier rejects an added aliased nonzero write even when the blessed zero line remains',
);

const aliasedUniformBaseAuthority = core.replace(
  'uniforms[73] = CANONICAL_ANALYTIC_MOTION_RETIRED_UNIFORM_VALUE;',
  `uniforms[73] = CANONICAL_ANALYTIC_MOTION_RETIRED_UNIFORM_VALUE;
    const restoredUniformsAlias = uniforms;
    restoredUniformsAlias[73] = canonicalMotionModeValue(controlsSnapshot.canonicalMotionMode);`,
);
assert.notEqual(aliasedUniformBaseAuthority, core, 'the aliased uniform-base false-closure mutation must alter source');
assert.throws(
  () => assertCanonicalRetiredPackedComponent(aliasedUniformBaseAuthority),
  /must have exactly one CPU write/,
  'the barrier rejects a retired-slot write through an alias of the uniforms base array',
);

const parenthesizedUniformBaseAuthority = core.replace(
  'uniforms[73] = CANONICAL_ANALYTIC_MOTION_RETIRED_UNIFORM_VALUE;',
  `uniforms[73] = CANONICAL_ANALYTIC_MOTION_RETIRED_UNIFORM_VALUE;
    const parenthesizedUniformsAlias = (uniforms);
    parenthesizedUniformsAlias[73] = canonicalMotionModeValue(controlsSnapshot.canonicalMotionMode);`,
);
assert.notEqual(parenthesizedUniformBaseAuthority, core, 'the parenthesized uniform-base mutation must alter source');
assert.throws(
  () => assertCanonicalRetiredPackedComponent(parenthesizedUniformBaseAuthority),
  /must have exactly one CPU write/,
  'the barrier rejects a retired-slot write through a parenthesized alias of the uniforms base array',
);

const commentedParenthesizedUniformBaseAuthority = core.replace(
  'uniforms[73] = CANONICAL_ANALYTIC_MOTION_RETIRED_UNIFORM_VALUE;',
  `uniforms[73] = CANONICAL_ANALYTIC_MOTION_RETIRED_UNIFORM_VALUE;
    const commentedUniformsAlias = (/* same destination */ uniforms);
    commentedUniformsAlias[73] = canonicalMotionModeValue(controlsSnapshot.canonicalMotionMode);`,
);
assert.notEqual(commentedParenthesizedUniformBaseAuthority, core, 'the commented uniform-base mutation must alter source');
assert.throws(
  () => assertCanonicalRetiredPackedComponent(commentedParenthesizedUniformBaseAuthority),
  /must have exactly one CPU write/,
  'the barrier rejects a retired-slot write through a commented parenthesized uniforms alias',
);

const indexedPackedAuthority = core.replace(
  'u.canonical_render_motion_controls.x',
  'u.canonical_render_motion_controls[1]',
);
assert.notEqual(indexedPackedAuthority, core, 'the indexed packed-component false-closure mutation must alter source');
assert.throws(
  () => assertCanonicalRetiredPackedComponent(indexedPackedAuthority),
  /cannot be consumed through \[1\]/,
  'the barrier rejects indexed access to the retired packed component',
);

console.log('canonical analytic motion retirement contracts passed');
