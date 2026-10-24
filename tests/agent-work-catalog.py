# kaminos-test: python
import json,sys,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from authoring_asset_catalog import read_catalog

class AgentWork(unittest.TestCase):
 def test_named_agent_outputs_and_evidence_preserve_sources(self):
  with tempfile.TemporaryDirectory() as tmp:
   queue=Path(tmp)
   for job,agent,kind in [('old','image-agent','generated'),('new','flame-agent','witness')]:
    folder=queue/'done'/job;folder.mkdir(parents=True);output=queue/'outputs'/job;output.mkdir(parents=True)
    (output/'frame.png').write_bytes(b'image')
    (folder/'request.json').write_text(json.dumps({'job_id':job,'agent_id':agent,'output_class':kind}))
    (folder/'receipt.json').write_text(json.dumps({'job_id':job,'job_type':'command','status':'done','exit_code':0,'output_dir':str(output),'finished_at':1 if job=='old' else 2}))
   result=read_catalog('agent-work',roots={'greenroom':queue},image_entries=lambda:[],origins=lambda _:None,output_resolver=lambda p:Path(p),label=lambda v:v)
   self.assertEqual([e['agent']['id'] for e in result['entries']],['flame-agent','image-agent'])
   self.assertEqual(result['entries'][0]['agent']['label'],'Flame Agent')
   self.assertEqual(result['entries'][0]['source'],'/api/job-output?job_id=new&file=frame.png')
   self.assertEqual(result['entries'][0]['outputClass'],'witness')
   # A mismatched request may not lend its agent identity to another job.
   (queue/'done/new/request.json').write_text(json.dumps({'job_id':'different','agent_id':'someone-else'}))
   result=read_catalog('agent-work',roots={'greenroom':queue},image_entries=lambda:[],origins=lambda _:None,output_resolver=lambda p:Path(p),label=lambda v:v)
   self.assertEqual(len(result['entries']),1);self.assertTrue(result['warnings'])

if __name__=='__main__':unittest.main()
