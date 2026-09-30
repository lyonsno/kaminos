# TRELLIS 2 sparse-flow port

This model-specific slice uses the public Kaminos inference-kit session,
registered route, tensors, kernels, and linear shader. It does not extend the
shared kit or depend on the older DINO feature stack.

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
```

Replay (all persistent destinations and source roots are caller-owned):

```sh
python models/trellis2/export-sparse-prefix.py --source-root TRELLIS_WORKTREE \
  --checkpoint CHECKPOINT --sample SAVED_SPARSE_STEP_NPZ --out REFERENCE_DIRECTORY
node models/trellis2/run-sparse-prefix-witness.mjs --repo-root KAMINOS_WORKTREE \
  --expected-commit EXACT_COMMIT --fixture REFERENCE_DIRECTORY \
  --chrome INDEPENDENT_CHROME_FOR_TESTING_EXECUTABLE --report TERMINAL_REPORT --receiver OWNER
```
