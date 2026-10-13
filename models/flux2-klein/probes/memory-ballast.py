"""Hold RAM so a run sees roughly the memory an 8 GB Mac leaves for apps.

Locks (available - leave) bytes of incompressible memory, where available is free + inactive +
speculative pages from vm_stat, and holds it until killed or until the parent process exits.
mlock keeps the pages resident so macOS cannot swap the ballast out instead of the browser; if
mlock fails the pages are rewritten every few seconds to keep them hot. Writes a JSON status file.
Usage: python3 memory-ballast.py --leave-gb 4.5 --status <file> [--max-gb 12]
"""
import argparse, ctypes, json, mmap, os, re, subprocess, sys, time

ap = argparse.ArgumentParser()
ap.add_argument('--leave-gb', type=float, required=True)
ap.add_argument('--max-gb', type=float, default=12)
ap.add_argument('--status', required=True)
args = ap.parse_args()

def available_bytes():
    out = subprocess.run(['vm_stat'], capture_output=True, text=True).stdout
    page = int(re.search(r'page size of (\d+)', out).group(1))
    pages = lambda name: int(re.search(rf'{name}:\s+(\d+)', out).group(1))
    return page * (pages('Pages free') + pages('Pages inactive') + pages('Pages speculative'))

def write(status):
    with open(args.status, 'w') as f: json.dump(status, f)

before = available_bytes()
target = int(min(args.max_gb * 2**30, max(0, before - args.leave_gb * 2**30)))
status = {'pid': os.getpid(), 'availableBefore': before, 'leaveBytes': int(args.leave_gb * 2**30), 'ballastBytes': target, 'phase': 'filling'}
write(status)
buf = mmap.mmap(-1, target) if target else None
chunk = os.urandom(16 << 20)
for off in range(0, target, len(chunk)):
    n = min(len(chunk), target - off)
    buf[off:off + n] = chunk[:n]
libc = ctypes.CDLL(None, use_errno=True)
locked = False
if buf:
    locked = libc.mlock(ctypes.addressof(ctypes.c_char.from_buffer(buf)), ctypes.c_size_t(target)) == 0
    status['mlockErrno'] = None if locked else ctypes.get_errno()
status.update(phase='holding', locked=locked, availableAfter=available_bytes())
write(status)
parent = os.getppid()
while os.getppid() == parent:
    if buf and not locked:
        for off in range(0, target, 16384): buf[off] = (buf[off] + 1) & 255
    time.sleep(3)
