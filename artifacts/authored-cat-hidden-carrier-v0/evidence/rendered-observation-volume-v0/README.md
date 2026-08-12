# Rendered-observation hidden-carrier volume result V0

Campaign meaning: this is the first hidden-carrier arm in which recovery does not receive source vertex correspondence or authored carrier normals. The information predicate is valid. The tested provisional spatial prior is not.

Branch classification: `UNIFORM_CONTROL_HOLDS`.

## Frozen route

- Requested/effective route: `cpu-numpy-rendered-observation-volume-v0`
- Backend: `python-numpy-cpu`
- Observation: six orthographic depth and silhouette maps at `160 x 160`
- Recovery grid: `129^3`
- Uniform volumetric depth: `0.94`
- Provisional spatial prior: base `0.94`, amplitude `1.0`, dorsal start `0.40`, AP center `0.65`, AP width `0.24`
- Authenticated held-out source SHA-256: `cf5a6ba393d40c29171d97b0e8b506d450623f3d37c079e3874371d70f296a4e`
- Rendered observation SHA-256: `006b47c83470abc04c9ad085240995d87adfd69dc5c2b49f9af90ad90b0ff3d9`
- Recovered volumes SHA-256: `c4f949d20fcec5cfca8f737085a6f1daa428394016501ee3eaffcbcbde07b4dd`
- Assay report SHA-256: `326528d2565a71f396df0dfbbba117a031b3108c0174e5a46499eb66f2dedf53`

## Held-out score

| Measure | Uniform volume | Spatial volume | Spatial change |
| --- | ---: | ---: | ---: |
| Occupancy IoU | 0.15715 | 0.09917 | worse |
| Relative volume error | -0.83921 | -0.89897 | worse |
| Source-normalized boundary error | 0.02362 | 0.02742 | 16.07% worse |
| Source-normalized procedural-support boundary error | 0.01796 | 0.04036 | 124.71% worse |
| Source-normalized complement boundary error | 0.02361 | 0.02676 | 13.31% worse |
| Mean six-view silhouette IoU | 0.47130 | 0.36436 | -0.10693 |

The uniform result is itself coarse and substantially under-volume relative to the held-out carrier visual hull. The spatial prior removes still more valid volume, especially on the held-out procedural support. This rejects the prior, not the rendered-observation route.

## Registered diagnostic

`diagnostic/registered-volume-cross-sections.png` compares all candidates against the held-out truth on one `129^3` grid and identical planes.

- Columns: outer observation volume, uniform recovery, spatial recovery.
- Top row: registered `X` plane selected by maximum truth area.
- Bottom row: registered `Z` plane at normalized AP `0.65`.
- Cyan: truth only, meaning the candidate removed valid held-out volume.
- Red: candidate only, meaning the candidate retained volume outside held-out truth.
- Off-white: overlap.
- Gold, violet, and orange borders identify the outer, uniform, and spatial columns.

Agent visual inspection: safe abstract cat-volume cross-sections. The spatial column visibly increases truth-only cyan and reduces overlap in both planes. This materially supports the numerical over-erosion verdict; it does not establish a coherent surface or production mesh.

## Information firewall and claim ceiling

Recovery consumed only rendered depth, silhouettes, camera identity, shared bounds, grid configuration, and the declared provisional prior. Source positions, source topology, vertex ids, authored normals, authored depths, procedural support, and pre-recovery correspondence were unavailable. Authenticated truth and support opened only after the recovery artifact digest was fixed.

This result establishes a source-specific negative comparison between uniform and provisional spatial volumetric erosion under a correspondence-free six-view observation route. It does not establish anatomy, arbitrary-source coat inference, fine fur or braid recovery, production grooming, deformation, or final visual admission.

Safety characterization: deterministic isolated depth, silhouette, and binary-volume evidence. No generator output, infestation, corruption, repeated-orifice, or misplaced-growth imagery is present.
