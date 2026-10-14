"""Dump every stage of the accepted rembg-u2net route (TRELLIS2MLX preprocess +
rembg 2.0.76, onnxruntime CPU) for opaque photos, for u2net-webgpu-witness.mjs.

python models/u2net/export-rembg-photo-reference.py <out dir> <photo> [<photo> ...]
"""
import sys, json, hashlib, os, numpy as np
from PIL import Image
from rembg import new_session, remove
session = new_session('u2net', providers=['CPUExecutionProvider'])
out = sys.argv[1]; os.makedirs(out, exist_ok=True); rows = {}
h = lambda a: hashlib.sha256(np.ascontiguousarray(a).tobytes()).hexdigest()
for path in sys.argv[2:]:
    name = os.path.splitext(os.path.basename(path))[0]; d = os.path.join(out, name); os.makedirs(d, exist_ok=True)
    img = Image.open(path)
    assert img.mode != 'RGBA' or np.all(np.array(img)[:, :, 3] == 255), 'opaque photo expected'
    src = np.array(img.convert('RGB')); src.tofile(d + '/source-rgb.u8')
    scale = min(1, 1024 / max(img.size))
    if scale < 1: img = img.resize((int(img.width * scale), int(img.height * scale)), Image.Resampling.LANCZOS)
    img = img.convert('RGB'); pre = np.array(img); pre.tofile(d + '/pre-rgb.u8')
    small = np.array(img.resize((320, 320), Image.Resampling.LANCZOS)); small.tofile(d + '/rgb320.u8')
    feeds = session.normalize(img, (0.485, 0.456, 0.406), (0.229, 0.224, 0.225), (320, 320))
    x = list(feeds.values())[0]; x.astype('<f4').tofile(d + '/input.f32')
    pred = session.inner_session.run(None, feeds)[0][:, 0, :, :]; pred.astype('<f4').tofile(d + '/pred.f32')
    mask = session.predict(img)[0]; np.array(mask).tofile(d + '/mask.u8')
    cut = remove(img, session=session); rgba = np.array(cut); rgba.tofile(d + '/cutout-rgba.u8')
    rows[name] = {'source': list(img.size if scale == 1 else Image.open(path).size), 'pre': [img.width, img.height],
                  'sha': {'pre': h(pre), 'rgb320': h(small), 'input': h(x.astype('<f4')), 'pred': h(pred.astype('<f4')), 'mask': h(np.array(mask)), 'cutout': h(rgba)}}
json.dump(rows, open(out + '/stages.json', 'w'), indent=1); print(json.dumps({k: v['pre'] for k, v in rows.items()}))
