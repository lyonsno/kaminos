"""Local installations and per-client native hand workers. No inference at import.

KAMINOS_HAND_INPUT_CONFIG selects a caller-owned installation file. Packages and
native weights are referenced in place; capture output belongs to evidenceRoot.
"""
import atexit
import base64
import json
import hashlib
import os
from pathlib import Path
import re
import subprocess
import threading
import uuid

SCHEMA='kaminos.hand-input-installation.v1'

def identifier(value, label='session'):
    if not isinstance(value,str) or not re.fullmatch(r'[A-Za-z0-9_-]+',value):
        raise ValueError('Invalid hand '+label)
    return value

class NativeWorker:
    def __init__(self, config, output):
        self.config=config;self.output=Path(output);self.process=None
        self.lock=threading.Lock();self.log=None;self.closed=False
    def report(self, **value):
        self.output.mkdir(parents=True,exist_ok=True)
        (self.output/'report.json').write_text(json.dumps(value,indent=2)+'\n')
    def open(self):
        phase='launch'
        try:
            self.output.mkdir(parents=True,exist_ok=True)
            self.log=(self.output/'worker.stderr.log').open('a')
            env={**os.environ,'PYTHONPATH':str(Path(self.config.get('source','.'))/'src'),
                 'HF_HUB_OFFLINE':'1','PYTHONUNBUFFERED':'1'}
            self.process=subprocess.Popen([self.config['python'],'-u',str(Path(__file__).parent/'tools/hand-input-worker.py')],
                stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=self.log,text=True,env=env)
            phase='model-load'
            result=self.request({'action':'load','config':self.config})
            if result.get('identity',{}).get('backend')!='mlx-metal' or result.get('identity',{}).get('model')!='wilor':
                raise RuntimeError('WiLoR worker returned a different effective route')
            self.report(status='loaded',phase=phase,identity=result['identity'])
            return result
        except Exception as error:
            self.report(status='failed',phase=phase,error=str(error))
            self.close();raise
    def request(self, payload):
        with self.lock:
            if self.closed:raise RuntimeError('WiLoR session closed')
            self.process.stdin.write(json.dumps(payload)+'\n');self.process.stdin.flush()
            line=self.process.stdout.readline()
            if not line:raise RuntimeError('WiLoR worker ended before its response; inspect worker.stderr.log')
            result=json.loads(line)
            if result.get('error'):raise RuntimeError(result['error'])
            return result
    def close(self):
        self.closed=True
        if self.process is not None:
            if self.process.poll() is None:self.process.terminate()
            self.process.wait()
            for stream in (self.process.stdin,self.process.stdout):
                if stream:stream.close()
        if self.log:self.log.close()

