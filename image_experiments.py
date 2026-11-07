"""Saved image experiments. One document per experiment, shared across pages/agents.

The HTTP browser and file-driven import use these same operations. Membership adds
merge under a file lock; metadata edits use a revision to detect stale writers.
"""
import copy
import fcntl
import json
import os
import re
import tempfile
import time
import uuid
import zlib
from functools import lru_cache
from pathlib import Path

SCHEMA = 'kaminos.image-experiment.v1'

class Conflict(ValueError):
    pass

def identity(value):
    if not isinstance(value,str) or not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_-]*',value):
        raise ValueError('Experiment id must contain letters, numbers, underscores or hyphens')
    return value

def text(value, field, required=False):
    if not isinstance(value,str) or (required and not value.strip()):
        raise ValueError(f'{field} must be {"nonempty " if required else ""}text')
    return value.strip()

@lru_cache(maxsize=None)
def png_recipe(path, size, mtime_ns, ctime_ns):
    """Read the same CRC-checked, uncompressed iTXt written by native Generate."""
    with Path(path).open('rb') as handle:
        if handle.read(8) != b'\x89PNG\r\n\x1a\n':return None
        while header := handle.read(8):
            if len(header)!=8:return None
            length=int.from_bytes(header[:4],'big');kind=header[4:]
            if kind==b'IEND':return None
            if kind!=b'iTXt':handle.seek(length+4,1);continue
            body=handle.read(length);crc=handle.read(4)
            if len(body)!=length or len(crc)!=4:return None
            key,sep,rest=body.partition(b'\0')
            if key!=b'kaminos:image-generation':continue
            if zlib.crc32(kind+body)!=int.from_bytes(crc,'big') or rest[:2]!=b'\0\0':return None
            try:
                language,translated,value=rest[2:].split(b'\0',2)
                record=json.loads(value)
                return record if isinstance(record,dict) and record.get('schema')=='kaminos.image-generation.v1' else None
            except (ValueError,UnicodeDecodeError):return None

