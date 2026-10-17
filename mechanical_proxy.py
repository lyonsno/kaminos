"""Durable, queued mechanical-proxy jobs; no numerical work in the HTTP process."""
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import threading
import time
import uuid

ROUTE = 'kaminos.mechanical-proxy.wildmeshing.v1'


def write_json(path, value):
    path = Path(path)
    temporary = path.with_suffix('.tmp-' + uuid.uuid4().hex)
    temporary.write_text(json.dumps(value, allow_nan=False))
    temporary.replace(path)


def validate_input(request):
    if not isinstance(request, dict):
        raise ValueError('Mesh and settings required')
    positions, triangles, settings = (request.get(k) for k in ('positions', 'triangles', 'settings'))
    def number(v):
        return type(v) in (float, int) and math.isfinite(v)
    if not isinstance(settings, dict) or any(not number(settings.get(k)) or settings[k] <= 0 for k in ('envelope', 'spacing', 'budgetSeconds')):
        raise ValueError('Positive finite tolerance, spacing and trial budget required')
    if not isinstance(positions, list) or not positions or any(not isinstance(p, list) or len(p) != 3 or not all(number(v) for v in p) for p in positions):
        raise ValueError('Finite mesh positions required')
    if not isinstance(triangles, list) or not triangles or any(not isinstance(t, list) or len(t) != 3 or len(set(t)) != 3 or any(type(i) is not int or i < 0 or i >= len(positions) for i in t) for t in triangles):
        raise ValueError('Valid triangle indices required')
    diagonal = math.sqrt(sum((max(p[a] for p in positions)-min(p[a] for p in positions))**2 for a in range(3)))
    if not math.isfinite(diagonal) or diagonal <= 0:
        raise ValueError('Nonzero mesh extent required')
    geometry = {'positions': positions, 'triangles': triangles}
    digest = hashlib.sha256(json.dumps(geometry, separators=(',', ':'), allow_nan=False).encode()).hexdigest()
    return {**geometry, 'settings': {k: settings[k] for k in ('envelope', 'spacing', 'budgetSeconds')}, 'source': request.get('source', {}), 'sourceDigest': digest, 'diagonal': diagonal, 'route': ROUTE}