class HandInputService:
    def __init__(self, path=None):
        self.path=Path(path or os.environ.get('KAMINOS_HAND_INPUT_CONFIG',Path.home()/'.config/kaminos/hands.json')).expanduser()
        self.config={};self.error=None;self.workers={};self.lock=threading.Lock();self.closed=set()
        try:
            if self.path.is_file():
                self.config=json.loads(self.path.read_text())
                if self.config.get('schema')!=SCHEMA:raise ValueError('Expected '+SCHEMA)
        except (OSError,ValueError,AttributeError) as error:self.error=str(error)
        atexit.register(self.close_all)
    def package_root(self, name):
        raw=self.config.get('packages',{}).get(name)
        if isinstance(raw,dict):raw=raw.get('root')
        return Path(raw).expanduser().resolve() if isinstance(raw,str) and raw else None
    def package_file(self,name,relative):
        root=self.package_root(name)
        if root is None:return None
        entry=self.config.get('packages',{}).get(name)
        if relative=='package.json' and isinstance(entry,dict):relative=entry.get('manifest','package.json')
        candidate=(root/relative).resolve()
        return candidate if candidate.is_relative_to(root) and candidate.is_file() else None
    def status(self):
        packages={}
        for name in ('spiralconv','dsconv','detector'):
            root=self.package_root(name)
            packages[name]={'available':self.package_file(name,'package.json') is not None,'url':'/hand-models/'+name+'/','root':str(root) if root else None}
        native=self.config.get('wilor',{})
        required=('python','source','weights','mano','detector')
        available=all(isinstance(native.get(key),str) and Path(native[key]).expanduser().exists() for key in required)
        return {'schema':'kaminos.hand-input-availability.v1','status':'invalid-configuration' if self.error else 'configured',
            'error':self.error,'installationFile':str(self.path),'packages':packages,
            'wilor':{'available':available,'backend':'mlx-metal','reason':None if available else 'Register existing WiLoR Python, source, detector, weights and MANO paths in '+str(self.path)}}
    def evidence(self, session):
        identifier(session)
        raw=self.config.get('evidenceRoot')
        if not isinstance(raw,str) or not raw:raise ValueError('Hand evidenceRoot must be configured')
        root=Path(raw).expanduser()/session;root.mkdir(parents=True,exist_ok=True);return root
    def retain(self, payload):
        if not isinstance(payload,dict) or not isinstance(payload.get('request',{}),dict):raise ValueError('Hand capture requires an object request')
        root=self.evidence(payload.get('sessionId'));capture=identifier(payload.get('captureId'),'capture')
        target=root/'captures';target.mkdir(exist_ok=True)
        metadata=target/(capture+'.json');previous=json.loads(metadata.read_text()) if metadata.is_file() else {}
        request=dict(payload.get('request',{}));image=request.pop('image',None)
        source=previous.get('source')
        if image:
            data=base64.b64decode(image,validate=True)
            if not data.startswith(b'\x89PNG\r\n\x1a\n'):raise ValueError('Expected original hand sample PNG')
            (target/(capture+'.png')).write_bytes(data)
            source={'path':str(target/(capture+'.png')),'sha256':hashlib.sha256(data).hexdigest(),'mime':'image/png'}
        if source is None and not payload.get('sourceFailure'):raise ValueError('Capture has no retained original source')
        value={**previous,**payload,'request':request,'source':source}
        metadata.write_text(json.dumps(value,allow_nan=False)+'\n')
        return {'retained':True,'sessionId':payload['sessionId'],'captureId':capture,'source':source}
    def open(self, session):
        identifier(session)
        if not self.status()['wilor']['available']:raise ValueError('WiLoR installation is unavailable')
        # Reserve before model load so an overlapping Stop owns the late worker.
        worker=NativeWorker(self.config['wilor'],self.evidence(session)/('native-'+uuid.uuid4().hex))
        with self.lock:
            if session in self.closed:raise ValueError('WiLoR session was already closed')
            if session in self.workers:raise ValueError('WiLoR session already open')
            self.workers[session]=worker
        try:
            result=worker.open()
            with self.lock:
                if session in self.closed:raise RuntimeError('WiLoR session closed during load')
            return result
        except Exception:
            worker.close()
            with self.lock:self.workers.pop(session,None)
            raise
    def infer(self,payload):
        session=identifier(payload.get('sessionId'))
        with self.lock:worker=self.workers.get(session)
        if worker is None:raise ValueError('WiLoR session is not open')
        try:
            capture_session=identifier(payload.get('captureSessionId'))
            capture=identifier(payload.get('captureId'),'capture')
            target=self.evidence(capture_session)/'captures'
            metadata=json.loads((target/(capture+'.json')).read_text())
            data=(target/(capture+'.png')).read_bytes()
            if hashlib.sha256(data).hexdigest()!=metadata.get('source',{}).get('sha256'):raise ValueError('Retained hand source changed')
            return worker.request({**payload,'action':'infer','image':base64.b64encode(data).decode()})
        except Exception as error:
            worker.report(status='failed',phase='inference',error=str(error));raise
    def close(self,session):
        identifier(session)
        with self.lock:
            self.closed.add(session);worker=self.workers.pop(session,None)
        if worker:worker.close()
        return {'closed':True,'sessionId':session}
    def close_all(self):
        with self.lock:workers=list(self.workers.values());self.workers.clear()
        for worker in workers:worker.close()

_service=None
def service():
    global _service
    if _service is None:_service=HandInputService()
    return _service

def handle(handler, action):
    try:
        payload=json.loads(handler.rfile.read(int(handler.headers.get('Content-Length','0'))))
        if not isinstance(payload,dict):raise ValueError('Hand input requires a JSON object')
        owner=service()
        if action=='record':result=owner.retain(payload)
        elif action=='open':result=owner.open(payload.get('sessionId'))
        elif action=='infer':result=owner.infer(payload)
        elif action=='close':result=owner.close(payload.get('sessionId'))
        else:raise ValueError('Unknown hand input action')
        handler.send_json(result)
    except (ValueError,TypeError,KeyError) as error:handler.send_json({'error':str(error)},400)
    except (OSError,RuntimeError) as error:handler.send_json({'error':str(error)},503)
