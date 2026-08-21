# Operator Close-Orbit Smoke

Question: Do the two matched TRELLIS casts remain visually coherent outside the registered front/oblique witness, and can the cleaner cast tolerate GTAO without the ghosting previously caused by damaged winding?

Result: Both casts survive materially wider camera motion than the registered witness established. The broad-plane cast preserves a strong face, muzzle, horns, ears, and lateral head volume, but its rear cranial cap is visibly smoother and less authored than the source-facing side. The feature-animation cast preserves the complete skull, ear bowls, horns, muzzle, and layered ruff around the orbit. The operator could enable GTAO on the feature-animation cast without the severe ghosting seen on earlier damaged-winding outputs.

Route:

- repo: `/private/tmp/kaminos-handy-candyman-skull-muzzle-0819`
- worktree: `/private/tmp/kaminos-handy-candyman-skull-muzzle-0819`
- branch/head at capture: `cc/handy-candyman-crucible-shards-0713` / `14e855e1ff36d9ff74d904e3a5ce4e63c3323687`
- viewer: registered Kaminos scene-object importer at `http://127.0.0.1:8104/index.html`
- requested/effective reconstruction route: Greenroom `trellis2mlx_fast_checkpoint`
- backend/model: local MLX TRELLIS route selected by Greenroom
- reconstruction controls: seed `81414`, resolution `512`, steps `8`, cascade disabled, target faces `100000`, texture `512`, simplify-first enabled
- broad-plane job/source: `993fda2d72a7` / `../wave-2/seed-81413/04-faceted-fur-planes/output.png`
- feature-animation job/source: `da74d654295c` / `../wave-2/seed-81412/08-feature-animation/output.png`
- capture time: 2026-08-21 06:02-06:03 America/New_York
- capture action: operator-driven close orbit and renderer inspection through the direct Kaminos GLB routes recorded in `../result.md`

Images:

- `broad-plane-01.png`: close left-oblique/front view; strong face, muzzle, eye, horn, and ear coherence.
- `broad-plane-02.png`: near-frontal view; bilateral feature layout remains legible.
- `broad-plane-03.png`: right profile; muzzle projection and lateral skull volume survive.
- `broad-plane-04.png`: rear-left view; documents the smoother, weakly authored rear cranial cap.
- `feature-animation-01.png`: close left-oblique view with GTAO-capable surface presentation.
- `feature-animation-02.png`: near-frontal view; eyes, muzzle, horns, ears, and layered ruff remain coherent.
- `feature-animation-03.png`: elevated left-oblique view; ear interiors and ruff continuation remain readable.
- `feature-animation-04.png`: low right-oblique view; muzzle underside and ruff terminator remain closed-looking.
- `feature-animation-05.png`: rear-right view; far-side ear, horn, and layered rear ruff are explicitly completed.

SHA-256:

```text
0e5c43c653e8b1acb62b9d9ec72cc9539b0df5215045a93ef9016d47fb773492  broad-plane-01.png
70accf5b237e7c3be883b19bbfb9fb64dcf53e2a03ec4533d53bba37992302a6  broad-plane-02.png
2a668b838e63eb6b76095bf80a7180ebb279962340667fffdf9374120f01b2aa  broad-plane-03.png
07b15c7844bd0774c78931c9fb57e3cc1097c611db17468c3a375b583a8eef85  broad-plane-04.png
7ac17caadd405b75eff3cc18bce28869d44cd369e6d1c3664a68548170e75e15  feature-animation-01.png
753346f8824fe259d559749bd6136d62fa43079ced760ecea47c0e07361db7c9  feature-animation-02.png
9b30f2a436ea67d100f25588c4153588b6ad873608f0c6cedf0933b856a64dd7  feature-animation-03.png
759e6e85af1004207712d5ec14dbedfe20617cb6ef039ad6f64da40f56ad26f9  feature-animation-04.png
fbc5fa3b809a45b50535dcbea81dfc4158556eb0e40d11689e114fcc50053de1  feature-animation-05.png
```

Does not prove: watertightness, manifold topology, correct normals on every face, production retopology, riggability, collision suitability, or parity with reference CUDA TRELLIS. GTAO behaving well in the inspected views is strong visual evidence against the prior catastrophic winding failure mode, not a topology certificate.
