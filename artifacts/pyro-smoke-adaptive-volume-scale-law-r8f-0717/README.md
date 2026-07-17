# Adaptive Smoke Volume Scale Law R8f

Question: Can a truthful R40 parent field plus sparse R160 residual bricks beat dense R160 scalar traversal at larger ray workloads without violating the fixed `0.001` maximum optical-depth error gate?

Result: Yes on this isolated static single-channel route. The smallest measured passing arm retains `99.9001%` residual energy with 1,326 of 64,000 bricks. It is neutral at 320x228, 14.4% faster at 640x456, and 17.1% faster at 1280x912. Maximum error is `0.000900801` at the largest workload, with zero violating rays. This is a positive scale-law result, not a production-compositor or total-frame result.

## Positive Arm: 99.9%

- Greenroom job: `857738ba09df`
- Timestamp: `2026-07-17T19:17:17.608Z`
- Commit: `1b04f3e0d349aa9dcf88c329092ff749a39cd6c9`
- Branch/worktree: `cc/pyro-tall-articulated-smoke-0716`; `/private/tmp/kaminos-pyro-tall-articulated-smoke-0716-r2`
- Effective route: `isolated-adaptive-volume-webgpu-v0`
- Backend/device: `WebGPU:apple`; CDP `ANGLE Metal Renderer: Apple M4 Max`; required `timestamp-query`
- Selection: `b4-e0999000`; 1,326 bricks; SHA-256 `8e35bf7337b62ddd1d75afeeef7960b2691a4301fb00bd5578a250c44f64f72a`
- Product memory: `1,657,744` bytes, `10.1181%` of the dense scalar allocation; product plus builder scratch is `2,216,848` bytes, `13.5306%`
- Timing protocol: 16 dispatches per timestamp envelope, seven paired steady samples, separate dense/compact submissions, alternating pair order
- Builder checks: zero selection mismatches, zero sort violations, complete 65,536-record bitonic domain, dense source destroyed before compact rerender

| Workload | Dense | Compact | Compact/dense | Maximum error | p99.99 error | Over gate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 320x228 | `0.147456 ms` | `0.147456 ms` | `1.0000` | `0.000318237` | `0.000209540` | 0 |
| 640x456 | `0.512000 ms` | `0.438272 ms` | `0.8629` | `0.000289276` | `0.000193715` | 0 |
| 1280x912 | `1.937408 ms` | `1.605632 ms` | `0.8295` | `0.000900801` | `0.000198946` | 0 |

Command:

```sh
/Users/noahlyons/dev/gpu-greenroom/.venv/bin/gpu-greenroom submit \
  kaminos_adaptive_smoke_volume_gpu_falsifier_url \
  /private/tmp/kaminos-pyro-tall-articulated-smoke-0716-r2/artifacts/pyro-smoke-adaptive-residual-bricks-r8f-0717/native/b4-e0999000/selected-brick-indices.sbrk \
  /Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-pyro-adaptive-smoke-volume-scale-law-r8f-e0999-0717-run1 \
  --cwd /private/tmp/kaminos-pyro-tall-articulated-smoke-0716-r2 \
  -p 'url=http://127.0.0.1:19137/smoke-adaptive-volume-gpu-falsifier.html?selection=./artifacts/pyro-smoke-adaptive-residual-bricks-r8f-0717/native/b4-e0999000/selected-brick-indices.sbrk'
```

## Images And Roles

- `positive-e0999/context.png`: primary positive context. Left is dense R160, middle is compact prebuilt after dense-source destruction, and right is the GPU-built compact product. These panels show the native 320x228 state; the table below them reports the amplified three-workload scale law and numerical gates. The image does not visualize a production compositor.
- `parity-control-e100/context.png`: full-selection control. Every brick is refined, so its role is to prove the sparse traversal shares the dense global quadrature lattice. It is not an economic candidate; resident product memory is over three times the dense scalar field and traversal is about 2.7x slower.
- The 99.5% near miss has no preserved image because its visual panels are not diagnostic of the single high-resolution violating ray. Its JSON reports preserve the failure.

The positive and parity-control images were inspected at original resolution. They are nonblank, panels and roles are legible, no UI element obscures the comparisons, and the positive table shows zero gate violations at every workload.

## Controls And Near Miss

- Full-selection control: Greenroom `f1e90f8894b2`, commit `fb3e3fe5`, maximum error `7.45e-9..1.49e-8`, valid scale-law packet. This falsified the earlier brick-boundary quadrature restart and proves the aligned traversal path.
- 99.5% near miss: Greenroom `a16a442bb8ec`, commit `3938f691`, 953 bricks. It preserves a 19.7% high-scale win but leaves one 1280x912 ray over the gate (`0.00336724`), so its packet is `invalid-for-scale-law-claim`.
- 99% diagnostic: it preserves a 19.0% high-scale win but leaves 33 high-resolution rays over the gate. Energy-only support below the 99.9% knee is not accepted.

## Hashes

| Artifact | SHA-256 |
| --- | --- |
| `positive-e0999/witness-report.json` | `7e311f53f3c8eade5c1a3b4e82d04e5bd5b1482126479f0ad2690fd7952151d9` |
| `positive-e0999/browser-report.json` | `e14fc61f53a6a83e6ff07f1342a248f7e1ddb90b20678606e2c02e51f2df7d61` |
| `positive-e0999/context.png` | `5bb2348b6edbec1e7b8dd61a4ed35d634295019084bd7d25e34597b4fd3596f7` |
| `parity-control-e100/witness-report.json` | `7c6e3ff5ffce3ae557855807af24edd7f232385ad25b57a4303ae3800a8c3870` |
| `parity-control-e100/browser-report.json` | `9c3ec096e03af581f1319b9e47a106c3999569e748da24ebeab7a21653bb162a` |
| `parity-control-e100/context.png` | `3b5e4cc14094141d943951b1196174a0e98132af7346a62f828d7fd4d3a0d7df` |
| `near-miss-e0995/witness-report.json` | `95b4d43f02c5cd09243b889f8f3d54e146da71a0608fb63517292eec18c1deb6` |
| `near-miss-e0995/browser-report.json` | `37de0bc98dfb149bc53e9589e52eb95370c31b5591218044672058e5d27be584` |

## Route Review

- Known-good local runner checked: yes, `/Users/noahlyons/dev/gpu-greenroom/.venv/bin/gpu-greenroom`, using the previously proven Node/Chrome witness route.
- Effective env/device/backend preserved: Node `25.9.0_2`, Chrome CDP, `WebGPU:apple`, Apple M4 Max Metal renderer, no fallback backend, no run timeout, one persistent browser.
- First receipt proves backend/device: yes; `witness-report.json` records CDP Apple/Metal identity and `timestamp-query` availability.
- Heavy run accepted before proof: no.

## Claim Boundary

R8f measures static, isolated, pre-absorption scalar traversal for one exact R160 state and one camera with three pixel workloads. Static source inspection confirms that production `volume-core.js` additionally performs a majorant grid, occupancy skipping, adaptive rays, early transmittance termination, and five live-field samples; R8f does not measure those stages or identify the production bottleneck. It does not charge formation of extinction from the live 16-channel simulator state, temporal selection churn, synchronization, double buffering, full production shading/composition, or total frame time. It does not reduce simulator work.

The result is sufficient to resume research with a production-shaped isolated comparator. It is not sufficient to integrate, land main, or claim a shipped speedup.
