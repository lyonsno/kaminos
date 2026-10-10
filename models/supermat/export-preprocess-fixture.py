"""Write small Pillow-produced preprocessing cases for the browser port's contract test.

Each case is a deterministic RGBA image, Pillow's BILINEAR resize of it, and
the source's float32 gray composite (src/utils.load_rgba_image_as_rgb_tensor).
"""
import argparse
import base64
import json
from pathlib import Path

import numpy as np
from PIL import Image
import PIL

CASES = [('downscale-odd', (37, 23), (16, 16)), ('upscale', (13, 9), (32, 32)),
         ('identity', (8, 8), (8, 8)), ('downscale-even', (24, 24), (12, 12))]


def rgba_case(size, seed):
    rng = np.random.default_rng(seed)
    w, h = size
    rgba = rng.integers(0, 256, size=(h, w, 4), dtype=np.uint8)
    alpha = rgba[:, :, 3]
    alpha[rng.random((h, w)) < 0.3] = 0
    alpha[rng.random((h, w)) < 0.3] = 255
    return rgba


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--out', type=Path, required=True)
    args = p.parse_args()
    cases = []
    for index, (name, size, target) in enumerate(CASES):
        rgba = rgba_case(size, 1000 + index)
        resized = np.asarray(Image.fromarray(rgba, 'RGBA').resize(target, Image.BILINEAR))
        values = resized.astype(np.float32) / 255.0
        rgb = values[:, :, :3] * values[:, :, 3:4] + 0.5 * (1.0 - values[:, :, 3:4])
        chw = np.ascontiguousarray(rgb.transpose(2, 0, 1), dtype='<f4')
        cases.append({'name': name, 'width': size[0], 'height': size[1], 'targetWidth': target[0],
                      'targetHeight': target[1], 'rgba': base64.b64encode(rgba.tobytes()).decode(),
                      'resized': base64.b64encode(resized.tobytes()).decode(),
                      'composite': base64.b64encode(chw.tobytes()).decode()})
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps({'schema': 'supermat.preprocess-cases.v0', 'pillow': PIL.__version__,
                                    'numpy': np.__version__, 'cases': cases}, indent=1) + '\n')


if __name__ == '__main__':
    main()