class MechanicalProxyService:
    def __init__(self, repo_root, store, python=None, greenroom=None, queue_dir=None):
        self.repo = Path(repo_root).resolve()
        self.store = Path(store).expanduser().resolve()
        self.python = python or os.environ.get('KAMINOS_MECHANICAL_PROXY_PYTHON')
        self.greenroom = greenroom or shutil.which('gpu-greenroom')
        self.queue = Path(queue_dir or os.environ.get('GPU_GREENROOM_DIR', '~/.local/state/gpu-greenroom')).expanduser().resolve()
        self.lock = threading.Lock()

    def directory(self, identity):
        if not re.fullmatch(r'[a-f0-9]{32}', identity or ''):
            raise ValueError('Valid proxy result id required')
        return self.store / identity

    def start(self, request):
        data = validate_input(request)
        with self.lock:
            for row in self.list(data['sourceDigest']):
                if row['status'] == 'passed' and all(row['settings'][k] == data['settings'][k] for k in ('envelope', 'spacing')):
                    return {**row, 'cached': True}
            if not self.python or not Path(self.python).is_file() or not self.greenroom:
                raise RuntimeError('Configure KAMINOS_MECHANICAL_PROXY_PYTHON with wildmeshing 0.4.1 and install gpu-greenroom')
            probe = subprocess.run([self.python, '-c', 'import importlib.metadata; assert importlib.metadata.version("wildmeshing")=="0.4.1"; import numpy'], capture_output=True, text=True)
            if probe.returncode:
                raise RuntimeError('Mechanical mesher unavailable: ' + probe.stderr)
            identity = uuid.uuid4().hex
            directory = self.directory(identity); directory.mkdir(parents=True)
            write_json(directory/'input.json', data)
            run = {'id': identity, 'status': 'submitting', 'route': ROUTE, 'sourceDigest': data['sourceDigest'], 'source': data['source'], 'settings': data['settings'], 'diagonal': data['diagonal'], 'repoRoot': str(self.repo), 'queueDir': str(self.queue)}
            write_json(directory/'run.json', run)
            try:
                command = [self.greenroom, '--queue-dir', str(self.queue), 'submit-command', '--agent-id', 'kaminos-mechanical-proxy', '--repo-root', str(self.repo), '--cwd', str(self.repo), '--route-identity', ROUTE, '--output-dir', str(directory), '--output-class', 'final', '--', self.python, str(self.repo/'mechanical_proxy_backend.py'), '--run', str(directory)]
                submitted = subprocess.run(command, capture_output=True, text=True)
                if submitted.returncode:
                    raise RuntimeError(submitted.stderr or submitted.stdout)
                submission = json.loads(submitted.stdout)
                run.update(jobId=submission['job_id'], status='pending', effectiveQueueDir=submission['effective_queue_dir'])
                write_json(directory/'run.json', run)
            except Exception as error:
                write_json(directory/'report.json', {'status':'failed','phase':'submission','route':ROUTE,'error':str(error)})
                raise
            return self.read(identity)

    def read(self, identity, include_result=False):
        directory = self.directory(identity)
        run = json.loads((directory/'run.json').read_text())
        result = dict(run)
        report_path = directory/'report.json'
        if report_path.exists():
            report = json.loads(report_path.read_text())
            if report.get('route') != ROUTE:
                raise ValueError('Proxy backend route differs')
            result.update(report)
            if result['status'] == 'running' and result.get('startedAt'):
                result['elapsedSeconds'] = max(0, time.time()-result['startedAt'])
        if result['status'] in ('submitting', 'pending') and run.get('jobId'):
            for bucket in ('pending','running','done','failed','cancelled'):
                status_path = self.queue/bucket/run['jobId']/'status.json'
                if status_path.exists():
                    queue = json.loads(status_path.read_text()); result['queue'] = queue
                    if bucket in ('pending','running'):
                        result['status'] = bucket
                    elif result['status'] not in ('passed','failed','cancelled','over-budget'):
                        result.update(status='failed',phase='queue-terminal',error=queue.get('error_message') or 'Queue finished without a complete proxy report')
                    break
        result['kept'] = (directory/'kept.json').exists()
        if result['status'] == 'passed':
            target = directory/'mesh.json'
            if not target.is_file() or hashlib.sha256(target.read_bytes()).hexdigest() != result.get('resultSha256'):
                raise ValueError('Complete proxy result missing or digest differs')
            if include_result:
                mesh = json.loads(target.read_text())
                if mesh.get('status') != 'passed' or mesh.get('route') != ROUTE or mesh.get('sourceDigest') != run['sourceDigest'] or mesh.get('settings') != run['settings']:
                    raise ValueError('Proxy result source, settings or route differs')
                result['mesh'] = mesh
        return result

    def list(self, source_digest):
        if not re.fullmatch(r'[a-f0-9]{64}', source_digest or ''):
            raise ValueError('Source digest required')
        rows = []
        for path in sorted(self.store.glob('*/run.json')):
            run = json.loads(path.read_text())
            if run.get('sourceDigest') == source_digest:
                rows.append(self.read(run['id']))
        return rows

    def cancel(self, identity):
        run = self.read(identity); directory = self.directory(identity)
        if run['status'] in ('passed','failed','cancelled','over-budget'):
            return run
        (directory/'cancel').touch()
        if run['status'] == 'pending':
            cancelled = subprocess.run([self.greenroom, '--queue-dir', str(self.queue), 'cancel', run['jobId']], capture_output=True, text=True)
            if cancelled.returncode == 0:
                write_json(directory/'report.json', {'status':'cancelled','phase':'queue','route':ROUTE})
        return self.read(identity)

    def keep(self, identity):
        result = self.read(identity, include_result=True)
        if result['status'] != 'passed':
            raise ValueError('Only complete mechanical proxies can be kept')
        write_json(self.directory(identity)/'kept.json', {'id':identity,'sourceDigest':result['sourceDigest'],'resultSha256':result['resultSha256'],'settings':result['settings'],'route':ROUTE})
        return self.read(identity)