class ExperimentStore:
    def __init__(self, directory, inspect):
        self.directory=Path(directory).expanduser().resolve()
        self.inspect=inspect

    def _path(self, id):
        return self.directory/(identity(id)+'.json')

    def _read(self, id):
        value=json.loads(self._path(id).read_text())
        if not isinstance(value,dict) or value.get('schema')!=SCHEMA or value.get('id')!=id or not isinstance(value.get('members'),list):
            raise ValueError('Invalid saved experiment document')
        return value

    def project(self, doc):
        result=copy.deepcopy(doc)
        for member in result['members']:
            try:
                entry=self.inspect(member['source'])
                member['entry']={**entry,'name':member.get('name') or entry['name'],'experiment':{'id':doc['id'],'title':doc['title']}}
                member['availability']='withheld' if entry.get('visibility',{}).get('status')=='withheld' else 'available'
                if member['availability']=='available':member['preview']=member['source']
            except (OSError,ValueError,KeyError) as error:
                member['availability']='missing';member['error']=str(error)
        for run in result.get('runs',[]):
            for source in run['sources']:
                try:
                    entry=self.inspect(source['source'])
                    if entry.get('visibility',{}).get('status')=='withheld':
                        source.pop('provenance',None);source['availability']='withheld'
                    else:source['availability']='available'
                except (OSError,ValueError,KeyError):
                    source.pop('provenance',None);source['availability']='missing'
        return result

    def get(self,id):
        return self.project(self._read(id))

    def list(self):
        entries=[];warnings=[]
        for path in self.directory.glob('*.json'):
            try:entries.append(self.get(path.stem))
            except (OSError,ValueError,KeyError) as error:warnings.append({'source':path.name,'reason':str(error)})
        entries.sort(key=lambda d:(-d['updatedAt'],d['id']))
        return {'schema':'kaminos.image-experiment-catalog.v1','entries':entries,'warnings':warnings}

    def _members(self, values):
        if not isinstance(values,list):raise ValueError('members must be a list')
        result=[]
        for value in values:
            if not isinstance(value,dict):raise ValueError('Each member must be an image record')
            source=text(value.get('source'),'source',True)
            entry=self.inspect(source)
            if entry.get('visibility',{}).get('status')=='withheld':raise ValueError('This image is withheld from browsing')
            role=value.get('role','result')
            if role not in ('reference','result'):raise ValueError('Image role must be reference or result')
            result.append({'source':source,'name':text(value.get('name',entry['name']),'name',True),
                           'role':role,'group':text(value.get('group','Results'),'group',True),'addedAt':time.time()})
        return result

    def _run_operation(self,doc,payload):
        action=payload['action'];run_id=identity(payload.get('runId'))
        runs=doc.setdefault('runs',[])
        run=next((r for r in runs if r['id']==run_id),None)
        if action=='create-run':
            sources=payload.get('sources');seeds=payload.get('seeds');author=payload.get('author')
            if not isinstance(sources,list) or not sources or len(set(sources))!=len(sources):raise ValueError('Choose distinct source recipes')
            if not isinstance(seeds,list) or not seeds or any(type(seed)!=int or seed<0 or seed>9007199254740991 for seed in seeds) or len(set(seeds))!=len(seeds):raise ValueError('Choose distinct nonnegative integer seeds')
            if not isinstance(author,dict) or author.get('kind') not in ('person','agent'):raise ValueError('A run needs its actual author')
            author={key:text(author.get(key),key,True) for key in ('kind','id','label')}
            title=text(payload.get('title'),'Run name',True)
            if run:
                if [r['source'] for r in run['sources']]!=sources or run['seeds']!=seeds or run['title']!=title or run['author']!=author:raise Conflict('Run id already belongs to a different plan')
                return
            snapshots=[]
            for source in sources:
                member=next((m for m in doc['members'] if m['source']==source),None)
                if not member:raise ValueError('A source is outside this experiment')
                entry=self.inspect(source);p=entry.get('provenance')
                if entry.get('visibility',{}).get('status')=='withheld':raise ValueError('Source image is withheld')
                if not isinstance(p,dict) or p.get('schema')!='kaminos.image-generation.v1':raise ValueError('Source has no generation recipe')
                snapshots.append({'source':source,'name':member['name'],'provenance':copy.deepcopy(p)})
            runs.append({'id':run_id,'title':title,'author':author,'createdAt':time.time(),'seeds':seeds,'sources':snapshots,'stopRequested':False,
                         'jobs':[{'id':f'{r}:{c}','sourceIndex':r,'seed':seed,'status':'queued','attempts':[]} for r in range(len(snapshots)) for c,seed in enumerate(seeds)]})
            return
        if not run:raise ValueError('Saved run is missing')
        if action=='stop-run':
            run['stopRequested']=True
            for job in run['jobs']:
                if job['status']=='queued':job['status']='stopped'
            return
        if action=='retry-run':
            ids=payload.get('jobIds')
            if not isinstance(ids,list) or not ids or len(set(ids))!=len(ids):raise ValueError('Choose failed or stopped jobs')
            jobs=[next((j for j in run['jobs'] if j['id']==id),None) for id in ids]
            if any(j is None or j['status'] not in ('failed','stopped') for j in jobs):raise Conflict('Only failed or stopped jobs can be retried')
            if any(j['status']=='running' for j in run['jobs']):raise Conflict('Wait for the active image before retrying')
            for job in jobs:job['status']='queued';job.pop('error',None)
            run['stopRequested']=False
            return
        job=next((j for j in run['jobs'] if j['id']==payload.get('jobId')),None)
        if not job:raise ValueError('Run job is missing')
        attempt=identity(payload.get('attempt'))
        if action=='claim-job':
            if job['status']=='running' and job.get('attempt')==attempt:return
            if run['stopRequested'] or job['status']!='queued':raise Conflict('This job is already claimed or terminal')
            if any(j['status']=='running' for j in run['jobs']):raise Conflict('Another image in this run is active')
            snapshot=run['sources'][job['sourceIndex']];entry=self.inspect(snapshot['source'])
            if entry.get('visibility',{}).get('status')=='withheld' or entry.get('provenance')!=snapshot['provenance']:raise Conflict('Source availability or recorded recipe changed')
            reference=snapshot['provenance'].get('reference')
            if reference and self.inspect(reference['source']).get('visibility',{}).get('status')=='withheld':raise ValueError('Original reference is withheld')
            job.update(status='running',attempt=attempt);job['attempts'].append({'id':attempt,'startedAt':time.time()})
            return
        if action!='finish-job':raise ValueError('Unknown run operation')
        state=payload.get('status')
        if state not in ('succeeded','failed','stopped'):raise ValueError('Invalid job completion')
        if state=='succeeded' and not isinstance(payload.get('result'),dict):raise ValueError('Successful job needs a saved result record')
        if job.get('attempt')!=attempt:raise Conflict('Completion belongs to another attempt')
        if job['status']!='running':
            if job['status']==state and (state!='succeeded' or job.get('result',{}).get('source')==payload.get('result',{}).get('source')):return
            raise Conflict('This attempt already completed')
        if state=='succeeded':
            result=payload.get('result')
            if not isinstance(result,dict):raise ValueError('Successful job needs a saved result')
            member=self._members([{**result,'group':run['title']}])[0]
            p=self.inspect(member['source']).get('provenance');snapshot=run['sources'][job['sourceIndex']];before=snapshot['provenance']
            if not isinstance(p,dict):raise ValueError('Saved result has no generation metadata')
            iteration=p.get('iteration')
            if not isinstance(iteration,dict) or not isinstance(iteration.get('parent'),dict):raise ValueError('Saved result needs its recorded recipe parent')
            expected={'experimentId':doc['id'],'runId':run_id,'jobId':job['id'],'attempt':attempt}
            if p.get('variation')!=expected or p.get('seed')!=job['seed'] or iteration['parent'].get('source')!=snapshot['source']:raise ValueError('Saved result does not belong to this run attempt')
            def preserves(expected,actual):
                if isinstance(expected,dict):return isinstance(actual,dict) and all(key in actual and preserves(value,actual[key]) for key,value in expected.items())
                return expected==actual
            for key in ('prompt','model','width','height','weightsLevel','reference','source','sampling','lora'):
                if not preserves(before.get(key),p.get(key)):raise ValueError('Saved result changed a fixed recipe field: '+key)
            def text_length(recipe):
                return 'model' if recipe.get('model') in ('flux3','FLUX.3 Image Klein') else recipe.get('textLength') or 'fit16'
            if text_length(p)!=text_length(before):raise ValueError('Saved result changed a fixed recipe field: textLength')
            if p.get('author')!=run['author']:raise ValueError('Saved result author differs from the run')
            job['result']={'source':member['source'],'name':member['name']}
            if not any(m['source']==member['source'] for m in doc['members']):doc['members'].append(member)
        else:job['error']=text(payload.get('error','Generation stopped' if state=='stopped' else 'Generation failed'),'error',True)
        job['status']=state;job['attempts'][-1].update(status=state,finishedAt=time.time(),**({'error':job['error']} if state!='succeeded' else {}))

    def apply(self,payload):
        if not isinstance(payload,dict):raise ValueError('Expected an experiment operation')
        action=payload.get('action');id=identity(payload.get('id') or str(uuid.uuid4()))
        if action not in ('create','update','add','create-run','claim-job','finish-job','stop-run','retry-run'):raise ValueError('Unknown experiment operation')
        self.directory.mkdir(parents=True,exist_ok=True)
        with (self.directory/'.write.lock').open('a+') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX)
            if action=='create':
                if self._path(id).exists():raise Conflict('This experiment already exists; open it to continue')
                doc={'schema':SCHEMA,'id':id,'title':text(payload.get('title'),'title',True),
                     'description':text(payload.get('description',''),'description'),
                     'createdAt':time.time(),'updatedAt':time.time(),'revision':0,'members':[]}
                agent=payload.get('agent')
                if agent is not None:
                    if not isinstance(agent,dict):raise ValueError('agent must be an identity record')
                    doc['agent']={'id':text(agent.get('id'),'agent id',True),'label':text(agent.get('label',agent.get('id')),'agent label',True)}
            else:doc=self._read(id)
            if action=='update':
                if payload.get('revision')!=doc['revision']:raise Conflict('This experiment changed in another page. Refresh before saving details.')
                for key in ('title','description'):
                    if key in payload:doc[key]=text(payload[key],key,key=='title')
            if action in ('create','add'):
                members=self._members(payload.get('members',[]))
                by_source={member['source']:member for member in doc['members']}
                for member in members:
                    if member['source'] not in by_source:
                        doc['members'].append(member);by_source[member['source']]=member
            if action.endswith('-run') or action in ('claim-job','finish-job'):self._run_operation(doc,payload)
            doc['revision']+=1;doc['updatedAt']=time.time()
            temp=None
            try:
                with tempfile.NamedTemporaryFile(mode='w',dir=self.directory,prefix='.experiment-',delete=False) as handle:
                    temp=Path(handle.name);json.dump(doc,handle,ensure_ascii=False,indent=2);handle.write('\n');handle.flush();os.fsync(handle.fileno())
                os.replace(temp,self._path(id))
            finally:
                if temp and temp.exists():temp.unlink()
        return self.project(doc)
