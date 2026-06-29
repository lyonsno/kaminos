# Route Receipts And Source Truth

Kaminos routes are evidence-producing operations. A route receipt records what
the operator or system asked for, what actually happened, which backend and
runtime were involved, and why the result should or should not be trusted for a
particular role.

The core rule:

```text
requested route is not source truth
```

A request can ask for a hosted generator, local WebGPU route, image-to-splat
adapter, mesh generator, material route, or conditioning pass. The effective
route may be live, fixture, fallback, request-only, partial, failed, or timed
out. Kaminos must preserve the difference.

## Receipt Responsibilities

A route receipt should identify:

- schema;
- receipt id or report path;
- requested route;
- effective route;
- backend class;
- runtime identity;
- source inputs;
- conditioning inputs;
- output artifacts or failure report;
- fallback reason when the effective route differs from the request;
- source-truth warnings;
- timing and phase information when useful;
- model, kernel, adapter, or route implementation identity when applicable.

Receipts are not decorative metadata. They are the compact custody surface that
lets another part of Kaminos, another agent, or a later operator understand what
the artifact actually is.

## Requested Versus Effective Route

When `requestedRoute` and `effectiveRoute` differ, the receipt must say why.

Example:

```text
requestedRoute: openai_api
effectiveRoute: fixture
fallbackReason: openai_api_unconfigured
```

That output may still be useful as a fixture or UI witness. It must not be
presented as an OpenAI-generated artifact.

The same applies to local routes:

```text
requestedRoute: moge.depth-normal.webgpu-local.v0
effectiveRoute: moge.depth-normal.webgpu-local.v0
backendClass: webgpu-local
```

This tells us the route identity matched. It still does not by itself prove
that the output is promoted, scene-native, hash-authoritative, or complete.

## Evidence Strength

Kaminos currently uses these practical source-truth states:

- `fixture`: deterministic local evidence for UI, contract, or witness work;
- `request-only`: a route request was formed but no generator/backend executed;
- `fallback`: a different effective route produced the output;
- `live`: a real backend executed and returned usable output;
- `partial`: a route returned useful but incomplete or weak-custody output;
- `failed`: a route failed and produced a report rather than a usable output;
- `timeout`: a route did not finish before the configured witness boundary and
  produced a timeout report;
- `promoted`: an output was explicitly accepted into a stronger asset role.

These states can coexist. A live route can return partial output. A failed route
can still produce a valuable report. A fixture can prove UI behavior while not
proving backend behavior.

## Source-Truth Warnings

Source-truth warnings are compact, machine-readable humility.

Examples:

- `fixture_not_live_generated_output`
- `fixture_route_not_live_execution`
- `fixture_kiln_not_live_compute`
- `fallback_artifact_not_requested_route_truth`
- `route_receipt_requested_effective_mismatch`
- `route_request_not_generator_execution_truth`
- `route_execution_failed`
- `kiln_route_failed`
- `anonymous_imagedata_receipt_partial`
- `route_request_strengthened_by_failure_tags`

A warning should be attached where the weakness matters: artifact, route run,
truth layer, lineage receipt, packet, UI row, witness report, or promotion
decision.

Warnings are not errors by default. They are what prevents a valid weak artifact
from becoming a false strong claim.

## Failure Reports

A route failure report is evidence.

The current graph API route normalizes route timeout into
`kaminos.pipeline-run-result.v0` with a `pipeline-witness.json` report. A failed
or timed-out SHARP route can therefore enter the Specimen Packet cockpit as:

```text
Route evidence: failure report
```

That is useful because the packet can preserve backend identity, report path,
failure phase, source image, and next-request law. It is not a generated splat.

## Candidate Outputs Versus Truth Layers

Kaminos must distinguish candidate artifacts from truth layers.

Candidate artifacts propose appearance, form, or asset substance. They are the
kind of output an operator may judge as good, bad, salvageable, or promotable.

Truth layers condition future routes or establish specimen law. Examples:
depth, normal, silhouette, mask, pointmap, region masks, scribbles, or material
swatches.

MoGE depth/normal/pointmap outputs are truth layers. They should enter the
packet with:

```text
packetBindingRole: truth-layer
```

They should not appear as candidate concept artifacts.

## Partial And Anonymous Outputs

Browser-local inference can produce useful `ImageData` or tensor-like outputs
before Kaminos has final artifact ids, hashes, or promoted file custody.

Those outputs can be used as partial truth layers, but the receipt must preserve
the weakness:

```text
anonymous_imagedata_receipt_partial
```

This warning means: the route identity may be real, and the output may be
useful, but do not treat the output as a final promoted artifact unless another
surface supplies artifact custody.

## Witness Requirements

A witness that proves route evidence must try to fail honestly.

For route surfaces, useful witnesses should assert:

- requested and effective route identity;
- backend class and runtime identity;
- output role;
- candidate versus truth-layer binding;
- failure or timeout report path when no output exists;
- source-truth warnings;
- no missing or synthetic receipt identity such as `undefined`;
- visible UI language that does not overclaim.

Nonblank output is not enough. A route witness must prove that the visible and
machine-readable evidence agree about what happened.

