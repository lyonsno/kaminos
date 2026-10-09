"""A process that exits between ps and libproc is not live missing coverage."""
import ctypes
import errno
import importlib.util
import subprocess
from pathlib import Path
from unittest.mock import patch

script = Path(__file__).resolve().parents[1] / 'process-memory.py'
spec = importlib.util.spec_from_file_location('memory_exit_test', script)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class Rusage:
    def __call__(self, pid, flavor, pointer):
        if pid == 101:
            ctypes.set_errno(self.error)
            return -1
        info = pointer._obj
        info.phys_footprint = info.resident_size = info.lifetime_max_phys_footprint = 4096
        info.proc_start_abstime = 123
        return 0

class Library:
    proc_pid_rusage = Rusage()

def sample(error, state, code=0):
    Library.proc_pid_rusage.error = error
    with patch.object(module.sys, 'platform', 'darwin'), \
         patch.object(module.ctypes, 'CDLL', return_value=Library()), \
         patch.object(module.subprocess, 'check_output', return_value='100 1 /runner\n101 100 /git\n'), \
         patch.object(module.subprocess, 'run', return_value=subprocess.CompletedProcess(
             ['/bin/ps', '-p', '101', '-o', 'stat='], code, stdout=state, stderr='')):
        return module.sample_owned_processes(100, 'exit-replay')

for state, code in [('Z', 0), ('', 1)]:
    result = sample(errno.ESRCH, state, code)
    missing = result['unavailableProcesses'][0]
    assert missing.get('exitedBeforeMeasurement') is True, \
        'confirmed exited descendant must not masquerade as live missing coverage'
    assert missing['exitEvidence']['route'] == 'ps-pid-status'
    assert result['sampledAggregatePhysicalFootprintBytes'] == 4096
    assert [p['pid'] for p in result['processes']] == [100], 'do not fabricate zero-byte child rows'

for error, state, code in [(errno.ESRCH, 'S', 0), (errno.EACCES, 'Z', 0), (errno.ESRCH, '', 2)]:
    result = sample(error, state, code)
    assert not result['unavailableProcesses'][0].get('exitedBeforeMeasurement'), \
        'live, inaccessible or unverified descendants retain missing coverage'
print('Confirmed ESRCH exits remain explicit; live/inaccessible/unverified descendants are not excused.')
