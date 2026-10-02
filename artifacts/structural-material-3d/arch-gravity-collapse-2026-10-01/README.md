# Gravity Collapse Evidence

This is an experimental CPU bonded-block arch using cannon-es 0.20.0. The controlled browser witness establishes crown collapse after a front-only support injury, new fractures after release, floor contact, and a second injury of the surviving structure. It is not GPU residency, calibrated stone, continuum fracture, or fracture of the imported visual mesh. The previous structural-volume comparison is unchanged.

## Effective Route

Open `/structural-material-arch-collapse.html` on the worktree HTTP server. The ordinary route runs continuously; `?smoke=1` pauses it for exact recorded stepping. The visible footer identifies the CPU backend and render-paced clock. Explicit Reset recreates the arch; changing mode or cohesion does not reset it. Camera movement belongs only to operator orbit and zoom commands.

`browser-r8.json.gz` passes 113 checks with zero runtime exceptions. The controlled mouse injury has 30 broken connections at release and 67 after gravity; a second injury reaches 118 without repairing old damage. Crown drop is 2.8578656 model units; final penetration is 0.0012585. All 15 captures are retained. R7's 13 frames and R8's two added live-clock frames were individually inspected: the crown tilts, breaks, and reaches the floor, then the remaining leg can fall. The live-clock run exercises the exact non-smoke URL with timestamped mouse inputs and waits, without calling manual advance during that interaction.

The first controlled grip loads only front layer 2, over four near-coplanar exposed cells with normalized weights. Subsequent picking uses current exposed faces, including rotated fallen pieces. This is a finite surface grip, not a prescribed detach sequence. Bind locally reconnects original opposing faces only when their current positions and orientations meet; it is not automatic reassembly. Positive reconnection is covered by deterministic engine contracts; this browser witness covers mode-selection non-mutation, not a successful manual reassembly gesture.

Browser: independent Chromium headless-shell, Chrome for Testing 153.0.8010.12; runtime `HeadlessChrome/153.0.8010.12`. Served source hashes and the effective executable are recorded. SwiftShader is the rendering route; these are not native GPU performance claims. Each owned browser child and temporary profile is cleaned up.

## Controls And Rejected Attempts

- `assay-r1.json.gz`: explicit hand spring. Strengths 80/160 develop explosive displacement after separation; dramatic motion is rejected. Rotations remain normalized. The strength-120 neighbor alone cannot establish a robust route.
- `assay-r2.json.gz`: soft engine point grip. Intact controls remain connected; every one-cell injury sheds one block with no post-release propagation. Useful stable control, not whole-arch collapse.
- `assay-r3.json.gz`: finite surface patch and separately measured constraint bending. Intact controls remain connected; load-bearing injury produces post-release fractures and crown fall.
- `assay-r4.json.gz` and `assay-r5.json.gz`: repeat from the actual front-face point. Strengths 80/120/160 produce 61/47/25 broken connections, with 35/30/18 after release. All intact controls remain connected over 11 simulation seconds. Mean step cost is 3.17-3.47ms in R4 and 8.09-12.48ms in R5 under concurrent browser work; shared-box CPU samples, not a ceiling.
- `browser-r1.json` and `browser-r2.json`: correct ray target, then incompatible Three/Cannon vector conversion. Exact exception and standing frames retained.
- `browser-r3.json.gz`: correct picking but only a falling chip; fails propagation acceptance.
- `browser-r4.json.gz`: controlled API-load collapse, not yet the main mouse-load route.
- `browser-r5.json.gz`: actual mouse collapse and repeated injury, then a rotated-camera pick failure caused by continuing orbit damping. R6-R8 remove damping and update the camera matrix before input rays.
- `browser-r6.json.gz`: 92 checks, desktop/mobile. R7 adds explicit operator zoom and passes 98.
- `browser-live-preflight-r1.json`: the previous harness rejects the actual non-smoke operator URL. The revised harness accepts that URL, derives its paused comparison explicitly, and also tests the continuously running route.

The physics reports and larger browser reports are gzip-compressed losslessly. `gzip -dc assay-r5.json.gz` reconstructs the exact JSON; uncompressed originals remain in the development worktree. Completion does not by itself establish acceptance. Config, source hashes, effective routes, recorded inputs, complete body/connection states, events, and step timings remain replayable. Numerical guards reject explosive floor containment, missing output, wrong identity, stale config, and inconsistent damage. The final-rest tolerance is separate from transient approximate contact.

## Reproduction

From the source worktree after dependency installation:

```sh
node tests/structural-material-arch-collapse-contracts.mjs
node tests/structural-material-arch-collapse-evidence-contracts.mjs
node structural-material-arch-collapse-assay.mjs /chosen/path/assay.json
python3 -m http.server 18434 --bind 127.0.0.1
node structural-material-arch-collapse-smoke.mjs http://127.0.0.1:18434/structural-material-arch-collapse.html /chosen/path/browser.json /path/to/independent/chrome-headless-shell
```

Inputs and output paths are explicit. Sound inputs include connection reaction, bending reaction, relative motion, event position, and an energy proxy, but no audible renderer is implemented here. Independent review records belong in the coordination repository, not this evidence directory.
