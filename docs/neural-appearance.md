# NVIDIA compact neural appearance: decoder foundation

`neural-appearance.mjs` reads the directional decoder portion of `model.json`
from [NVlabs/neuralappearance](https://github.com/NVlabs/neuralappearance), pinned
at `305b4b9c12e679398c487603dd8245c3f348526c`, and produces ordinary WebGPU WGSL.
The native program loads a spatial bundle, assigns it through ordinary material
recipes, and evaluates point, spot and directional lights. A portable MLX
trainer fits retained directional-response corpora. An own painted-steel fit now supplies an integration specimen; numerical/native
adapter checks do not establish published-material reproduction or performance. Auxiliary guides, the sampler,
environment response and indirect integration remain separate work.

The checked author tree includes MaterialX sources and textures for FauxLeather,
Bark and PatternedMetal, but no trained checkpoints; its GitHub release list was
empty on November 11, 2026. The separate RTX Neural Shading SDK has simple
network examples; those are not the layered appearance checkpoints in this
research project.

## Exact source and numerical boundary

The current repository accompanies *Taming optimization variance in compact
neural shading networks* (SIGGRAPH 2026), with antecedents in *Real-Time Neural
Appearance Models* (2024). This port follows the released 2026 source:

- `model/bsdf_decoder.py`: component order and output mapping.
- `model/mlp.py`: row-major `mlp_layers` checkpoint records, biases, widths.
- `model/half_diff_parameterization.slang`: original and stable Rusinkiewicz
  transforms, computed before the learned-frame projection.
- `model/rotation.slang`: bias-free latent-to-frame prediction; normals first,
  tangents second; canonical residual axes; individually normalized tangent and
  normal. The tangent is deliberately not orthogonalized and their cross product
  is not normalized.
- `model/bsdf_decoder_flattener.slang`: direction-major, then frame-major XYZ
  features, followed by latents. `WhWdZiZo` puts all half vectors first, then all
  difference vectors, incident Zs, outgoing Zs and finally latents.
- `neuralnetworks/components/smelu.slang` and `scaled_sigmoid.slang`: exact
  nonlinear mappings, including the stable scaled sigmoid with its offset.
- `rendering/neural_material.slang`: reject directions below the reflective
  surface, clamp negative output and reject nonfinite decoded output.

`readNeuralAppearanceDecoder(modelJson)` validates the declared architecture
and stored parameter sizes; missing weights or unknown supported-stage choices
fail explicitly. Unknown additional metadata is ignored. Supported hidden
activations are SmeLU, LeakyReLU, ReLU, Tanh, ELU and Identity. Both author angular
parameterizations and all four direction feature layouts are implemented.
Output activations are Exp and ScaledSigmoid. Architectures are read from the
checkpoint, without a private neuron/frame cap.

`buildNeuralAppearanceWGSL(model)` exports `neuralAppearancePrepare(latents)`
and `neuralAppearanceEvaluatePrepared(prepared, wi, wo)`. A caller can share the
latent lookup and frame prediction across light directions. The convenience
`neuralAppearanceEvaluate(latents, wi, wo)` prepares and evaluates one query.
Directions are unit vectors in the same surface chart used by the teacher;
returned values retain author decoder units. The future lighting adapter must
establish the teacher's cosine/transport convention before multiplying lighting.

The released default has eight latents, two frames and a 24→16→16→3 network:
96 dense MAC shared for frames, 688 per direction, 784 for a single combined
query. These exclude texture reads, direction transforms, normalization,
nonlinearities, visibility and integration. They are not timings. This WGSL uses
scalar float32 arithmetic; it does not inherit NVIDIA tensor-operation speedups
or reproduce intermediate FP16 rounding.

## Texture and training work still needed

`neural-appearance-bundle.mjs` retains the author's decoder metadata and adds a
`kaminos.neural-appearance.bundle.v1` extension with per-level dimensions, relative
payload URLs and SHA256. Payloads are little-endian float32, row-major,
channel-interleaved. The model and every payload are verified before material
assignment. Mounted `/api/read` companions preserve their root and directory. Use `.model`
for the JSON checkpoint through that mounted route: it serves exact binary bytes,
whereas `.json` is decoded and reserialized by the file API and therefore changes
the byte digest. The JSON format itself is unchanged.
The explicit filtering policy is `nearest-authored-texel-mip`: nearest spatial
texel and nearest authored level. It evaluates existing learned levels; it does
not manufacture latent MIPs by averaging. This stable initial adapter does not
reproduce the author's stochastic interpolation or supply temporal reconstruction.
Its shading is currently full rate; NeuMIP's resolution control does not yet
apply to this new program.

The native Material inspector offers **NVIDIA neural appearance** through its
ordinary **Create material** flow. Installed choices come from
`image-inbox/nvidia-appearance-models/catalog.json`:

```json
{"schema":"kaminos.neural-appearance.catalog.v1","materials":{"My finish":{"filename":"my-finish/model.model","sha256":"<SHA256 of exact checkpoint bytes>"}}}
```

Place the unchanged exported checkpoint and its referenced latent files together
inside that mounted folder. The first catalogue entry seeds a new recipe; the
Checkpoint selector changes existing assignments through the same material
history path. An absent or empty catalogue reports that no trained model is
installed. Programmatic creation can supply an explicit `{source:{url,sha256},
uvScale,gain}`. Equal URLs/digests share their prepared source independently of
object-property insertion order. UV coordinates are required on the target mesh.

`neural-appearance-material.mjs` prepares spatial latents and learned frames once
per shaded fragment and shares them across direct light queries. The trained
response includes the macro light cosine, so the adapter does not multiply it
again. Each material has a private program-cache identity. Area lights fail
explicitly; environment and indirect response are currently absent.

`tools/neural-appearance-fit.py CONFIG OUTPUT` runs through Greenroom with an
MLX-enabled Python interpreter. Its optional capture stage consumes an existing
owner-authored source JSON and a pinned `SurfaceMaterialTeacher` worktree. The
corpus retains every training/held-out query and label, source geometry and
source-module identities. View/light directions are converted explicitly from
the teacher's incoming convention to outward Z-up chart directions. Teacher
labels are multiplied by the macro light cosine to produce projected response.
Checkpoints retain their corpus identity, provenance, held-out predictions and
exact native model/latent bytes. Configuration and output paths are caller-owned.

This first portable fit directly optimizes eight normalized latent channels and
one two-frame/2x16 decoder in float32. It uses a log-response loss, a finite
retained corpus and one initialization. It does not reproduce the official
encoder, FP16 arithmetic, candidate pruning, auxiliary or sampler training.
It supplies a portable integration specimen, not the paper's pretrained material
or a capacity/quality ceiling.

The author runtime stochastically selects latent texels and integer MIP levels
before nonlinear decoding. Deterministic interpolation of decoded values and
interpolating latent values before decoding are different operations. A future
runtime must select and witness its filtering policy; a hardware-filtered latent
texture is not automatically equivalent to the author stochastic estimator.
Learned mip levels are trained against filtered targets, not generated by
blindly averaging latent codes.

The author trainer jointly fits an encoder and directional decoder from GPU
MaterialX/MDL reference evaluations, then bakes the encoder into latent textures.
Optional direct latent refinement, importance-sampler and auxiliary guide
training are separate phases. The encoder is not a runtime cost. The released
configuration addresses small-network optimization variance with parallel model
initializations and staged survivor selection; reproducing only one fit is not
reproducing that training method.

The documented author route requires a Vulkan-capable NVIDIA GPU with
Cooperative Vector support, Slang/SlangPy and falcor2. The current M4/WebGPU port
therefore needs a portable teacher and training implementation, or an author
checkpoint / supported NVIDIA training execution. The portable route above uses
the existing Kaminos directional teacher and produces our own fitted materials,
distinct from the released paper's specimens.

## Verification and next consumer

Run `SHADER_HERDER_STRICT_METAL=1 node tests/neural-appearance.mjs` for native
production WGSL numerics, or `npm test -- --only tests/neural-appearance.mjs`
for normal platform routing. The deterministic fixtures use the observed
checkpoint schema and hand-calculated numerical invariants. They cover learned
nonorthogonal frames, feature order, hemisphere rejection, angular layouts,
both half/difference transforms and output mappings. A valid WGSL weight-layout
fault must fail the numerical oracle. These synthetic fixtures establish local
decoder behavior; a real exported checkpoint and native scene render remain
necessary for external-format conformance and visual acceptance.

The next consumer is a real checkpoint on editable Workbench carriers under
ordinary moving lights, preserving model identity and material coordinates.
Inspect grazing response, highlight structure, filtering and failure cases
before selecting broad material coverage or a GI integration architecture.

Code adapted from NVIDIA's Apache-2.0 source; the retained
[license](licenses/neuralappearance-license.txt) applies to that adaptation.

## Inspect a retained fitting trajectory

The **NVIDIA training trajectory** Workbench experiment accepts `experiment_inputs`
with a `run` URL pointing to a `kaminos.neural-appearance.trajectory.v1` manifest
and an optional `slices` URL for a completed reference capture. Open it on an
ordinary saved scene with NVIDIA materials. Selecting a retained step changes
those material recipes under the same native camera and lights. It lists every
saved checkpoint and its held-out response error, without equating lower loss
with visual convergence.

A `checkpoints-only` manifest explicitly exposes saved models while matched
source slices are pending. Complete manifests contain exact float32 projected
response slices and SHA256 for every declared view and checkpoint. Source and
prediction use identical display exposure; absolute error is separately labelled.
Response view changes affect that controlled comparison independently of the
ordinary 3D camera. `tools/neural-appearance-slices.mjs CONFIG OUTPUT` produces
these arrays through Greenroom from the retained source, teacher and checkpoint
identities. It does not retrain.
