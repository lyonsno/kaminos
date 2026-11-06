# kaminos-test: python
"""Exercise persistent static delivery without changing API stream framing."""
import http.client
from pathlib import Path
import sys
import threading
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from serve import KaminosHandler, KaminosServer


class Handler(KaminosHandler):
    def do_GET(self):
        if self.path == '/api/test-unframed':
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'complete\n')
        else:
            super().do_GET()

    def log_message(self, *args):
        pass


class ModuleConnections(unittest.TestCase):
    def setUp(self):
        self.server = KaminosServer(('127.0.0.1', 0), Handler)
        self.worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.worker.start()
        self.conn = http.client.HTTPConnection(*self.server.server_address, timeout=10)

    def tearDown(self):
        self.conn.close()
        self.server.shutdown()
        self.server.server_close()
        self.worker.join()

    def test_module_requests_share_connection_and_keep_source_fresh(self):
        self.conn.request('GET', '/scene-selection-feedback.mjs')
        first = self.conn.getresponse()
        data = first.read()
        self.assertEqual(first.status, 200)
        self.assertEqual(data, (Path(__file__).resolve().parents[1] / 'scene-selection-feedback.mjs').read_bytes())
        self.assertEqual(first.getheader('Cache-Control'), 'no-store')
        self.assertFalse(first.will_close, 'a module graph must not reconnect after every module')
        sock = self.conn.sock
        self.conn.request('GET', '/scene-visible-picking.mjs')
        second = self.conn.getresponse()
        second.read()
        self.assertEqual(second.status, 200)
        self.assertIs(self.conn.sock, sock)

    def test_api_without_length_still_ends_at_eof_after_static_request(self):
        self.conn.request('GET', '/scene-selection-feedback.mjs')
        self.conn.getresponse().read()
        self.conn.request('GET', '/api/test-unframed')
        response = self.conn.getresponse()
        self.assertEqual(response.version, 10, 'static delivery must not change API framing')
        self.assertTrue(response.will_close)
        self.assertEqual(response.read(), b'complete\n')

    def test_head_and_conditional_static_responses_remain_delimited(self):
        self.conn.request('HEAD', '/assets/hdr/studio_small_09_1k.hdr')
        head = self.conn.getresponse()
        head.read()
        self.assertEqual(head.status, 200)
        modified = head.getheader('Last-Modified')
        self.conn.request('GET', '/assets/hdr/studio_small_09_1k.hdr', headers={'If-Modified-Since': modified})
        cached = self.conn.getresponse()
        self.assertEqual(cached.status, 304)
        self.assertEqual(cached.read(), b'')
        self.conn.request('GET', '/scene-selection-feedback.mjs', headers={'Connection': 'close'})
        closing = self.conn.getresponse()
        closing.read()
        self.assertTrue(closing.will_close)


if __name__ == '__main__':
    unittest.main()
