# BFL prompt helper: browser conversion

This directory builds ONNX components for the exact
`black-forest-labs/flux-3-image-klein-pup` Qwen3.5-9B fine-tune. Component
construction is in progress; a working browser helper is not established yet.
The existing local MLX trial lives on `cc/thomas-pup-sidecar-1025`.

Use a separate Python 3.12 environment with `requirements-export.txt`. This is
offline conversion tooling; it does not add Python dependencies to the browser
application or the normal Kaminos test environment. Run conversion through GPU
Greenroom, using explicit source, output and report paths.

The pinned original is revision `3f3edb52b2c55de0d49feab28598b68f7f8e4830`.
Its `model.safetensors` is 18,819,722,392 bytes, LFS SHA-256
`f5062a1fba3e63afe5c88349a311903fec06c959b362f1247127e63d5c860ed4`.
The converter verifies the actual source digest and preserves its full tensor
header and small model/config/tokenizer files. It does not delete the source.

The language decoder uses the ONNX Runtime GenAI model builder, pinned to
`microsoft/onnxruntime-genai@6b7ff3ca3efa15da219050fdb4ecf8bed67875af`:
INT4 weights, WebGPU target, `exclude_embeds=true`, `block_size=64`,
`is_symmetric=false`, `state_window=0`, `exclude_mtp=true`, and
`filename=decoder_model_merged_q4f16.onnx`. Browser packaging must retain its
FP16 I/O and each cache binding's actual type and shape. An exported decoder
alone is not an image-aware prompt helper.

`export_components.py` supplies the other components. Required arguments are
`--source-dir`, `--source-revision`, `--source-weight-sha256`, `--out`,
`--report` and `--component vision|embeddings`. Choose a fresh component output
directory so previous artifacts remain available. Reports record the failure
phase, source identity, actual versions and component checks.

Token embeddings use ONNX Runtime's affine Q4 `GatherBlockQuantized`, groups
of64, with FP16 output. Vision parameters use FP16 storage with FP32 arithmetic
and FP16 feature output. This precision route is provisional: the first full
FP16 export failed the recorded source-comparison tolerance, so the next
experiment retains FP32 arithmetic rather than weakening that tolerance.
The vision graph encodes one
image per call; a browser adapter must evaluate all supplied references and
concatenate their features in attachment order. It supplies block-ordered
position IDs and bilinear position-embedding indices/weights derived from each
image's processor grid. This separates dynamic image preparation from model
math. Directly tracing the canonical vision forward captured the first image's
Python attention split size and failed on a different grid.

The wrapper retains the canonical Qwen3.5 vision parameters, norms, rotary
embedding and MLP/merger, and uses one-image scaled dot-product attention.
The converter compares two real-model grids to the canonical Transformers
vision forward and checks the resulting ONNX on CPU. These checks do not
establish browser execution or whole-helper generation quality.

Run the small dynamic-grid source-conformance check with the export interpreter:
`python tests/bfl-pup-vision-export.py` from the repo root. It verifies square,
landscape and portrait grids against canonical Transformers and rejects a
multi-image tensor passed to a single-image call. This optional export-stack
check is marked manual for the ordinary test runner; agents execute it directly
in the pinned conversion environment.

Source implementations:
[BFL's helper](https://github.com/black-forest-labs/flux-3-image-klein/blob/main/src/flux3/pup.py),
[BFL's fine-tune](https://huggingface.co/black-forest-labs/flux-3-image-klein-pup),
[Transformers Qwen3.5](https://github.com/huggingface/transformers/tree/main/src/transformers/models/qwen3_5),
and [ONNX Runtime GenAI builder](https://github.com/microsoft/onnxruntime-genai/tree/6b7ff3ca3efa15da219050fdb4ecf8bed67875af/src/python/py/models).
