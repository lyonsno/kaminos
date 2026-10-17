# kaminos-test: python
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('mechanical_proxy',Path(__file__).resolve().parents[1]/'mechanical_proxy.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


class ProxyContracts(unittest.TestCase):
    def request(self):
        return {'positions':[[0,0,0],[1,0,0],[0,1,0],[0,0,1]],'triangles':[[0,2,1],[0,1,3],[0,3,2],[1,2,3]],'settings':{'envelope':.05,'spacing':.1,'budgetSeconds':5},'source':{'id':'a','label':'Tetrahedron'}}

    def test_input(self):
        value=m.validate_input(self.request())
        self.assertEqual(value['settings']['envelope'],.05)
        self.assertGreater(value['diagonal'],0)
        self.assertEqual(len(value['sourceDigest']),64)
        for key in ['envelope','spacing','budgetSeconds']:
            r=self.request();r['settings'][key]=0
            with self.assertRaises(ValueError):m.validate_input(r)
        r=self.request();r['triangles'][0]=[0,1,99]
        with self.assertRaises(ValueError):m.validate_input(r)
        r=self.request();r['positions'][0][0]=float('nan')
        with self.assertRaises(ValueError):m.validate_input(r)

    def test_no_false_completion(self):
        with tempfile.TemporaryDirectory() as root:
            service=m.MechanicalProxyService(Path(__file__).resolve().parents[1],root)
            identity='a'*32;d=service.directory(identity);d.mkdir()
            m.write_json(d/'run.json',{'id':identity,'sourceDigest':'b'*64,'settings':self.request()['settings'],'route':m.ROUTE})
            m.write_json(d/'report.json',{'status':'passed','route':m.ROUTE,'resultSha256':'wrong'})
            with self.assertRaises(ValueError):service.read(identity,include_result=True)
            with self.assertRaises(ValueError):service.directory('../escape')
            m.write_json(d/'mesh.json',{'status':'passed','route':m.ROUTE,'sourceDigest':'c'*64,'settings':self.request()['settings']})
            import hashlib
            digest=hashlib.sha256((d/'mesh.json').read_bytes()).hexdigest()
            m.write_json(d/'report.json',{'status':'passed','route':m.ROUTE,'resultSha256':digest})
            with self.assertRaisesRegex(ValueError,'source'):service.read(identity,include_result=True)
            m.write_json(d/'report.json',{'status':'passed','route':'fallback','resultSha256':digest})
            with self.assertRaisesRegex(ValueError,'route'):service.read(identity)

    def test_terminal_queue_overrides_abandoned_running_report(self):
        with tempfile.TemporaryDirectory() as root:
            service=m.MechanicalProxyService(Path(__file__).resolve().parents[1],Path(root)/'results',queue_dir=Path(root)/'queue')
            identity='a'*32;d=service.directory(identity);d.mkdir(parents=True)
            m.write_json(d/'run.json',{'id':identity,'status':'pending','jobId':'job','route':m.ROUTE})
            m.write_json(d/'report.json',{'status':'running','phase':'meshing','route':m.ROUTE,'startedAt':1})
            queue=service.queue/'failed'/'job';queue.mkdir(parents=True)
            m.write_json(queue/'status.json',{'status':'failed','error_message':'owned supervisor terminated'})
            row=service.read(identity)
            self.assertEqual(row['status'],'failed')
            self.assertEqual(row['lastBackendPhase'],'meshing')
            self.assertIn('supervisor terminated',row['error'])

    def test_keep_order_is_not_uuid_order(self):
        with tempfile.TemporaryDirectory() as root:
            service=m.MechanicalProxyService(Path(__file__).resolve().parents[1],root)
            source='b'*64;settings=self.request()['settings']
            for identity in ['f'*32,'a'*32]:
                d=service.directory(identity);d.mkdir()
                mesh={'status':'passed','route':m.ROUTE,'sourceDigest':source,'settings':settings}
                m.write_json(d/'mesh.json',mesh)
                import hashlib
                digest=hashlib.sha256((d/'mesh.json').read_bytes()).hexdigest()
                m.write_json(d/'run.json',{'id':identity,'status':'passed','route':m.ROUTE,'sourceDigest':source,'settings':settings})
                m.write_json(d/'report.json',{'status':'passed','route':m.ROUTE,'resultSha256':digest})
                service.keep(identity)
            selected=[r for r in service.list(source) if r.get('selected')]
            self.assertEqual([r['id'] for r in selected],['a'*32])
            self.assertTrue(all(r['kept'] for r in service.list(source)))


unittest.main()
