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

Automation status, November 5: the shared commit-blocker candidate is under
review and has not been activated. The testing rule above applies now.

The candidate examines staged JavaScript against staged shader sources and
rejects new assertions on production WGSL text with the file and line plus the
replacement guide. The check follows imported shader names,
source reads, aliases and extracted text through common string operations.
It covers Node assertions and standard `expect(...).toMatch`/`toContain` forms.
It does not evaluate repository code.

Existing unchanged assertions are grandfathered against `HEAD`, so a conversion
can be incremental. Adding a duplicate, changing an expectation or copying a
check into a new file does not create an allowance. Unstaged edits cannot hide
the staged assertion; a parse failure rejects inspection. Ordinary regexes on
error messages and assertions on executed numerical results remain valid.

The policy applies to shader behavior even when a particular metaprogrammed
test form is beyond the static check. Parser, extractor and code-generation
tests may assert their actual text outputs; that establishes a text-transform
contract, not shader execution. Describe that scope accurately.

See [the test runner guide](../testing.md#native-shader-tests) for route details.
