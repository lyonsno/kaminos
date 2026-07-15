# Minimum-Radius R160 Source Falsifier

## Verdict

The exact held `r160` tall-plume state with only `controls.inputRadius` changed
from `0.68` to `0.08` does not produce an admissible mature tall-plume teacher.
The change removes the earlier domain-filling ceiling failure, but the smoke
settles into a short bent plume. A continuous 685-probe maturity search from
simulation steps 95 through 779 never crossed the `0.55` vertical-rise
admission threshold. The three full adjacent captures at steps 781, 782, and
783 preserve that stable plateau.

This falsifies **minimum radius as the only source correction**. It does not
falsify Gaussian smoke representation, compositor behavior, or temporal
correspondence. No 8,192-splat fit was run because the teacher failed admission.

## Source Identity

- Held manifest: `/Users/noahlyons/.local/state/kaminos/volume-basins/operator-live-basin-0715/viewer-manifest.json`
- Held manifest SHA-256: `553fc56d90ce133095e8856ce0d54a87800d0b57e4476ea8fc847748149afa`
- Manifest diff: only `controls.inputRadius`, `0.68 -> 0.08`
- Requested/effective scene: canonical tall plume
- Effective route: `native-3d-compute-fluid-raymarch-v0`
- Prototype: `kaminos-volume-prototype-v0`
- Backend: `WebGPU:apple`
- Grid: `160^3`
- Camera identity: `sha256:ff36b843460dbc928e1f31e061fba4ab38721fa3d4c9dcc4bcf11e1e70fabc7f`
- Continuation: `same-browser-no-navigation-continuation-v0`
- Image authority: `cdp-native-canvas-clip-after-explicit-raymarch-submission-v0`

The image authority is the compositor-presented native raymarch canvas after
an explicit submission. It is not a direct mapped render texture.

## Maturity Search

The search report is
`../minimum-radius-r160-teacher-v9/teacher-capture-report.json`. Its original
`SIGINT` receipt is preserved: the run was intentionally interrupted only
after the uncapped sequence had established the plateau.

| Metric | First / minimum | Maximum / last |
| --- | ---: | ---: |
| Simulation step | 95 | 779 |
| Probe count | 1 | 685 |
| Vertical rise | 0.275238 | 0.281905 / 0.280000 |
| Lateral displacement | 0.078169 | 0.098592 / 0.085211 |
| Smoke weight | 1234.649294 | 1283.415601 / 1067.365475 |
| Live voxels | 1931 | 2399 / 1986 |

Smoke support peaked and then declined without acquiring the missing tall body.
The plateau is therefore not merely a young frame that needed a few more steps.

## Adjacent Dense Captures

Capture wall time was 107.015 seconds from report creation to completion for
three full `160^3` dense exports plus their native raymarch witnesses. Each raw
field is 262,144,000 bytes and was exported in 250 one-MiB chunks.

| Step | Raymarch SHA-256 | Dense field SHA-256 | Manifest SHA-256 | Occupied majorant bricks | Mean extinction |
| ---: | --- | --- | --- | ---: | ---: |
| 781 | `0ba4c44ed4987859c38d527b2463fc317970bd80cfc1dd1409fc39a7d100ad74` | `3885d8ea81f1514c3ab0ff098b743d604c472263cd391cdca9e703e3adcff0d5` | `0fffd994b6f18d041296110a08fc32ea6522870e025e3abc2b7ff65b6414894f` | 1989 | 0.0779793978 |
| 782 | `d476639a8892b2b62e5520df0513d54197f1dc0d747e4d6aa0b207c4b9935456` | `16e25bd82d2afaeb874324168ccf66f059a875c4c31c99e1a5faff933ec7c08f` | `790317720ca962afe75479e0851af947cf9bc6d3dab2dc47c5c691a0f6e341dd` | 1980 | 0.0782133309 |
| 783 | `d88dddcb2badcf16d588603c85bb37949b894c6bfc70f687fff83d644eeafd7a` | `c2ab74c2da579f4e3d20775aa2f758f6573ee3f0fa956ea156ccca48d536403f` | `63991e1e45cffe97eb0b8f66c1c413c96a66281c1d5ac2995f382138d77748d9` | 1975 | 0.0784148806 |

The raw fields remain beside this receipt locally. Branch-durable copies use
lossless Zstandard compression split below the forge object limit:

| Step | Part 00 SHA-256 | Part 01 SHA-256 |
| ---: | --- | --- |
| 781 | `5a2ef8584bf640095510c807e1c8f1da1599c1033a0c5dc61b3f18478992dc3f` | `4b7d1a2320689afe03c67814081234b4549fd945c3881848c9051eb7c1244d11` |
| 782 | `3e68517f9520c4234bbcc1a956ba523155e91ff1103ed237ead7c626fff5d69e` | `ebf090bd184313f6f681982008ddc2b9ec746c98b597ade6c7522a269484c1ab` |
| 783 | `b6fdff88a23109a38c5c5640c6f40a14199464fecdcb149c6b7118dbc1615ce7` | `09cc4e7c1b4b3e2437754a55b63240eef422270c8cf425b45c589f804beed816` |

Reconstruct a raw field with:

```sh
cat sim-step-781.fluid.f32.zst.part-* | zstd -d -o sim-step-781.fluid.f32
shasum -a 256 sim-step-781.fluid.f32
```

## Visual Inspection

All three adjacent raymarch artifacts were inspected at original resolution.
They show the same short, slightly bent plume with a compact head; there is no
mature articulated tall body. The requested and effective route identities are
recorded in `teacher-capture-report.json`.

- Step 781: `http://127.0.0.1:8097/index.html?kaminos_image_witness=1&image_root=smoke-oracle&image_path=minimum-radius-r160-teacher-v10-plateau%2Fsim-step-781.raymarch.png&image_title=Minimum%20radius%20plateau%20step%20781&image_authority=cdp-native-canvas-clip-after-explicit-raymarch-submission-v0&image_downgrade=source-plateau-not-admitted-teacher-no-gaussian-verdict`
- Step 782: `http://127.0.0.1:8097/index.html?kaminos_image_witness=1&image_root=smoke-oracle&image_path=minimum-radius-r160-teacher-v10-plateau%2Fsim-step-782.raymarch.png&image_title=Minimum%20radius%20plateau%20step%20782&image_authority=cdp-native-canvas-clip-after-explicit-raymarch-submission-v0&image_downgrade=source-plateau-not-admitted-teacher-no-gaussian-verdict`
- Step 783: `http://127.0.0.1:8097/index.html?kaminos_image_witness=1&image_root=smoke-oracle&image_path=minimum-radius-r160-teacher-v10-plateau%2Fsim-step-783.raymarch.png&image_title=Minimum%20radius%20plateau%20step%20783&image_authority=cdp-native-canvas-clip-after-explicit-raymarch-submission-v0&image_downgrade=source-plateau-not-admitted-teacher-no-gaussian-verdict`

## Decision Boundary

The next evidence-producing action belongs to Handy's simulator/teacher source
custody: change or select the source dynamics governing age, outflow,
production, or decay until the exact teacher admission contract yields a mature
tall plume. Once that teacher is admitted, this lane can fit the 8,192-splat
oracle without conflating source failure with Gaussian failure.
