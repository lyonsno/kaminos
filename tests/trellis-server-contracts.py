# kaminos-test: python
"""Execute the actual server functions with deterministic local stand-ins."""
import ast
import json
import os
from pathlib import Path
import re
from types import SimpleNamespace
import unittest
import uuid
import io
import queue
import subprocess

SCRIPT=Path(__file__).resolve().parents[1]/'serve.py'
TREE=ast.parse(SCRIPT.read_text())
FUNCTIONS={node.name:node for node in TREE.body if isinstance(node,ast.FunctionDef)}
def function(name,namespace):
    exec(compile(ast.Module(body=[FUNCTIONS[name]],type_ignores=[]),str(SCRIPT),'exec'),namespace)
    return namespace[name]

class TrellisServerContracts(unittest.TestCase):
    def test_same_second_generation_requests_get_distinct_artifact_roots(self):
        fn=function('_default_pipeline_out_dir',{'re':re,'Path':Path,'uuid':uuid,
            'os':SimpleNamespace(getpid=lambda:42),'time':SimpleNamespace(strftime=lambda _: 'same-second'),
            'KAMINOS_PIPELINE_RUNS_DIR':Path('/run-store')})
        first,second=fn('trellis-image-to-mesh-webgpu-v0'),fn('trellis-image-to-mesh-webgpu-v0')
        self.assertNotEqual(first,second,'two GUI requests must not reuse one cached output path')
        self.assertEqual(first.parent,Path('/run-store'))

    def test_trellis_nonstream_request_has_no_hidden_six_minute_deadline(self):
        captured=[]
        def run(command,**kwargs):
            captured.append(kwargs)
            return SimpleNamespace(returncode=1,stdout='',stderr='')
        class Output:
            def mkdir(self,**kwargs):pass
            def __truediv__(self,name):return self
            def exists(self):return False
            def __str__(self):return '/owned-output'
        fn=function('run_pipeline_witness',{'os':SimpleNamespace(environ={}),
            'resolve_pipeline_source':lambda _:{'path':'/source.png'},'_default_pipeline_out_dir':lambda _:Output(),
            'Path':Path,'ROOT':Path('/repo'),'PIPELINE_WITNESS_PATH':Path('/repo/pipeline-witness.mjs'),
            'PIPELINE_MANIFEST_PATH':Path('/repo/pipelines/asset-pipelines.json'),
            'subprocess':SimpleNamespace(run=run),'json':json})
        fn({'pipelineId':'trellis-image-to-mesh-webgpu-v0'})
        self.assertIsNone(captured[0]['timeout'],'the observed ten-minute route must not inherit a six-minute stop')

    def stream_after_ten_minutes(self,environ):
        killed=[]
        class Output:
            def mkdir(self,**kwargs):pass
            def __truediv__(self,name):return self
            def exists(self):return False
            def __str__(self):return '/owned-output'
        polls=iter([None,1]);clock=iter([0,601])
        proc=SimpleNamespace(stdout=io.StringIO(''),stderr=io.StringIO(''),returncode=1,
            poll=lambda:next(polls),kill=lambda:killed.append(True))
        namespace={'os':SimpleNamespace(environ=environ),
            'resolve_pipeline_source':lambda _:{'path':'/source.png'},'_default_pipeline_out_dir':lambda _:Output(),
            'Path':Path,'ROOT':Path('/repo'),'PIPELINE_WITNESS_PATH':Path('/repo/pipeline-witness.mjs'),
            'PIPELINE_MANIFEST_PATH':Path('/repo/pipelines/asset-pipelines.json'),
            'subprocess':SimpleNamespace(Popen=lambda *a,**k:proc,PIPE=-1,TimeoutExpired=subprocess.TimeoutExpired),
            'threading':SimpleNamespace(Thread=lambda **k:SimpleNamespace(start=lambda:None,join=lambda **k:None)),
            'time':SimpleNamespace(monotonic=lambda:next(clock)),'queue':queue,'json':json,
            '_write_pipeline_stream_event':lambda *a:None,'_pipeline_progress_event_from_line':lambda *a:None,'pipeline_child_env':lambda *a:dict(environ)}
        return function('run_pipeline_witness_stream',namespace),killed

    def test_gui_stream_survives_the_observed_ten_minute_trellis_duration(self):
        fn,killed=self.stream_after_ten_minutes({})
        try:fn(None,{'pipelineId':'trellis-image-to-mesh-webgpu-v0'})
        except subprocess.TimeoutExpired as error:
            self.fail(f'actual GUI streaming branch killed the adapter at its hidden {error.timeout}s deadline')
        self.assertEqual(killed,[])

    def test_gui_stream_preserves_an_explicit_operator_deadline(self):
        fn,killed=self.stream_after_ten_minutes({'KAMINOS_PIPELINE_WITNESS_TIMEOUT':'500'})
        with self.assertRaises(subprocess.TimeoutExpired) as raised:
            fn(None,{'pipelineId':'trellis-image-to-mesh-webgpu-v0'})
        self.assertEqual(raised.exception.timeout,500);self.assertEqual(killed,[True])

    def test_express_reaches_the_adapter_only_as_a_valid_trellis_service_class(self):
        fn=function('pipeline_child_env',{'os':SimpleNamespace(environ={'PATH':'/bin'})})
        self.assertEqual(fn('trellis-image-to-mesh-webgpu-v0',{'serviceClass':'quick'})['KAMINOS_TRELLIS_SERVICE_CLASS'],'quick')
        self.assertNotIn('KAMINOS_TRELLIS_SERVICE_CLASS',fn('trellis-image-to-mesh-webgpu-v0',{}))
        for pipeline,value in [('trellis-image-to-mesh-webgpu-v0','vip'),('sharp-image-to-splat-live-v0','quick')]:
            with self.assertRaises(ValueError):fn(pipeline,{'serviceClass':value})

if __name__=='__main__':unittest.main()
