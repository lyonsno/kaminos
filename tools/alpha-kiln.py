"""Reuse a retained raw-input source; no TRELLIS inference or remeshing."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import traceback

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--input', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
a = p.parse_args()
a.output.mkdir(parents=True, exist_ok=True)
report = {'ok': False, 'phase': 'source', 'input': str(a.input), 'commands': [], 'commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()}
try:
    meta = json.loads((a.input / 'meta.json').read_text())
    source = Path(meta['source'])
    report['source'] = str(source)
    report['sourceDigests'] = {}
    for file, expected in meta['sourceDigests'].items():
        actual = hashlib.sha256((source / file).read_bytes()).hexdigest()
        report['sourceDigests'][file] = actual
        if actual != expected:
            raise ValueError(f'Raw source hash differs: {file}')
    root = Path(__file__).resolve().parent
    source_output = a.output / 'source'
    commands = [
        ('derive', [sys.executable, str(root / 'trellis-surfel-fields.py'), '--checkpoints', str(source), '--output', str(source_output)]),
        ('alpha-ladder', [sys.executable, '-u', str(root / 'alpha-carriers.py'), '--source', str(source_output), '--output', str(a.output / 'ladder')]),
    ]
    for phase, command in commands:
        report['phase'] = phase
        report['commands'].append(command)
        subprocess.run(command, check=True)
    report.update(ok=True, phase='done', ladderReport=str(a.output / 'ladder/report.json'))
except Exception:
    report['error'] = traceback.format_exc()
finally:
    (a.output / 'report.json').write_text(json.dumps(report, indent=2))
raise SystemExit(0 if report['ok'] else 1)
