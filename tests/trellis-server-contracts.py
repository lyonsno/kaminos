"""Execute the actual server functions with deterministic local stand-ins."""
import ast
import json
import os
from pathlib import Path
import re
from types import SimpleNamespace
import unittest
import uuid

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

if __name__=='__main__':unittest.main()
