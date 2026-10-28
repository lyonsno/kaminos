"""Small local-policy fixture using the three schemas observed on the live FLUX.3 mount.

External conformance uses retained observed manifests and real HTTP range reads,
not these synthetic payloads.
"""
import json
from pathlib import Path


def image_package(root, family='flux3'):
    root = Path(root)
    payload = bytes(range(256))
    bundle = {'file': 'weights.bin', 'bytes': len(payload), 'tensors': [{'name': 'weight', 'shape': [128], 'offset': 0, 'bytes': 256}]}
    manifests = {
        'te': {'schema': f'kaminos.{family}-klein.text-encoder-weights.v1', 'config': {'hidden_size': 128},
               'layers': 1, 'taps': [1], 'bundles': {'layer00': bundle},
               'embedding': {'file': 'te-embed.bin', 'shape': [2, 64], 'row_bytes': 128}, 'tokenizer': {'file': 'tokenizer.json'}},
        'dit': {'schema': f'kaminos.{family}-klein.transformer-weights.v1', 'config': {'num_layers': 1, 'num_single_layers': 1},
                'bundles': {name: bundle for name in (('globals', 'double00', 'single00') if family == 'flux2' else ('globals', 'txt00', 'img00', 'single00'))}},
        'vae': {'schema': 'kaminos.flux2-klein.vae-decoder-weights.v0', 'config': {'latent_channels': 32}, 'bundle': bundle},
    }
    for part, manifest in manifests.items():
        (root / part).mkdir(parents=True, exist_ok=True)
        (root / part / 'manifest.json').write_text(json.dumps(manifest))
        (root / part / 'weights.bin').write_bytes(payload)
    (root / 'te' / 'te-embed.bin').write_bytes(payload)
    (root / 'te' / 'tokenizer.json').write_text('{}')
    return root


def flux3_package(root):
    return image_package(root)
