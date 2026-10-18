# Ray Sampling Noise

64-LDR-L0.png is unchanged Data/64_64/LDR_LLL1_0.png from Christoph Peters'
FreeBlueNoiseTextures.zip, downloaded from
https://momentsingraphics.de/Media/BlueNoise/FreeBlueNoiseTextures.zip.
The texture database is dedicated to the public domain under CC0:
https://momentsingraphics.de/BlueNoise.html.
COPYING.txt and LICENSE.txt retain the upstream licensing.

The Peters texture remains as historical comparison data. The active sampling
texture is `fast-scalar-temporal.png`: a lossless row-major 8x4 atlas of the 32
128x128 `real_uniform_gauss1_0_exp0101_separate05_*.png` slices from
[Electronic Arts FAST](https://github.com/electronicarts/fastnoise/tree/2cf53e4bb510d07511fe63a312556d2a2e108c70),
`noise.zip`, under the BSD-3-Clause terms retained in `FAST-LICENSE.txt`.
`fast-scalar-temporal.provenance.json` records archive, individual upstream
slice, and repacked atlas SHA-256s. No sample values were modified.

Read the red channel as linear numeric data, without sRGB decoding or filtering,
at volume render-target pixel coordinates. Static sampling uses slice zero;
animation advances one precomputed slice per presentation frame, wrapping at 32,
including while the simulation is held. Per-probe dimensions use fixed R2
spatial offsets, following the upstream design guide. Frame-dependent spatial
shifts or scalar rotations would scramble the optimized temporal sequence.

Current adaptive uses this for ray starts. Standard and numerical quadrature
also jitter their two interior quarter probes within the central half of each
half-panel; midpoint and endpoints remain shared anchors. Integrals use actual
node spacing. Refinement retains each cached probe's position as well as its
material value. Noise off retains regular quadrature and the half-step Current
start; full-grid coefficient capture retains native cell centers.

This is raw animated sampling, not image-history accumulation or a temporal
denoiser. The texture is optimized for spatial Gaussian and temporal exponential
filters; that does not establish a perceptual win in our unfiltered renderer.
Adaptive decisions also change per-ray sample dimensions. Neither arbitrary
adaptive trajectories nor their quadrature errors are claimed to preserve the
texture's exact spectrum. Operator comparison is needed. This redistributes
sampling error; it does not repair artifacts already in coefficients or lighting.
