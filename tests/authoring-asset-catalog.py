import http.client,json,sys,tempfile,threading,unittest
from pathlib import Path
from http.server import ThreadingHTTPServer
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import serve
class Catalog(unittest.TestCase):
 def test_completed_generator_assets_replace_queue_folders_and_preserve_authorized_source(self):
  with tempfile.TemporaryDirectory() as temporary:
   root=Path(temporary);queue=root/'queue';queue.mkdir();old=serve.BROWSE_ROOTS['greenroom'];serve.BROWSE_ROOTS['greenroom']=queue
   for folder in ['bumps','cache','cancelled','events','gc','done']: (queue/folder).mkdir()
   def job(id,kind,files,status='done'):
    directory=queue/'done'/id;directory.mkdir();output=queue/'outputs'/id;output.mkdir(parents=True)
    for name in files:(output/name).parent.mkdir(parents=True,exist_ok=True);(output/name).write_bytes(b'artifact')
    receipt={'job_id':id,'job_type':kind,'status':status,'exit_code':0,'output_dir':str(output),'input_name':'Kiln study.png'}
    (directory/'receipt.json').write_text(json.dumps(receipt));(output/'metadata.json').write_text(json.dumps({'job_id':id,'name':'Kiln study','output_files':list(files)}));return output
   image=job('image','mflux_flux2_edit',['output.png','output.metadata.json']);mesh=job('mesh','trellis2mlx',['asset.glb','report.json']);job('diagnostics','command',['witness.png']);job('failed','mflux_flux2_edit',['partial.png'],'failed')
   (mesh/'metadata.json').write_text(json.dumps({'job_id':'mesh','output_files':['asset.glb','missing.glb','../outside.png']}))
   server=ThreadingHTTPServer(('127.0.0.1',0),serve.KaminosHandler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
   try:
    conn=http.client.HTTPConnection(*server.server_address);conn.request('GET','/api/authoring-assets?collection=greenroom');response=conn.getresponse();payload=response.read();conn.close();self.assertEqual(response.status,200,payload.decode());body=json.loads(payload)
    self.assertEqual(body['schema'],'kaminos.authoring-assets.v1');self.assertEqual(body['collection'],'greenroom');self.assertEqual({e['name']for e in body['entries']},{'output.png','asset.glb'});self.assertTrue(all(e['kind']in ['image','mesh']for e in body['entries']));self.assertTrue(all(e['source'].startswith('/api/job-output?')for e in body['entries']));self.assertTrue(body['warnings'])
    entry=next(e for e in body['entries']if e['name']=='output.png');self.assertIn('Kiln',entry['label']);conn=http.client.HTTPConnection(*server.server_address);conn.request('GET',entry['source']);r=conn.getresponse();self.assertEqual(r.status,200);self.assertEqual(r.read(),b'artifact');conn.close()
   finally:server.shutdown();server.server_close();thread.join();serve.BROWSE_ROOTS['greenroom']=old

class MalformedRecords(unittest.TestCase):
 def test_bad_record_shapes_do_not_hide_the_healthy_asset(self):
  old=serve.BROWSE_ROOTS['greenroom']
  try:
   for surface in ['receipt','metadata']:
    for bad in [None,[], 'invalid-object']:
     with self.subTest(surface=surface,bad=bad),tempfile.TemporaryDirectory() as temporary:
      queue=Path(temporary);serve.BROWSE_ROOTS['greenroom']=queue
      for id in ['healthy','bad']:
       folder=queue/'done'/id;folder.mkdir(parents=True);output=queue/'outputs'/id;output.mkdir(parents=True);(output/'mesh.glb').write_bytes(b'mesh')
       receipt={'job_id':id,'job_type':'trellis2mlx','status':'done','exit_code':0,'output_dir':str(output)};metadata={'job_id':id,'output_files':['mesh.glb']}
       (folder/'receipt.json').write_text(json.dumps(bad if id=='bad'and surface=='receipt'else receipt));(output/'metadata.json').write_text(json.dumps(bad if id=='bad'and surface=='metadata'else metadata))
      result=serve.authoring_asset_catalog('greenroom');self.assertEqual(len(result['entries']),1);self.assertEqual(result['entries'][0]['jobId'],'healthy');self.assertEqual(len(result['warnings']),1)
  finally:serve.BROWSE_ROOTS['greenroom']=old

if __name__=='__main__':unittest.main()
