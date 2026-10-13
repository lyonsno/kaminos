"""Queue position for a TRELLIS job comes from Greenroom's own dispatch order.

The report runs against a temporary Greenroom queue with the real gpu_queue package
(the interpreter beside the configured greenroom CLI), not a reimplementation.
"""
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import serve

GREENROOM = Path('/Users/noahlyons/.local/share/uv/tools/gpu-greenroom/bin/gpu-greenroom')
assert hasattr(serve, 'gpu_queue_position'), 'Kaminos must report where a queued generation stands'

with TemporaryDirectory() as directory:
    queue = Path(directory) / 'queue'
    work = Path(directory) / 'work'
    work.mkdir()
    def submit(route, service_class=None):
        manifest = {'schema': 'gpu-greenroom.command.v2' if service_class else 'gpu-greenroom.command.v1',
                    'repo_root': str(work), 'cwd': str(work), 'route_identity': route,
                    'output_dir': str(work / route), 'argv': ['/bin/echo', route]}
        if service_class:
            manifest['service_class'] = service_class
        path = work / f'{route}.json'
        path.write_text(json.dumps(manifest))
        out = subprocess.run([str(GREENROOM), '--queue-dir', str(queue), 'submit-command', '--manifest', str(path)],
                             capture_output=True, text=True, check=True)
        time.sleep(0.01)
        return json.loads(out.stdout)['job_id']
    first, second, mine = submit('a'), submit('b'), submit('trellis', 'normal')
    later = submit('c')
    report = serve.gpu_queue_position(mine, queue_dir=queue, greenroom_bin=GREENROOM)
    assert report['schema'] == 'kaminos.gpu-queue-position.v0', report
    assert report['status'] == 'pending' and report['jobsAhead'] == 2, report
    assert [row['jobId'] for row in report['ahead']] == [first, second], report
    assert report['serviceClass'] == 'normal'
    assert report['waitedSeconds'] >= 0 and report['running'] is None
    assert report['orderAuthority'] == 'gpu_queue.dispatch.pending_order'
    assert serve.gpu_queue_position(later, queue_dir=queue, greenroom_bin=GREENROOM)['jobsAhead'] == 3

    missing = serve.gpu_queue_position('000000000000', queue_dir=queue, greenroom_bin=GREENROOM)
    assert missing['status'] == 'unknown' and missing['jobsAhead'] is None, missing
    for bad in ('../x', 'a' * 80, ''):
        try:
            serve.gpu_queue_position(bad, queue_dir=queue, greenroom_bin=GREENROOM)
        except ValueError:
            pass
        else:
            raise AssertionError(f'job id accepted: {bad!r}')
print('gpu queue position contracts passed')

# Express eligibility is the queue's own decision: two-class dispatch and a quick-route entry.
assert hasattr(serve, 'trellis_express_eligibility')
with TemporaryDirectory() as directory:
    root = Path(directory)
    route = serve.TRELLIS_QUEUE_ROUTE_IDENTITY
    assert route == 'TRELLIS2 queued browser-WebGPU / CPU source finishing'
    assert serve.trellis_express_eligibility(root)['eligible'] is False
    (root / 'dispatch-policy.json').write_text(json.dumps({'mode': 'two-class', 'quick_routes': {'other': 'x'}}))
    result = serve.trellis_express_eligibility(root)
    assert result['eligible'] is False and 'quick' in result['reason'], result
    (root / 'dispatch-policy.json').write_text(json.dumps({'mode': 'two-class', 'quick_routes': {route: 'evidence'}}))
    assert serve.trellis_express_eligibility(root) == {'eligible': True, 'reason': None, 'basis': 'evidence'}
    (root / 'dispatch-policy.json').write_text(json.dumps({'mode': 'fifo', 'quick_routes': {route: 'evidence'}}))
    assert serve.trellis_express_eligibility(root)['eligible'] is False
print('trellis express eligibility contracts passed')
