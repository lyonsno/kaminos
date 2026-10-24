#!/usr/bin/env python3
"""Kaminos browser-hand smoke: local assets and evidence only, no model inference."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
import threading
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
REGRESSOR_SHA = '8de28f843240f88c836cd45104ae3203b0e8660180202ec8c44f926da42624bf'

class HandRecords:
    def __init__(self, root):
        self.root = root
        self.lock = threading.Lock()

    def write(self, record):
        payload, kind = record['payload'], record['kind']
        session = payload.get('sessionId') if kind == 'event' else payload['request']['sessionId']
        key = payload.get('captureId') if kind == 'capture' else 'events'
        if kind not in ('capture', 'event') or any(not isinstance(x, str) or not re.fullmatch(r'[A-Za-z0-9_-]+', x) for x in (session, key)):
            raise ValueError('Invalid hand record identity')
        body = json.dumps(payload, allow_nan=False)
        with self.lock:
            directory = self.root / session
            directory.mkdir(parents=True, exist_ok=True)
            if kind == 'capture':
                temporary = directory / (key + '.tmp')
                temporary.write_text(body + '\n')
                temporary.replace(directory / (key + '.json'))
            else:
                with (directory / 'events.jsonl').open('a') as stream:
                    stream.write(body + '\n')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, required=True)
    parser.add_argument('--models', type=Path, required=True)
    parser.add_argument('--joint-regressor', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    report = {'status': 'loading', 'phase': 'assets', 'inference': 'browser-webgpu-only', 'repoRoot': str(ROOT), 'models': str(args.models.resolve()), 'port': args.port}
    def save():
        (args.output / 'server.json').write_text(json.dumps(report, indent=2) + '\n')
    save()
    try:
        import numpy as np
        raw = args.joint_regressor.read_bytes()
        if hashlib.sha256(raw).hexdigest() != REGRESSOR_SHA:
            raise ValueError('Upstream joint regressor hash mismatch')
        weights = np.load(args.joint_regressor, allow_pickle=False)
        if weights.shape != (21, 778) or not np.isfinite(weights).all():
            raise ValueError('Invalid upstream joint regressor')
        joints = {'sourceSha256': REGRESSOR_SHA, 'basis': 'upstream_j_reg_mano_to_mpii', 'weights': weights.tolist()}
        sys.path.insert(0, str(ROOT))
        import serve
        records = HandRecords(args.output)
        class Handler(serve.KaminosHandler):
            def do_GET(self):
                path = urlparse(self.path).path
                if path == '/__hand-models/joints.json':
                    return self.send_json(joints)
                if path.startswith('/__hand-models/'):
                    name = path.removeprefix('/__hand-models/')
                    if name not in ('mobrecon.package.json', 'mobrecon.bin', 'detector.package.json', 'hand-detector.bin'):
                        return self.send_json({'error': 'Unknown model asset'}, 404)
                    file = args.models / name
                    if not file.is_file():
                        return self.send_json({'error': 'Missing model asset'}, 404)
                    data = file.read_bytes()
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json' if name.endswith('.json') else 'application/octet-stream')
                    self.send_header('Content-Length', str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
                    return
                super().do_GET()

            def do_POST(self):
                if urlparse(self.path).path != '/api/hand-record':
                    return super().do_POST()
                if self.headers.get('Origin') != f'http://127.0.0.1:{args.port}':
                    return self.send_json({'error': 'Origin mismatch'}, 403)
                try:
                    records.write(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
                    self.send_json({'retained': True})
                except Exception as error:
                    self.send_json({'error': str(error)}, 400)
        serve.PORT = args.port
        report.update(status='serving', phase=None, jointRegressorSha256=REGRESSOR_SHA)
        with serve.KaminosServer(('127.0.0.1', args.port), Handler) as server:
            save()
            server.serve_forever()
    except BaseException as error:
        report.update(status='stopped' if isinstance(error, KeyboardInterrupt) else 'failed', error=str(error))
        raise
    finally:
        save()

if __name__ == '__main__':
    main()
