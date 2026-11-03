# Qwen3.5 text generation

Stream text in a browser, keep a conversation alive between turns, or expand a short image prompt before sending it to an image generator. The Qwen3.5-9B adapter runs locally on WebGPU and can borrow your application's device and inference control.

Start with the [chat page](#persistent-text-chat-example) or [embed the model in your application](#use-the-model-outside-kaminos). The current checkpoint is Black Forest Labs' image-prompt fine-tune, not a general-chat checkpoint; the chat page is useful for exploring its behavior and building a repeated-turn interface. This adapter currently accepts text, not reference images.

**Source installation:** the model and generation entry point currently live on the [language source branch](https://github.com/lyonsno/kaminos/tree/cc/cranial-language-discovery-1103). Start from that checkout, not main:

```sh
git clone --branch cc/cranial-language-discovery-1103 https://github.com/lyonsno/kaminos.git kaminos-language
cd kaminos-language
npm ci
```

Use the kit and model from this source checkout together. The published kit 0.1.60 does not include the new generation entry point. The export recipe below builds a local kit tarball and a browser model module; model weights are separate.

## Model setup

Use a WebGPU-capable browser and serve your application over HTTPS or localhost. You need the retained MLX affine4/group64 BFL prompt-upsampler pack, its tokenizer, and a matching `weights.json` manifest. This port reads the packed weights directly; it does not run MLX in the browser.

Prepare the source manifest without MLX:

```sh
python3 models/qwen3_5/export-model-reference.py \
  --model-dir /path/to/retained-pack --out /path/to/package \
  --report /path/to/package/report.json --manifest-only
```

This writes metadata and hashes existing files; it does not copy or convert the model. Serve `weights.json` alongside the referenced original safetensor files, or pass separate manifest/model base URLs.

The weight server must support exact byte ranges with HTTP 206 and Content-Range. The loader verifies tensor lengths and hashes. For an existing prepared package, skip manifest preparation.

## Persistent text chat example

Chat streams each response and keeps conversation state for follow-ups. Start
a new conversation without downloading or loading the weights again. The page
uses the same `createQwenTextChat` API available to embedding applications.

Register the existing verified model package (with its matching `weights.json`
manifest) through Kaminos's shared installation catalog:

```sh
python3 model_installations.py register qwen35 --root /path/to/model
python3 serve.py
```

Open `/models/qwen3_5/chat.html` on that Kaminos server. The page resolves the
registered package through `/api/runtime-config`; the separate `pup` ONNX
installation remains available. Load and each Send use the server's queued GPU
admission, releasing the execution lease between turns while retaining weights
and conversation state. A server without Greenroom reports unconfigured
admission; an unreachable or broken admission service fails visibly.

The page provides streaming messages, Stop, New conversation, Unload model and
Save conversation. A blank reply limit uses available model/device context;
context exhaustion is reported rather than trimming history. Per-turn timing
and reused/evaluated input counts make repeated interactions useful performance
observations. Saved conversations include admission receipts. This example
owns a standalone device; embedding apps can supply their existing model/control
through the same chat API.

## Use the model outside Kaminos

Export an ordinary ES module for your application. The exported model uses the
installed inference kit for generation, sampling and shared attention kernels;
it does not require a Kaminos server or a separate Qwen npm package. Weights and
application GPU admission remain owned by the consuming application.

For this branch, install a locally packed kit: the new generation export is not
part of the previously published 0.1.60 package.

```sh
# From this checkout, with its npm dependencies installed (including esbuild).
mkdir -p /path/to/artifacts
npm pack ./webgpu-inference-kit --pack-destination /path/to/artifacts
node models/qwen3_5/export-browser.mjs --out /path/to/app/model
cd /path/to/app
npm install /path/to/artifacts/kaminos-webgpu-inference-kit-0.1.60.tgz
```

An application bundler resolves the package imports normally. With plain browser
modules, map `@kaminos/webgpu-inference-kit/core` and
`@kaminos/webgpu-inference-kit/generation` to the installed package's
`src/core.js` and `src/generation.js` using an import map.

```js
import {createWebGpuInferenceControl} from '@kaminos/webgpu-inference-kit/core';
import {Qwen35TextModel, QwenTokenizer, createQwenTextChat} from './model/qwen-text.js';

// device is the application's WebGPU device. manifest and tokenizerJson are
// the verified model package's weights.json and tokenizer.json.
const control = createWebGpuInferenceControl({queue: device.queue});
const model = new Qwen35TextModel(device, manifest, {
  control, singleTokenKernel: 'quad', batchDecode: true,
  decodeAttention: 'single-query',
});
await model.load(modelUrl);
const capacity = Math.min(model.config.maxPositions,
  Math.floor(model.bindingBytes / (model.config.kvHeads * model.config.headDim * 4)));
const chat = createQwenTextChat({model, control, capacity,
  tokenizer: new QwenTokenizer(tokenizerJson), systemPrompt: 'Help develop visual ideas.'});
try {
  const reply = await chat.send({text: 'Describe a tiny brass robot.', onText: (_, full) => render(full)});
  await chat.reset({systemPrompt: 'Answer conversationally and briefly.'});
  // The next send uses the new instruction; the model weights stay loaded.
} finally {
  await chat.dispose();
  await model.destroy();
  await control.close();
}
```

The exporter writes `qwen-text.js` and the accompanying license notices. It
contains no model weights; the checkpoint's own license still applies to them.

In the chat page the system instruction stays editable while weights are loaded.
Click **New conversation** to apply it; successful reset clears transcript and
hybrid cache. Saved turns retain the instruction that was effective for each
turn. Editing the field alone does not rewrite an ongoing conversation.

## Expand an image prompt

Use `expandPupText` for BFL's text-to-image prompt framing and streamed decoding. In an exported application, import the model, tokenizer and helper from `qwen-text.js`; inside this checkout:

```js
import { Qwen35TextModel } from './text-model.js';
import { expandPupText } from './pup-text.js';
import { QwenTokenizer } from '../flux2-klein/qwen-tokenizer.js';

// device/control come from the host's existing inference invocation.
const manifest = await (await fetch(weightsManifestUrl)).json();
const model = new Qwen35TextModel(device, manifest, { control });
await model.load(modelBaseUrl, { signal, onProgress });
const tokenizer = new QwenTokenizer(await (await fetch(tokenizerUrl)).json());

try {
  const result = await expandPupText({
    model, tokenizer, prompt, systemPrompt, signal, control,
    onText: (delta, text) => updateEditablePrompt(text),
  });
  // result.finishReason distinguishes EOS from output-length/cache exhaustion.
  consumeExpandedPrompt(result.text, result.finishReason);
} finally {
  await model.destroy(); // preserves the borrowed device and control
}
```

Keep the model loaded across requests when building an interactive editor. The example destroys it only when the feature is finished; it does not destroy the borrowed device or inference control.

## Runtime and implementation reference

The [generation API](https://github.com/lyonsno/kaminos/tree/cc/cranial-language-discovery-1103/webgpu-inference-kit/docs/autoregressive-generation.md) describes sampling, cancellation and persistent sessions. [Implementation and validation](IMPLEMENTATION.md) covers weight layout, hybrid attention/recurrent state, optional kernels, numerical comparisons and profiling commands.
