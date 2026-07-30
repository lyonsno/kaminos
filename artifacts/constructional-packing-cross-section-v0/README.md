# Reciprocal Constructional Packing Cross-Section V0

Question: Can a synthetic fitted-joint material domain preserve complete semantic ownership, fixed attachments, and stable material coordinates while an interior target edits the analytical envelope and an exterior edit repacks the interior?

Result: Yes for the bounded two-dimensional proxy. Baseline, interior-pressure, and exterior-compression cases all preserve single ownership, joint-clearance exclusion, and hard attachment identity. The interior target edit creates a localized envelope expansion. The exterior edit removes local flank volume and produces a new semantic partition inside the edited envelope.

Route:

- repo: `/Users/noahlyons/dev/kaminos`
- worktree: `/private/tmp/kaminos-molten-reciprocal-packing-0730`
- branch: `cc/molten-reciprocal-packing-0730`
- base commit: `0fd04ae4ee150f4cae2d4582a474b46ee7b01254`
- generation command: `node constructional-packing-witness.mjs --out-dir artifacts/constructional-packing-cross-section-v0`
- desktop capture command: `Google Chrome --headless=new --disable-gpu --hide-scrollbars --window-size=1440,1000 --screenshot=artifacts/constructional-packing-cross-section-v0/witness.png http://127.0.0.1:8137/artifacts/constructional-packing-cross-section-v0/index.html`
- narrow capture command: `Google Chrome --headless=new --disable-gpu --hide-scrollbars --window-size=500,1600 --screenshot=artifacts/constructional-packing-cross-section-v0/witness-mobile.png http://127.0.0.1:8137/artifacts/constructional-packing-cross-section-v0/index.html`
- effective route: `constructional-packing-cross-section-v0`
- backend/device: deterministic Node.js CPU lattice solver plus browser SVG witness
- source: `synthetic-fitted-hip-cross-section-v0`
- grid: `112 x 84`
- generated: `2026-07-30T16:04:05Z`

Images:

- `witness.png`: inspected desktop comparison of baseline packing, interior-pressure relaxation, and exterior-compression repacking.
- `witness-mobile.png`: inspected narrow responsive rendering of the same three states.

Hashes:

- `witness.png`: `6abbfa1e14c288a4f265bf44b603f15825ad8ea664d1970b48ae7c7e05c6ee72`
- `witness-mobile.png`: `f27a5db202f1dfe4c026367eaa59d5db5aa8cbfc584c7162b2b008ec80ea4750`
- `report.json`: `03d9d2dd326e3b95fc1e8546fb73513a83e33d6046acd4f74448b2d73e3901e9`

Does not prove: anatomical correctness, three-dimensional packing, pose-swept clearance, imported Blender compatibility, generator survival, reverse correspondence after reconstruction, or production interaction latency.
