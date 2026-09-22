import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from threading import Thread
import unittest
from urllib.parse import urlencode
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import serve


class ImageHttpContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = TemporaryDirectory()
        cls.root = next(row for row in serve.ASSET_ROOTS if row['id'] == 'image-inbox')
        cls.previous = cls.root['path'], serve.BROWSE_ROOTS['image-inbox']
        cls.root['path'] = serve.BROWSE_ROOTS['image-inbox'] = Path(cls.directory.name)
        cls.server = serve.http.server.ThreadingHTTPServer(('127.0.0.1', 0), serve.KaminosHandler)
        cls.thread = Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f'http://127.0.0.1:{cls.server.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        cls.root['path'], serve.BROWSE_ROOTS['image-inbox'] = cls.previous
        cls.directory.cleanup()

    def ingest(self, name, body):
        request = Request(self.base + '/api/ingest-image?' + urlencode({'name': name}), data=body)
        with urlopen(request) as response:
            self.assertEqual(response.status, 200)
            return json.load(response)['entry']

    def test_webp_binary_transport(self):
        # Transport bytes, not a WebP decode fixture; live browser decode is separate.
        body = b'RIFF\x00\xff\x80\x00WEBPbinary-transport'
        entry = self.ingest('input.webp', body)
        with urlopen(self.base + entry['source']) as response:
            self.assertEqual(response.headers.get_content_type(), 'image/webp')
            self.assertEqual(response.read(), body)

    def test_long_derived_name_survives_persistence_and_library_reload(self):
        name = 'a' * 230 + '-front-left-wheel-all-mask.png'
        body = b'source-size-mask-transport'
        entry = self.ingest(name, body)
        self.assertEqual(entry['name'], name)
        self.assertEqual(self.ingest(name, body)['source'], entry['source'])
        with urlopen(self.base + entry['source']) as response:
            self.assertEqual(response.headers.get_content_type(), 'image/png')
            self.assertEqual(response.read(), body)
        with urlopen(self.base + '/api/assets?kind=image') as response:
            rows = json.load(response)['entries']
        stored = next(row for row in rows if row['source'] == entry['source'])
        self.assertEqual(stored['name'], name)


if __name__ == '__main__':
    unittest.main()
