"""Load MobRecon (DenseStack + SpiralConv) from the pinned HandMesh source.

Construction matches the released real-world configuration the native live
route uses: cmr.models.mobrecon_densestack.MobRecon with out_channels
[32, 64, 128, 256], DSConv disabled, spiral length 9 and dilation 1, built from
the source's own template/transform.pkl and preprocess_spiral.
"""
import hashlib
from pathlib import Path
import pickle
import subprocess
import sys
from types import SimpleNamespace

import numpy as np

SOURCE_REVISION = '3c87e958d4855f890e3884ec94bcfc0f99422c3d'
CHECKPOINT_SHA256 = '2b634114dadb324802c9e55a8b7a9236f0e7b476157ac0b175f0eb258d9d276c'
TRANSFORM_SHA256 = '78877f06e9858bedd5fbca13692ccee25cfe09b6314e7ee3b3d0827c39979f3c'
OUT_CHANNELS = [32, 64, 128, 256]
SPIRAL_LENGTH = 9
CROP_SIZE = 128


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def check_source(upstream, checkpoint):
    """Refuse a moved or dirty source, or a different checkpoint/topology."""
    upstream = Path(upstream).resolve()
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=upstream, text=True).strip()
    dirty = subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=upstream, text=True)
    if revision != SOURCE_REVISION or dirty:
        raise ValueError(f'HandMesh source must be clean {SOURCE_REVISION}, found {revision}{" (dirty)" if dirty else ""}')
    checkpoint_sha = digest(checkpoint)
    if checkpoint_sha != CHECKPOINT_SHA256:
        raise ValueError(f'checkpoint sha256 {checkpoint_sha} is not the released DenseStack+SpiralConv checkpoint')
    transform_sha = digest(upstream / 'template/transform.pkl')
    if transform_sha != TRANSFORM_SHA256:
        raise ValueError(f'template/transform.pkl sha256 {transform_sha} does not match')
    return {'sourceRevision': revision, 'sourceRoot': str(upstream), 'checkpointSha256': checkpoint_sha,
            'transformSha256': transform_sha}


def load_transforms(upstream):
    with (Path(upstream) / 'template/transform.pkl').open('rb') as stream:
        return pickle.load(stream, encoding='latin1')


def load_model(upstream, checkpoint):
    """Returns (model in eval mode, transforms, spirals as numpy [N_l, 9] per level)."""
    import torch
    upstream = Path(upstream).resolve()
    if str(upstream) not in sys.path:
        sys.path.insert(0, str(upstream))
    from cmr.models.mobrecon_densestack import MobRecon
    from utils.utils import preprocess_spiral
    transforms = load_transforms(upstream)
    spirals = [preprocess_spiral(transforms['face'][i], SPIRAL_LENGTH, transforms['vertices'][i], 1) for i in range(4)]
    up = []
    for transform in transforms['up_transform']:
        coo = transform.tocoo()
        up.append((torch.as_tensor(coo.row, dtype=torch.long), torch.as_tensor(coo.col, dtype=torch.long),
                   torch.as_tensor(coo.data, dtype=torch.float32)))
    model = MobRecon(SimpleNamespace(out_channels=OUT_CHANNELS, dsconv=False), spirals, up)
    state = torch.load(checkpoint, map_location='cpu', weights_only=True)
    model.load_state_dict(state.get('model_state_dict', state), strict=True)
    model.eval()
    return model, transforms, [s.numpy().astype(np.int64) for s in spirals]


def crop_rgb(rgb, crop_box, handedness):
    """The native route's crop: square box to 128x128 (x0->0, x1->127), left hands flipped."""
    import cv2
    x0, y0, x1, y1 = map(float, crop_box)
    if not np.isfinite([x0, y0, x1, y1]).all() or x1 <= x0 or y1 <= y0:
        raise ValueError('invalid_crop_box')
    if handedness not in ('left', 'right'):
        raise ValueError('unknown_handedness')
    mapping = np.array([[127 / (x1 - x0), 0, -127 * x0 / (x1 - x0)],
                        [0, 127 / (y1 - y0), -127 * y0 / (y1 - y0)]], dtype=np.float32)
    crop = cv2.warpAffine(np.ascontiguousarray(rgb), mapping, (CROP_SIZE, CROP_SIZE), borderMode=cv2.BORDER_CONSTANT)
    return crop[:, ::-1].copy() if handedness == 'left' else crop


def network_input(crop):
    """utils.vis.base_transform at size 128: /255, (x-0.5)/0.5, HWC -> CHW."""
    x = crop.astype(np.float32) / 255
    x -= 0.5
    x /= 0.5
    return x.transpose(2, 0, 1)
