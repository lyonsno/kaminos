# kaminos-test: python
"""Exercise the actual native catalogue/store HTTP boundary without inference."""
import base64, hashlib, json, sys, tempfile, unittest
from pathlib import Path
from threading import Thread
from unittest.mock import patch
from urllib.request import Request, urlopen
from urllib.error import HTTPError
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import serve
import authoring_asset_catalog

class ExperimentsHttp(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.directory = Path(self.tmp.name)
        self.patch = patch.object(serve, 'IMAGE_EXPERIMENTS_DIR', self.directory/'experiments', create=True)
        self.patch.start()
        self.images = patch.dict(serve.BROWSE_ROOTS, {'experiment-test':self.directory})
        self.images.start()
        self.source = '/api/read?root=experiment-test&path=glove.png'
        (self.directory/'glove.png').write_bytes(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='))
        self.server = serve.http.server.ThreadingHTTPServer(('127.0.0.1',0),serve.KaminosHandler)
        self.thread=Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.url=f'http://127.0.0.1:{self.server.server_port}/api/image-experiments'
    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join()
        self.images.stop();self.patch.stop();self.tmp.cleanup()
    def call(self, payload=None, query=''):
        request=Request(self.url+query, data=json.dumps(payload).encode() if payload is not None else None,
                        headers={'Content-Type':'application/json'})
        try:
            with urlopen(request) as r:return r.status,json.load(r)
        except HTTPError as e:
            body=e.read()
            try:value=json.loads(body)
            except ValueError:value={'error':body.decode()}
            return e.code,value
    def create(self):
        status,value=self.call({'action':'create','id':'gloves','title':'Glove flight','description':'Direct versus expanded','agent':{'id':'ghost','label':'Ghost'},'members':[{'source':self.source,'name':'Glove','group':'Direct','role':'result'}]})
        self.assertEqual(status,200,value)
        return value
    def test_catalogue_is_a_native_persistent_experiment_collection(self):
        status,value=self.call()
        self.assertEqual(status,200,'Native experiment catalogue is missing; an external sheet is not the browser')
        self.assertEqual(value['schema'],'kaminos.image-experiment-catalog.v1')
        self.assertEqual(value['entries'],[])
        doc=self.create()
        self.assertEqual(doc['title'],'Glove flight')
        self.assertEqual(self.call(query='?id=gloves')[1]['members'][0]['source'],self.source)
        self.assertEqual(self.call()[1]['entries'][0]['id'],'gloves')
        self.assertTrue((self.directory/'experiments/gloves.json').is_file())
    def test_membership_retry_is_idempotent_and_metadata_update_cannot_drop_a_rerun(self):
        old=self.create()
        (self.directory/'second.png').write_bytes((self.directory/'glove.png').read_bytes())
        second={'source':'/api/read?root=experiment-test&path=second.png','name':'Rerun','group':'Variations'}
        for _ in range(2):
            status,current=self.call({'action':'add','id':'gloves','members':[second]});self.assertEqual(status,200,current)
        self.assertEqual(len(current['members']),2)
        status,value=self.call({'action':'update','id':'gloves','revision':old['revision'],'title':'Stale edit'})
        self.assertEqual(status,409,value)
        status,value=self.call({'action':'update','id':'gloves','revision':current['revision'],'title':'Renamed'})
        self.assertEqual(status,200,value);self.assertEqual(len(value['members']),2)
    def test_missing_unsafe_or_withheld_sources_cannot_become_browsable_members(self):
        self.create()
        for source in ['/api/read?root=experiment-test&path=missing.png','https://elsewhere/image.png','/api/read?root=experiment-test&path=../escape.png']:
            status,value=self.call({'action':'add','id':'gloves','members':[{'source':source}]})
            self.assertNotEqual(status,200,value)
        self.assertEqual(len(self.call(query='?id=gloves')[1]['members']),1)
        holds=self.directory/'holds.json'
        raw=(self.directory/'glove.png').read_bytes()
        holds.write_text(json.dumps({'schema':'kaminos.asset-visibility-holds.v1','holds':[{
            'id':'held-glove','label':'Withheld glove','kind':'image','basis':'Test hold',
            'sha256':hashlib.sha256(raw).hexdigest(),'size':len(raw),'sources':[self.source]}]}))
        with patch.object(authoring_asset_catalog,'HOLDS_PATH',holds):
            self.assertEqual(self.call({'action':'add','id':'gloves','members':[{'source':self.source}]})[0],400)
            member=self.call(query='?id=gloves')[1]['members'][0]
            self.assertEqual(member['availability'],'withheld')
            self.assertIsNone(member.get('preview'))
            self.assertNotIn('provenance',member['entry'])
        for id in ['../escape','/absolute']:
            self.assertEqual(self.call({'action':'create','id':id,'title':'Bad'})[0],400)
        (self.directory/'glove.png').unlink()
        item=self.call(query='?id=gloves')[1]['members'][0]
        self.assertEqual(item['availability'],'missing')
        self.assertIsNone(item.get('preview'))

if __name__=='__main__':unittest.main()
