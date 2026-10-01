# TRELLIS 2 sparse-flow port

This model-specific slice uses the public Kaminos inference-kit session,
registered route, tensors, kernels, and linear shader. It does not extend the
shared kit or depend on the older DINO feature stack.

## Resident generation stages

`createTrellisSparseFlowAdapter` composes the prefix, all thirty transformer
blocks, terminal LayerNorm and F32 prediction. `createTrellisSparseSamplerAdapter`
keeps CFG, guidance rescaling, standard deviation, Euler updates and subsequent
model inputs resident through the complete source schedule. Their offline
witnesses retain failed numerical predicates rather than treating a passing
prediction or latent as whole-model fidelity.

`createTrellisSparseDecoderAdapter` accepts the same registered runtime and a
borrowed F32 NCDHW sampler tensor. Its twenty 3D convolutions, eight residual
blocks, two pixel-shuffle expansions and channel-wise LayerNorm/SiLU produce
F32 `[1,1,64,64,64]` occupancy logits without layer readback. Native OI-DHW
checkpoint weights are F32 in this adapter: the pinned MLX loader also casts
mixed F16/F32 checkpoint storage into F32 constructor destinations. Implicit
im2col uses only workgroup tiles; it does not allocate a full unfolded volume.
The caller retains ownership of borrowed latent storage.

`export-sparse-decoder.py --synthetic` provides small actual-source operation
conformance, distinct from `--checkpoint ... --checkpoint-config ...
--input-manifest ...` full checkpoint decoding. Both are offline stage fixtures,
not live sampler composition. The existing isolated runner accepts `--witness
decoder`; it records native route/source identity and complete raw outputs.
Decoder arithmetic uses the predeclared F32 state predicate `atol=rtol=0.001`.
Occupancy sign agreement is reported separately. Shape/texture models, image
conditioning composition and the generated asset's authoring consumer remain
outside these serving adapters.

## Prefix entrance and historical reference

`createTrellisSparsePrefixAdapter` accepts a registered route, decoded checkpoint
weights in native `[out,in]` layout, and grid configuration. `run` takes complete
F32 NCDHW noise and a timestep and returns two browser-session-owned GPU tensors:
the voxel projection `[4096,1536]` and shared modulation `[1,9216]`. They remain
usable until adapter/route disposal. The prefix reproduces the source's F32
controls and final BF16 casts using rounded BF16 values stored in F32 buffers.
It does not execute any of the thirty transformer blocks, output projection,
sampler recurrence, sparse decoder, shape, or texture models.

`export-sparse-prefix.py` extracts only eight prefix weights and derives an
offline reference from pinned source and saved noise/time. It records source,
checkpoint and tensor digests. Its reference route is MLX **CPU** input linear
plus the source's NumPy timestep/modulation implementation, with BF16 casts;
this is not a capture of the prior full MLX GPU run. It constructs no full model.

The independent browser witness uses the same serving adapter, hashes all
fixture tensors and all served JS against the exact requested clean commit,
requires native Apple WebGPU, and saves complete raw outputs alongside its
terminal report. Reference tensors and proof-only readbacks are outside the
serving adapter. Its predeclared comparison permits one BF16 spacing relative
to the expected value plus `1e-4` absolute F32 cancellation error; a pass is
boundary parity under that tolerance, not bitwise parity or full generation.

Focused checks:

```sh
node models/trellis2/tests/sparse-prefix-contracts.mjs
node models/trellis2/tests/sparse-prefix-witness-contracts.mjs
node models/trellis2/tests/sparse-prefix-early-failure.mjs
```

Replay (all persistent destinations and source roots are caller-owned):

```sh
python models/trellis2/export-sparse-prefix.py --source-root TRELLIS_WORKTREE \
  --checkpoint CHECKPOINT --sample SAVED_SPARSE_STEP_NPZ --out REFERENCE_DIRECTORY
node models/trellis2/run-sparse-prefix-witness.mjs --repo-root KAMINOS_WORKTREE \
  --expected-commit EXACT_COMMIT --fixture REFERENCE_DIRECTORY \
  --chrome INDEPENDENT_CHROME_FOR_TESTING_EXECUTABLE --report TERMINAL_REPORT --receiver OWNER
```
