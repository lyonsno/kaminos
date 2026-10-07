"""Reuse the existing JS decoder contract; do not invent a Python approximation."""
import hashlib
import json
from pathlib import Path
import subprocess

def admit_decoder_reference(manifest_path, producer, projection_path=None):
    path = Path(manifest_path); raw = path.read_bytes()
    command = ['node', str(Path(producer) / 'models/trellis2/admit-slat-decoder-reference.mjs'), str(path)]
    projection_raw = None
    if projection_path is not None:
        projection_raw = Path(projection_path).read_bytes()
        command.append(str(projection_path))
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode:
        raise ValueError('complete decoder-reference admission failed: ' + result.stderr.strip())
    admitted = json.loads(result.stdout)
    if admitted['manifestSha256'] != hashlib.sha256(raw).hexdigest():
        raise ValueError('decoder manifest changed during admission')
    if projection_raw is not None and admitted['projectionSha256'] != hashlib.sha256(projection_raw).hexdigest():
        raise ValueError('projection manifest changed during admission')
    return json.loads(raw), admitted['plan']
