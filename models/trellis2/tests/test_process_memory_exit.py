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
    info=module.BSDShortInfo();info.pid=101;info.status=5 if state=='Z' else 2
    evidence={'route':'libproc-pid-status','pid':101,'observedPid':101 if code==0 else None,
              'bytesReturned':64 if code==0 else 0,'expectedBytes':64,
              'statusCode':info.status if code==0 else None,'errno':errno.ESRCH if code==1 else errno.EPERM if code==2 else 0}
    with patch.object(module.sys, 'platform', 'darwin'), \
         patch.object(module.ctypes, 'CDLL', return_value=Library()), \
         patch.object(module, 'owned_process_rows', return_value={100:{'pid':100,'parentPid':1,'executable':'/runner'},
             101:{'pid':101,'parentPid':100,'executable':'/git'}}), \
         patch.object(module, 'process_status', return_value=(info,evidence)):
        return module.sample_owned_processes(100, 'exit-replay')

for error, state, code in [(error, state, code) for error in [errno.ESRCH, errno.EPERM]
                          for state, code in [('Z', 0), ('', 1)]]:
    # Actual Authoring run998512e7 outer sample at1791874111270.01:
    # nested observer64072's /bin/ps64171 returned EPERM. That old
    # sample has no retirement proof; these mocked OS replies test the
    # new conditional continuation, not retroactive closure of that run.
    result = sample(error, state, code)
    missing = result['unavailableProcesses'][0]
    assert missing.get('exitedBeforeMeasurement') is True, \
        'confirmed exited descendant must not masquerade as live missing coverage'
    assert missing['exitEvidence']['route'] == 'libproc-pid-status'
    assert result['sampledAggregatePhysicalFootprintBytes'] == 4096
    assert [p['pid'] for p in result['processes']] == [100], 'do not fabricate zero-byte child rows'

for error, state, code in [(errno.ESRCH, 'S', 0), (errno.EPERM, 'S', 0),
                         (errno.EPERM, '', 2), (errno.EACCES, 'Z', 0), (errno.ESRCH, '', 2)]:
    result = sample(error, state, code)
    assert not result['unavailableProcesses'][0].get('exitedBeforeMeasurement'), \
        'live, inaccessible or unverified descendants retain missing coverage'
print('OS-confirmed ESRCH/EPERM exits remain explicit; live/inaccessible/unverified descendants are not excused.')
