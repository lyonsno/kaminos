# Testing WGSL behavior

Execute production WGSL and assert its output. New tests must not use regexes,
substring checks or source-string comparisons as evidence that a shader behaves
correctly. Reading or extracting WGSL to execute it is encouraged.

Kaminos installs `@kaminos/shader-herder` through ordinary `npm ci`. Its API
reference is `node_modules/@kaminos/shader-herder/README.md`. Import the local
bridge from `tools/shader-herder.mjs`; it resolves the installed package and
reports the actual adapter and execution authority.

## A production-function test

This example runs the production optical composition function with controlled
inputs and reads its numerical output. Save it under `tests/`:

```js
// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import { OPTICAL_STEPPING_WGSL } from '../volume-optical-native.mjs';
import { evalWgslBatch, withKaminosGpu } from '../tools/shader-herder.mjs';

test('composition adds attenuated light and multiplies transmittance', async () => {
  await withKaminosGpu(async ctx => {
    const result = await evalWgslBatch(ctx, {
      preamble: OPTICAL_STEPPING_WGSL,
      argTypes: ['f32', 'f32'],
      returnType: 'vec4<f32>',
      body: 'return opticalCompose(vec4<f32>(1.0, 2.0, 3.0, arg0), vec4<f32>(4.0, 5.0, 6.0, arg1));',
      inputs: [[0.5, 0.25], [0, 0.25]],
    });
    assert.deepEqual(result, [[3, 4.5, 6, 0.125], [1, 2, 3, 0]]);
  }, { wgslSources: [{
    label: 'optical-composition', entryPoint: 'main',
    code: `${OPTICAL_STEPPING_WGSL}
      @compute @workgroup_size(1) fn main() {
        _ = opticalCompose(vec4<f32>(0.0), vec4<f32>(0.0));
      }`,
  }] });
});
```

Run the selected test through the normal runner. Set
`SHADER_HERDER_STRICT_METAL=1` when the result must establish native numerical
execution. A specifically identified Metal sandbox restriction may otherwise
take the explicit compiler-only route; that validates declared modules and
compute pipelines, and cannot establish numerical correctness. Check the
`shader-herder-evidence:` records, not only the process exit code.

## Converting an existing source check

Use an exported production WGSL block, or `extractWgslFunction` and
`extractWgslBlock` for functions embedded in a renderer. Keep the function under
test intact. Supply controlled inputs and only the dependencies needed to
isolate its behavior. Assert concrete outputs, including identities, signs,
boundaries and relevant failure paths. Include a deliberate valid-WGSL fault
that the numerical oracle rejects; a compile error is not that control.

`tests/volume-flow-reconstruction-native.mjs` demonstrates replacing kernel
wording checks with semantic-lane, normal and sampling assertions. Its analytic
fields isolate arithmetic and sampling policy; they do not certify texture
bindings, interpolation or rendered appearance. Use the relevant production
pipeline or scene witness when those are the behavior being tested.

## Commit enforcement

In the shop, the managed pre-commit hook rejects new direct source-text assertion
syntax against staged shader sources. It recognizes ESM imports of directly
exported immutable shader-text constants, constant direct Node file reads with
literal paths, and inline string or regex checks on those values. Standard Node
assertions and standard `expect` text, equality, length and truth matchers are
covered. It reads Git objects and executes neither repository code nor lint
configuration.

Bare relative filesystem paths use the repository root as the supported test
working directory. ESM imports and `new URL(literal, import.meta.url)` use the
module directory with file-URL semantics. CommonJS Node filesystem and assertion
APIs are supported; **CommonJS shader-module imports are outside automatic source
classification**, including explicit and extensionless filenames. Custom URL
bases, re-exports, default-object exports and callable/mutable exports are also
outside the mechanical source class.

The rule has no alias propagation, object-property tracking, mutable-value
analysis or helper-return analysis. Wording checks in these excluded forms remain
prohibited as shader-behavior evidence and are enforced through review.
Numerical execution results, error-message regexes and legitimate parser,
extractor or code-generation output contracts remain valid.

Legacy allowances count normalized assertion syntax from `HEAD`. Comments and
formatting remain compatible; a new duplicate, copied file or directly changed
expectation has no new allowance. Changes behind an expectation binding or other
code outside the assertion are not analyzed and remain review obligations.
Unstaged edits cannot hide a staged direct assertion; parser or inspection
failures reject inspection.

Passing this rule does not establish that shader behavior was exercised. Use
production WGSL execution and concrete output assertions for that evidence.

## Local reaction-law coverage

`tests/volume-reactant-combustion-native.mjs` runs the exported production
reaction law with values from the production uniform packer. It checks ignition,
limiting reactants, coupled fuel/oxidizer/heat balance, step subdivision and
exchange/cooling/soot rate helpers. Its numerical oracles reject valid WGSL faults
in heat release, oxidizer consumption and time-dependent cooling. The existing
JavaScript model and configuration tests remain complementary reference checks.
This local-law test does not establish the material kernel's texture bindings,
transport, soot/expansion writeback or rendered appearance.

See [the test runner guide](../testing.md#native-shader-tests) for route details.
