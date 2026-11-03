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

    def apply(self,payload):
        if not isinstance(payload,dict):raise ValueError('Expected an experiment operation')
        action=payload.get('action');id=identity(payload.get('id') or str(uuid.uuid4()))
        if action not in ('create','update','add'):raise ValueError('Unknown experiment operation')
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
            doc['revision']+=1;doc['updatedAt']=time.time()
            temp=None
            try:
                with tempfile.NamedTemporaryFile(mode='w',dir=self.directory,prefix='.experiment-',delete=False) as handle:
                    temp=Path(handle.name);json.dump(doc,handle,ensure_ascii=False,indent=2);handle.write('\n');handle.flush();os.fsync(handle.fileno())
                os.replace(temp,self._path(id))
            finally:
                if temp and temp.exists():temp.unlink()
        return self.project(doc)
