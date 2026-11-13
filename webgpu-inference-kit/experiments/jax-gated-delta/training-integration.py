#!/usr/bin/env python3
"""Tiny real-WebGPU continuation witness; never a throughput benchmark.

Run with Greenroom's installed interpreter. Uses its actual SDK in a caller-
chosen disposable queue, never the canonical queue. Source/config/state and
browser reports remain under --out. Each browser context is owned and closed.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
import uuid

from gpu_queue.queue import GPUQueue
from gpu_queue.models import JobRequest
from gpu_queue.job_controls import perform


def atomic(file, value):
    file=Path(file);file.parent.mkdir(parents=True,exist_ok=True)
    temp=file.with_name(file.name+'.tmp')
    temp.write_text(json.dumps(value,indent=2,allow_nan=False)+'\n');temp.replace(file)


def read(file):
    return json.loads(Path(file).read_text())


def sha(file):
    return hashlib.sha256(Path(file).read_bytes()).hexdigest()


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--out',required=True);p.add_argument('--manifest',required=True)
    p.add_argument('--node',required=True);p.add_argument('--chrome',required=True)
    a=p.parse_args();out=Path(a.out).resolve();out.mkdir(parents=True,exist_ok=True)
    report={'status':'failed','phase':'preflight','manifest':str(Path(a.manifest).resolve()),'manifest_sha256':sha(a.manifest),'cases':[]}
    report_path=out/'report.json';atomic(report_path,report)
    root=Path(__file__).resolve().parent
    def node_run(name,resume=None,pause_at=None):
        target=out/name;target.mkdir();output=target/'report.json'
        cmd=[a.node,str(root/'training-runner.mjs'),'--manifest',a.manifest,'--out',str(output),'--chrome',a.chrome]
        if resume:cmd+=['--resume',resume]
        if pause_at is not None:cmd+=['--managed']
        with (target/'stderr.txt').open('w') as err,(target/'events.jsonl').open('w') as events:
            child=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=err,text=True)
            try:
                for line in child.stdout:
                    events.write(line);events.flush();event=json.loads(line)
                    if event['event']=='boundary':
                        action='pause' if pause_at is not None and event['progress']['update']>=pause_at else 'next'
                        child.stdin.write(json.dumps({'action':action})+'\n');child.stdin.flush()
                code=child.wait()
            finally:
                if child.poll() is None:child.stdin.close();child.wait()
        r=read(output)
        assert code==0 and r['status'] in ('completed','checkpointed'),r
        assert r['backend']['effective']=='webgpu' and r['backend']['vendor']=='apple'
        assert r['cleanup']=={'browserClosed':True,'serverClosed':True}
        report['cases'].append({'name':name,'report':str(output),'sha256':sha(output)});atomic(report_path,report)
        return r
    try:
        report['phase']='uninterrupted';atomic(report_path,report)
        whole=node_run('whole')
        report['phase']='split';atomic(report_path,report)
        first=node_run('split',pause_at=2)
        assert first['checkpoint']['update']==2 and first['pauseObserved']['update']==2
        report['phase']='fresh-process-resume';atomic(report_path,report)
        resumed=node_run('resumed',resume=first['checkpoint']['path'])
        expected=read(whole['checkpoint']['path'])['state'];actual=read(resumed['checkpoint']['path'])['state']
        # Same shader route is deterministic here. Preserve complete values so
        # differing hardware/backend behavior can be assessed independently.
        assert actual==expected,'fresh-process resumed state differs'
        report['resume_equal']=True
        report['phase']='greenroom';atomic(report_path,report)
        queue=GPUQueue(out/'queue')
        canonical=Path.home()/'.local/state/gpu-greenroom'
        assert queue.queue_dir.resolve()!=canonical.resolve()
        receiver=out/'receiver.py'
        receiver.write_text('import json,sys,pathlib\np=json.load(sys.stdin)\npathlib.Path(sys.argv[1]).write_text(json.dumps(p))\nprint(json.dumps({"registered":True,"job_id":p["job_id"],"receiver":"training-integration"}))\n')
        output=out/'queued'/'report.json'
        command=[sys.executable,str(root/'training-greenroom.py'),'--manifest',a.manifest,'--out',str(output),
                 '--node',a.node,'--chrome',a.chrome,'--on-submitted',json.dumps([sys.executable,str(receiver),str(out/'registered.json')])]
        request=JobRequest(job_type='command',input_path='',agent_id='training-conformance',
                           repo_root=str(root.parents[2]),command_cwd=str(root),route_identity='training/q4-webgpu-conformance',
                           command_argv=command,output_dir=str(output.parent),cooperative_checkpoint=True)
        queue.submit(request)
        worker=threading.Thread(target=queue.run_one,args=({},));worker.start()
        try:
            # Wait on durable progress, not elapsed-time guesses. The task is
            # intentionally tiny; a missed boundary is an explicit failure.
            while worker.is_alive():
                if output.exists():
                    status=read(output)
                    if status.get('progress',{}).get('update',0)>=2:break
                time.sleep(.01)
            assert worker.is_alive(),'producer completed before the requested pause boundary'
            job=queue.queue_dir/'running'/request.job_id
            state=read(job/'status.json')
            result=perform(queue,job_id=request.job_id,request_digest=sha(job/'request.json'),
                expected_status='running',expected_started_at=state['started_at'],request_id=uuid.uuid4().hex,
                requested_by='training-integration',action='pause',allow_bypass=True)
            report['pause_request']=result;atomic(report_path,report)
            worker.join()
        finally:
            if worker.is_alive():
                # Preserve a failed witness and ask its real producer to exit
                # through normal queue cancellation rather than leaving a job.
                # Failure cleanup is completed below by the queue's own API.
                queue.cancel(request.job_id);worker.join()
        parent=queue.queue_dir/'done'/request.job_id
        assert parent.exists(),read(queue.queue_dir/'failed'/request.job_id/'status.json')
        handoff=read(parent/'checkpoint-handoff.json');next_id=handoff['next_job_id']
        assert read(out/'registered.json')['job_id']==next_id
        successor=queue.queue_dir/'pending'/next_id
        assert successor.exists()
        hold=read(queue.queue_dir/'dispatch-policy.json')['job_holds'][next_id]
        assert hold['parent_job_id']==request.job_id
        assert read(output)['memory_released'] is True
        assert not queue.run_one({}),'held successor was dispatched'
        marker=out/'other-job.txt'
        other=JobRequest(job_type='command',input_path='',command_argv=[sys.executable,'-c',
            'from pathlib import Path;Path('+repr(str(marker))+').write_text("executed")'],command_cwd=str(out))
        queue.submit(other);assert queue.run_one({});assert marker.read_text()=='executed'
        state=read(successor/'status.json')
        perform(queue,job_id=next_id,request_digest=sha(successor/'request.json'),expected_status='pending',
                expected_started_at=state.get('started_at'),request_id=uuid.uuid4().hex,requested_by='training-integration',action='resume')
        assert queue.run_one({})
        terminal=queue.queue_dir/'done'/next_id
        assert terminal.exists(),read(queue.queue_dir/'failed'/next_id/'status.json')
        next_report=read(out/'registered.json')['report'];result=read(next_report)
        assert result['status']=='completed' and result['memory_released'] is True,result
        assert read(result['checkpoint']['path'])['state']==expected,'Greenroom resume differs'
        report.update(status='succeeded',phase='finished',greenroom={'parent':request.job_id,'successor':next_id,
            'intervening_job':other.job_id,'queue':str(queue.queue_dir),'resume_equal':True,'handoff':handoff})
    except Exception as e:
        report.update(error=repr(e));raise
    finally:atomic(report_path,report)


if __name__=='__main__':main()
