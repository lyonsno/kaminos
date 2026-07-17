# Adaptive Smoke Volume GPU Falsifier R7

## Disposition

This is a **positive compact-product result and a negative online-builder result** on one exact static native-camera state.

- The independently prebuilt R40 parent field plus 614 selected R160 residual bricks renders close to dense, remains bit-identical after the dense GPU source buffer is destroyed, and occupies 1,042,576 bytes, or 6.363% of the 16,384,000-byte dense scalar field.
- The attempted on-device hierarchy, residual ranking, bitonic selection, indirection, and atlas builder does not reproduce the persisted top-614 selection. The final report rejects the optimization claim. Do not use its timing or image as product evidence.
- This experiment does not time formation of the scalar extinction field from the live 16-channel simulator state, production compositing, temporal rebuild churn, or a full scene.

## Visual Context

The image below is **not a temporal sequence**. All three panels use the same source state, camera, optics, and output dimensions. They are alternate implementation roles:

1. **Dense R160**: exact dense traversal and control. It matches the committed dense reference with maximum depth error `7.56234e-7`.
2. **Compact Prebuilt**: treatment built from the persisted R6 selection. The dense source GPU buffer is destroyed before the displayed rerender. Maximum error versus dense is `9.39794e-4`; the pre/post-destruction output hashes are identical.
3. **GPU Build + Compact**: rejected construction arm. It attempts to derive the hierarchy and top residual bricks on GPU from the dense state, then renders without a dense binding. The final selection is wrong and the visible horizontal banding/weakened structure is evidence of that failure, not an acceptable alternate appearance.

![Role-labeled dense, compact-prebuilt, and rejected GPU-built smoke depth](final/context.png)

Inspected at original resolution after Greenroom job `a70112651c8a`. Screenshot SHA-256: `970293f3b3aa9f7bc45c6c238a176fde97fb9fb96c0896282b88987cdf27d589`.

## Final Hardware Result

| Gate | Result |
| --- | --- |
| Greenroom job | `a70112651c8a`, exit `0`, no queue warnings |
| Witness timestamp | `2026-07-17T01:40:25.752Z` |
| Kaminos commit | `ffff211af4260a0700613f7cb95d873f5f8cc361`, clean worktree receipt |
| Effective route | `isolated-adaptive-volume-webgpu-v0` |
| Backend | `WebGPU:apple`; `navigatorPlatform=MacIntel`; adapter info unavailable |
| Browser | Google Chrome at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`; one persistent browser; `1600x1100` window; CDP `49413` |
| Timestamp authority | required `timestamp-query`, available |
| Source grid | R160; 4,096,000 scalar cells |
| Hierarchy | R40; 64,000 physical bricks |
| Sort domain | 65,536 records with 1,536 explicit `score=-1` sentinels; 136 bitonic stages |
| Requested selection | 614 persisted bricks, no hidden cap |
| Final selection | 614 mismatches; 624 ascending-order violations; 53.5853% retained residual energy |
| Dense denial | passed; pre/post compact output SHA `9402abe4ac4189afeefbadd442cb10de8c07417d2408c1758d225e1eddf0c42d`; maximum delta `0` |
| Compact resident bytes | 1,042,576; 6.3634% of dense scalar |
| Build scratch | 559,104 bytes |
| Product plus scratch | 1,601,680 bytes; 9.7759% of dense scalar |
| Dense render median | `0.589824 ms`; samples include a `52.887552 ms` scheduler outlier |
| Prebuilt render median | `0.262144 ms`; samples include a `29.687808 ms` scheduler outlier |
| Rejected builder combined median | build `35.192832 ms`, render `0.327680 ms`, total `35.323904 ms`; highly unstable across runs |

The render-only compact direction is faster in the final median and in prior complete diagnostics, but the sample distributions have severe Apple scheduling outliers. No stable production speedup is claimed. The online builder is invalid independently of timing because selection and sort-order gates fail.

## Source Identity

- Matched-optics report: `sha256:34cd9544b823289054558eae09247353772599fe21add665623ac8163cec9382`
- Extinction/support sidecar: `sha256:564efca0905957a8a44592309b7ce1618b14cfc486e658d92c6cd0f323b26b5a`
- Persisted R6 selection: `sha256:4bbc3105534b61a92e41e45fa2b2d52f3178a191cba95424dfb41df74ceaf8ec`
- Dense reference depth: `sha256:16002db6417d46601fe513a87954b1dc58197a4536f2a17902fe732e6b40551f`
- Final browser report: `sha256:203ceb78d1b7d03e9a04c2aa41e5fbc208eed648b5a867d857a771aa0faf1e15`
- Final witness report: `sha256:9be3a58dc22fe4b57daec769d947890b402245f68690640793f79875bac82e55`

## Commands

Focused verification:

```sh
node tests/smoke-adaptive-volume-gpu-falsifier-contracts.mjs
node tests/smoke-adaptive-residual-brick-frontier-contracts.mjs
node --check smoke-adaptive-volume-gpu-falsifier.mjs
node --check smoke-adaptive-volume-gpu-falsifier-browser.js
node --check smoke-adaptive-volume-gpu-witness.mjs
git diff --check
```

Greenroom submission:

```sh
cd /Users/noahlyons/dev/gpu-greenroom
uv run gpu-greenroom submit \
  kaminos_adaptive_smoke_volume_gpu_falsifier \
  /private/tmp/kaminos-pyro-tall-articulated-smoke-0716-r2/artifacts/pyro-smoke-adaptive-residual-bricks-r6-0716/native/b4-e0980000/selected-brick-indices.sbrk \
  /Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-pyro-adaptive-smoke-volume-gpu-r7-0716-run7
```

The exact expanded command, cwd, environment, null timeout, input, output, timestamps, and exit status are in `final/greenroom-receipt.json`.

## Diagnostic Chain

The `diagnostics/` directory preserves receipts and durable witness envelopes for the preceding runs:

| Run | Job | Disposition |
| --- | --- | --- |
| 1 | `be31058cc471` | bind-group failure followed by terminal-state polling defect; externally terminated after CDP proved failure |
| 2 | `4630bc8d1ffc` | correctly rejected stale orphan server left by forced run-1 termination |
| 3 | `ee8f121328f6` | empty marker-pass timestamp remained zero |
| 4 | `968e8d235fd8` | first complete three-arm diagnostic; exposed incomplete sort generation and wrong selection |
| 5 | `6fb64093f32a` | failed loud on non-power-of-two 64,000-record bitonic domain |
| 6 | `09e3dee50a24` | complete padded-sort diagnostic; proved ascending orientation and wrong prefix interpretation |
| 7 | `a70112651c8a` | final ascending-suffix result; rejected for 624 remaining order violations and total membership mismatch |

## Claim Boundary

R7 establishes that the **prebuilt compact representation is independently resident, visually coherent on this state, and much smaller than one dense scalar field**. It does not establish that the current GPU builder can construct the required selection truthfully or cheaply each live frame. The final builder failure is consistent with a flawed global selection implementation, not a falsification of the already-verified compact representation. A future builder should use a proven top-K primitive, radix/merge path, or CPU/low-cadence selection only if its transfer and cadence costs are charged honestly. Temporal coherence and full production economics remain unmeasured.
