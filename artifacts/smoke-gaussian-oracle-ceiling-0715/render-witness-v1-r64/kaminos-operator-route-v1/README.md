# Smoke Oracle Kaminos Operator Route Witness

Question: Can the operator open each matched raymarch/Gaussian/difference contact sheet through a first-class Kaminos route that records requested/effective source identity and fails on missing or blank image output?

Result: Yes. The exact sim-step 92, 93, and 94 routes rendered full-screen inside Kaminos and reported `registered`. Each decoded the expected `609x753` contact sheet. Sampled nonblank pixel counts were `7783`, `7758`, and `7739` respectively. Visual inspection confirmed that all three routes preserve the teacher, Gaussian proxy, and difference columns without UI occlusion.

Route:

- repo/worktree: `/private/tmp/kaminos-smoke-oracle-ceiling-eater-live-0715`
- branch/source head at capture: `cc/smoke-oracle-ceiling-eater-live-0715@2edfcda` plus the image-route implementation committed with this directory
- server command: `python3 serve.py 8097`
- browser: Google Chrome headless, `1440x1000`, `--virtual-time-budget=8000`
- requested root: `smoke-oracle`
- effective source route: `/api/read?root=smoke-oracle&path=render-witness-v1-r64%2Fsim-step-<92|93|94>%2Forthographic-render-contact-sheet.png`
- image authority: `matched-raymarch-vs-cpu-orthographic-gaussian-proxy`
- downgrade: `not-native-camera/not-production-compositor`
- capture date: `2026-07-15`

Images:

- `kaminos-image-route-step-92.png`: exact operator route for sim-step 92; SHA-256 `641cc9e219735d16de3585a36093c073bbfa163cf94ec281de7759ea92df6a66`.
- `kaminos-image-route-step-93.png`: exact operator route for sim-step 93; SHA-256 `2566429fc2e4bfcecec801b52a97fbd6c31cb2caec984ea7e5256d8ce6250dc8`.
- `kaminos-image-route-step-94.png`: exact operator route for sim-step 94; SHA-256 `6a9ff5ea22358579ebd45f58e41e6b85327b699af6a5c0d6b72d8f304aab4f6f`.

Does not prove: These routes prove source registration, nonblank visual mounting, and operator-visible route/authority labels. They do not upgrade the underlying orthographic CPU luma proxy into native-camera, production-compositor, held-out-view, or final Gaussian representation evidence.
