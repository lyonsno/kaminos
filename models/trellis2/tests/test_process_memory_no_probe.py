"""Real Darwin sampling must not create a ps child inside a nested observer tree."""
import importlib.util
import os
import subprocess
import sys
from pathlib import Path
from unittest.mock import patch

script = Path(__file__).resolve().parents[1] / 'process-memory.py'
spec = importlib.util.spec_from_file_location('memory_no_probe', script)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

child = subprocess.Popen([sys.executable, '-c', 'import sys; sys.stdin.read()'], stdin=subprocess.PIPE)
try:
    with patch.object(module.subprocess, 'check_output', side_effect=AssertionError('sampling spawned ps')), \
         patch.object(module.subprocess, 'run', side_effect=AssertionError('retirement check spawned ps')):
        report = module.sample_owned_processes(os.getpid(), 'no-probe-live-child')
    assert report['status'] == 'observed', report
    assert report.get('processTreeRoute') == 'darwin-libproc-proc_listchildpids', report
    rows = {row['pid']: row for row in report['processes']}
    assert os.getpid() in rows and child.pid in rows, 'owned live child cannot be excluded'
    assert rows[child.pid]['parentPid'] == os.getpid()
    assert rows[child.pid]['physicalFootprintBytes'] > 0
    assert report['sampledAggregatePhysicalFootprintBytes'] == sum(row['physicalFootprintBytes'] for row in rows.values())
    assert not report.get('unavailableProcesses'), report
finally:
    child.stdin.close()
    child.wait()

print('Real Darwin owned-tree sampling includes the live child without creating a ps process.')
