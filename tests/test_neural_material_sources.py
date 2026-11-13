# kaminos-test: python
import json
import tempfile
import unittest
from pathlib import Path
import neural_material_sources as sources

class Sources(unittest.TestCase):
    def test_roundtrip_and_preserve_annotations(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            first = sources.register(root, 'causeway/tuned.json', {'sourceKind':'causeway','source':{'relief':.003},'note':'keep'})
            second = sources.register(root, 'causeway/tuned.json', {'sourceKind':'causeway','source':{'relief':.006}})
            self.assertEqual(second['note'], 'keep')
            self.assertEqual(json.loads(Path(first['path']).read_text())['source']['relief'], .006)
            self.assertEqual(len(sources.catalogue(root)), 1)
            for invalid in ['../outside.json', '/absolute.json', 'bad.txt']:
                with self.assertRaises(ValueError): sources.register(root, invalid, {'sourceKind':'causeway','source':{}})
            with self.assertRaises(ValueError): sources.register(root, 'causeway/tuned.json', {'sourceKind':'wrong','source':{}})
            self.assertEqual(json.loads(Path(first['path']).read_text())['source']['relief'], .006)

    def test_invalid_source_and_revision_pin_replacement(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            sources.register(root,'saved.json',{'sourceKind':'causeway','source':{'relief':.003},'sourceRevision':'old','provenance':{'revision':'old'}})
            current=sources.register(root,'saved.json',{'sourceKind':'causeway','source':{'relief':.004},'provenance':{'revision':'new','dirty':False}})
            self.assertEqual(current['sourceRevision'],'new')
            for key,value in [('width',0),('grain',True),('seed',1.2),('shoulder',.4),('contextRadius',0),('unowned',1)]:
                with self.subTest(key=key),self.assertRaises(ValueError):
                    sources.register(root,'saved.json',{'sourceKind':'causeway','source':{key:value}})
            self.assertEqual(json.loads((root/'saved.json').read_text())['source']['relief'],.004)
