# Ray-Start Blue Noise

64-LDR-L0.png is unchanged Data/64_64/LDR_LLL1_0.png from Christoph Peters'
FreeBlueNoiseTextures.zip, downloaded from
https://momentsingraphics.de/Media/BlueNoise/FreeBlueNoiseTextures.zip.
The texture database is dedicated to the public domain under CC0:
https://momentsingraphics.de/BlueNoise.html.
COPYING.txt and LICENSE.txt retain the upstream licensing.

The renderer reads the red channel as linear numeric data, without sRGB
decoding or filtering. It tiles in volume render-target pixel coordinates.
The phase is static across frames, not temporal noise or temporal accumulation.
Off retains the existing half-step camera start. Full-grid coefficient capture
retains native cell centers. This redistributes ray sampling error; it does not
repair lattice artifacts already present in coefficients or lighting.
