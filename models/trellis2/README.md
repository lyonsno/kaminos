# TRELLIS 2 — WebGPU image-to-3D

Generate learned geometry and PBR materials from an image using the Kaminos
WebGPU inference kit. The complete learned pipeline runs in the browser:
DINOv3 image conditioning, sparse-structure diffusion and occupancy decoding,
shape diffusion, geometry decoding, shape-conditioned texture diffusion and
material decoding. Both **512/no-cascade** and **1024/cascade** paths are
implemented. Checkpoint weights load and retire by role rather than keeping
every model resident together.

This is an in-tree source-checkout port; the npm inference kit supplies the
runtime, not the TRELLIS model weights or its Python finishing dependencies.

## Image preparation, generation and finishing

Prepare foreground pixels before conditioning. An ordinary image may use
`pack-prepared-generation.py --image`; a previously prepared image uses
`--foreground`. Background removal and foreground cropping belong here,
not in mesh cleanup. The image entrypoint uses the selected local
Trellis2MLX preprocessing source and records its identity.

The tools consume a complete cached checkpoint package produced by
`pack-generation.py`. That model-free packer accepts the checkpoint snapshot
and explicit DINO/sparse/shape/decoder/occupancy reference directories; see
`python models/trellis2/pack-generation.py --help` for those paths. Reuse that
package for subsequent images; packaging does not execute learned inference.
Use a Python environment with NumPy and Pillow, plus the selected preprocessing
source's background-removal dependencies for the ordinary-image entrypoint.

For a 512 preview with eight sampling steps:

```sh
python models/trellis2/pack-prepared-generation.py \
  --repo-root KAMINOS_WORKTREE --expected-commit EXACT_COMMIT \
  --base CACHED_CHECKPOINT_PACKAGE --image INPUT_IMAGE \
  --preprocess-source-root TRELLIS_MLX_WORKTREE \
  --expected-preprocess-source-commit EXACT_MLX_COMMIT \
  --pipeline-type 512 --steps 8 --out PREPARED_INPUT_DIRECTORY

node models/trellis2/run-sparse-prefix-witness.mjs \
  --repo-root KAMINOS_WORKTREE --expected-commit EXACT_COMMIT \
  --witness generation --fields-only --fixture PREPARED_INPUT_DIRECTORY \
  --chrome INDEPENDENT_CHROME_FOR_TESTING_EXECUTABLE \
  --memory-python PYTHON_EXECUTABLE --receiver OWNER \
  --report NATIVE_OUTPUT_DIRECTORY/report.json
```

`--fields-only` retains the complete learned fields and noise, then releases
model resources without first unwrapping and baking the raw mesh. It makes
finishing replayable without rerunning inference. Omitting this flag preserves
the direct raw-mesh GLB path. Each command records its effective route, source,
configuration and terminal state; a failed export is not a successful GLB.

Finish a successful retained-field run using the established source cleanup
order, a caller-selected simplification target, UV unwrapping and 1K PBR baking:

```sh
node models/trellis2/finalize-retained-generation.mjs \
  --repo-root KAMINOS_WORKTREE --expected-commit EXACT_COMMIT \
  --input-root NATIVE_OUTPUT_DIRECTORY --expected-native-commit EXACT_COMMIT \
  --python TRELLIS_MLX_PYTHON --source-root TRELLIS_MLX_WORKTREE \
  --expected-source-commit EXACT_MLX_COMMIT --target-faces 200000 \
  --receiver OWNER --output FINISHED_DIRECTORY/asset.glb
```

The cleanup environment needs the selected source's mesh dependencies,
including SciPy, trimesh and fast-simplification. UV work uses the repository's
worker tooling. The cleanup/bake stages are CPU/worker consumers of WebGPU
output; they do not call MLX learned models. For an otherwise failed command
that retained all completed model fields, `--input-mode completed-model-fields`
permits separately validated finishing while preserving the original failure.

The accepted sneaker demonstrates the complete learned pipeline and separately
exercised finishing path. Surface gaps and roughness remain. The standard
Generate-menu integration is not yet this source toolchain.

## Shared-device integration

`createTrellisImageGenerationAdapter` in `trellis-generation.js` accepts a
registered route and normalized pixels/checkpoint inputs. Its queued invocation
returns resident conditioning, geometry and material tensors; consume them
before disposing their adapters or releasing the route.

`createTrellisSharedHost` in `shared-host.js` connects the model to the
Kaminos host's existing device, exact queue and ordinary foreground renderer.
Call `beginRun({runId,signal})`, execute through its returned route, consume
the outputs, then await `finish()` and dispose the bridge. The host keeps its
borrowed device. The bridge services actual foreground opportunities at model
boundaries and observes Stop before further encoding or readback.

Native shared-device generation reproduced every retained field of the accepted
isolated sneaker while the authored flame advanced, then released the route.
That establishes this composition and output identity, not a smooth frame-rate
or throughput guarantee.

## Memory measurements

Generation records live and peak API-visible GPUBuffer bytes and, on macOS,
the sampled footprint of owned runner/browser descendants. For the recorded
512 sneaker, GPUBuffer peak was about **6.27 GiB**; the sampled charged process
footprint sum reached about **16.4 GiB**. These scopes are different: do not add
them or interpret either as unique physical memory. Driver/upload-private
memory and missed transients matter. Safe 16–18 GiB operation is not yet
established; controlled admission and failure cleanup are the next target.

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
Occupancy sign agreement is reported separately. These individual adapters feed
the complete composition above; their local numerical witnesses do not by
themselves establish the whole generated asset.

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
