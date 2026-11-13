#!/usr/bin/env python3
"""Supervise the browser trainer through Greenroom's existing checkpoint SDK.

Use the installed Greenroom Python interpreter. No scheduler policy is changed.
The optional completion argv is required for managed continuations and must
register the supplied future job before returning a JSON receipt.
"""
import argparse
from dataclasses import replace
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    with temp.open('w') as stream:
        json.dump(value, stream, allow_nan=False, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temp, path)


def supervise(args):
    output = Path(args.out).resolve()
    child_report = output.with_name(output.stem + '-browser.json')
    stderr_path = output.with_name(output.stem + '-browser.stderr.txt')
    inputs = {Path(args.manifest).resolve()}
    if args.resume:
        inputs.add(Path(args.resume).resolve())
    if any(file.resolve() in inputs for file in (output, child_report, stderr_path)):
        raise ValueError('report/stderr output aliases training input')
    status = {'schema': 'kaminos.training-supervisor.v1', 'status': 'failed',
              'phase': 'preflight', 'source_root': str(Path(__file__).resolve().parents[3]),
              'manifest': str(Path(args.manifest).resolve()), 'memory_released': False}
    child = None
    invocation = uuid.uuid4().hex
    def record(**changes):
        status.update(changes, updated_at=time.time())
        write(output, status)
    def send(action):
        child.stdin.write(json.dumps({'action': action}) + '\n')
        child.stdin.flush()
    def event():
        line = child.stdout.readline()
        if not line:
            raise RuntimeError('browser producer ended before its terminal event')
        value = json.loads(line)
        if value.get('event') not in {'boundary', 'terminal'}:
            raise ValueError('unknown browser producer event')
        return value
    def finish(value):
        code = child.wait()
        report = json.loads(child_report.read_text())
        if (code != 0 or value.get('event') != 'terminal'
                or value.get('report') != str(child_report)
                or value.get('status') != report.get('status')
                or report.get('status') not in {'completed', 'checkpointed'}
                or report.get('cleanup') != {'browserClosed': True, 'serverClosed': True}):
            raise RuntimeError('browser training/release failed: ' + str(report.get('error', value)))
        if report.get('backend', {}).get('effective') != 'webgpu':
            raise RuntimeError('effective route is not WebGPU')
        if (report.get('invocation') != invocation
                or report.get('manifest', {}).get('sha256') != manifest_hash
                or report.get('backend', {}).get('vendor') != args.expected_vendor.lower()):
            raise RuntimeError('stale or incompatible browser result')
        progress, checkpoint = report.get('progress', {}), report.get('checkpoint', {})
        update, total = progress.get('update'), progress.get('total')
        if (type(update) is not int or type(total) is not int or not 0 <= update <= total or total <= 0
                or (report['status'] == 'completed') != (update == total)
                or checkpoint.get('update') != update
                or digest(checkpoint['path']) != checkpoint.get('sha256')):
            raise RuntimeError('incomplete or corrupted training result')
        record(browser_report=str(child_report), browser_exit=code, memory_released=True)
        return report
    try:
        record()
        manifest_hash = digest(args.manifest)
        from gpu_queue import cooperative as sdk
        from gpu_queue.cancellation import cancellation
        managed = os.environ.get('GPU_GREENROOM_CONTEXT') is not None
        context = sdk._context() if managed else None
        if managed and not args.on_submitted:
            raise ValueError('--on-submitted JSON argv is required for continuation delivery')
        completion = json.loads(args.on_submitted) if args.on_submitted else None
        if completion is not None and (not isinstance(completion, list) or not completion
                                       or not all(isinstance(s, str) for s in completion)
                                       or not Path(completion[0]).is_absolute()):
            raise ValueError('completion registration must be an absolute executable argv')
        saved = sdk.load_checkpoint() if managed else None
        resume = args.resume
        if saved:
            if saved.get('manifest_sha256') != manifest_hash or digest(saved['path']) != saved['sha256']:
                raise ValueError('resume manifest/checkpoint bytes changed')
            resume = saved['path']
        command = [args.node, str(Path(__file__).with_name('training-runner.mjs')),
                   '--manifest', str(Path(args.manifest).resolve()), '--out', str(child_report),
                   '--chrome', args.chrome, '--managed', '--expected-vendor', args.expected_vendor,
                   '--invocation-id', invocation]
        if resume:
            command += ['--resume', str(Path(resume).resolve())]
        record(phase='browser-launch', command=command, managed=managed, manifest_sha256=manifest_hash,
               sdk=str(Path(sdk.__file__).resolve()), sdk_sha256=digest(sdk.__file__))
        with stderr_path.open('w') as stderr, cancellation() as stop:
            child = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=stderr, text=True, bufsize=1)
            record(child_pid=child.pid, stderr=str(stderr_path))
            while True:
                value = event()
                if value['event'] == 'terminal':
                    report = finish(value)
                    if report['status'] != 'completed':
                        raise ValueError('unexpected checkpoint without a handoff request')
                    record(status='completed', phase='finished', progress=report['progress'], checkpoint=report['checkpoint'])
                    return 0
                stop.checkpoint()
                record(phase='boundary', progress=value['progress'], effective_backend=value.get('backend'))
                if managed and value['progress']['update'] < value['progress']['total']:
                    # No invented estimate before the producer has measured a
                    # representative update plus actual checkpoint/release work.
                    sdk.report_pause_estimate(None, checkpoint='completed optimizer update; save and exit')
                    def save(directory):
                        send('pause')
                        report = finish(event())
                        item = report['checkpoint']
                        if digest(item['path']) != item['sha256']:
                            raise ValueError('checkpoint changed after browser release')
                        destination = Path(directory) / 'training-state.json'
                        raw = Path(item['path']).read_bytes()
                        with destination.open('xb') as stream:
                            stream.write(raw); stream.flush(); os.fsync(stream.fileno())
                        return {'path': str(destination.resolve()), 'sha256': digest(destination),
                                'manifest_sha256': manifest_hash, 'update': item['update']}
                    def continuation(checkpoint):
                        request = context[2]
                        fresh = uuid.uuid4().hex[:12]
                        next_out = context[0].queue_dir / 'outputs' / fresh / 'training-report.json'
                        argv = list(request.command_argv)
                        i = argv.index('--out'); argv[i + 1] = str(next_out)
                        return replace(request, job_id=fresh, submitted_at=time.time(),
                                       output_dir=str(next_out.parent), command_argv=argv,
                                       params=dict(request.params),
                                       required_worker_capabilities=list(request.required_worker_capabilities))
                    def register(request):
                        payload = {'job_id': request.job_id, 'queue_dir': str(context[0].queue_dir),
                                   'report': str(Path(request.output_dir) / 'training-report.json')}
                        result = subprocess.run(completion, input=json.dumps(payload), capture_output=True,
                                                text=True, check=True)
                        receipt = json.loads(result.stdout)
                        if receipt.get('job_id') != request.job_id or receipt.get('registered') is not True:
                            raise ValueError('completion receiver did not register the future job')
                        record(status='checkpointed', phase='continuation-registered',
                               next_job_id=request.job_id, registration=receipt)
                    sdk.yield_if_requested(save_checkpoint=save,
                        quiesce=lambda: child.poll() == 0 and status['memory_released'],
                        continuation=continuation, on_submitted=register)
                    # A hold can be withdrawn while saving. Preserve the saved
                    # state and fail visibly; never send work to a closed child.
                    if child.poll() is not None:
                        raise RuntimeError('checkpoint saved and resources released but handoff was withdrawn; resume from saved checkpoint')
                send('next')
    except SystemExit as error:
        if error.code == 0 and status.get('status') == 'checkpointed':
            return 0
        record(status='failed', error=str(error))
        raise
    except Exception as error:
        record(status='failed', error=str(error), error_type=type(error).__name__)
        return 1
    finally:
        if child is not None and child.poll() is None:
            # EOF is an error to the browser owner; its finally closes its
            # exact browser and server. No global browser or queue is touched.
            child.stdin.close()
            child.wait()
        if child is not None:
            child.stdin.close()
            child.stdout.close()
            record(child_exit=child.returncode)
        record()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--node', required=True)
    parser.add_argument('--chrome', required=True)
    parser.add_argument('--resume')
    parser.add_argument('--expected-vendor', default='apple')
    parser.add_argument('--on-submitted', help='JSON argv; stdin future-job descriptor, stdout registration receipt')
    return supervise(parser.parse_args())


if __name__ == '__main__':
    sys.exit(main())
