import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from threading import Thread
import unittest
import resource
import signal
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError

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

    def test_interrupted_write_stays_out_of_catalog_and_retries_exact_pixels(self):
        # Real OS write failure, isolated to this test process and its temporary store.
        # It exercises both direct writes and temporary-file publication without mocking either.
        body = b'image-transport-fixture' * 256
        before = {row['source'] for row in serve.list_asset_entries(kind='image')}
        old_limit = resource.getrlimit(resource.RLIMIT_FSIZE)
        old_signal = signal.signal(signal.SIGXFSZ, signal.SIG_IGN)
        try:
            resource.setrlimit(resource.RLIMIT_FSIZE, (128, old_limit[1]))
            with self.assertRaises(OSError):
                serve.ingest_image_asset('interrupted.png', body)
        finally:
            resource.setrlimit(resource.RLIMIT_FSIZE, old_limit)
            signal.signal(signal.SIGXFSZ, old_signal)
        self.assertEqual({row['source'] for row in serve.list_asset_entries(kind='image')}, before,
                         'a failed image write must not publish partial pixels into Assets')
        entry = self.ingest('interrupted.png', body)
        with urlopen(self.base + entry['source']) as response:
            self.assertEqual(response.read(), body, 'retry must save the original bytes without regeneration')
        self.assertEqual(self.ingest('interrupted.png', body)['source'], entry['source'])

    def test_metadata_failure_reports_failed_save_without_publishing_an_unlabelled_image(self):
        name = 'long-name-' + 'x' * 190 + '.png'
        body = b'complete-image-transport'
        before = {row['source'] for row in serve.list_asset_entries(kind='image')}
        old_limit = resource.getrlimit(resource.RLIMIT_FSIZE)
        old_signal = signal.signal(signal.SIGXFSZ, signal.SIG_IGN)
        try:
            resource.setrlimit(resource.RLIMIT_FSIZE, (128, old_limit[1]))
            with self.assertRaises(HTTPError) as failed:
                self.ingest(name, body)
            self.assertEqual(failed.exception.code, 500)
            self.assertEqual(json.load(failed.exception)['phase'], 'image-persistence')
        finally:
            resource.setrlimit(resource.RLIMIT_FSIZE, old_limit)
            signal.signal(signal.SIGXFSZ, old_signal)
        self.assertEqual({row['source'] for row in serve.list_asset_entries(kind='image')}, before,
                         'metadata failure must not expose an image under its storage hash')
        self.assertEqual(list(Path(self.directory.name).rglob('.image-*')), [], 'failed saves clean up temporary files')
        entry = self.ingest(name, body)
        self.assertEqual(entry['name'], name)
        with urlopen(self.base + entry['source']) as response:
            self.assertEqual(response.read(), body)

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
