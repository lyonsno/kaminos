# kaminos-test: python
"""Iron Gland storage contracts exercised through the actual local HTTP server."""
import hashlib
import http.client
import json
import math
import os
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from urllib.parse import urlencode
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import serve


class CaptureServer(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name).resolve() / "captures"
        self.env = patch.dict(os.environ, KAMINOS_IRON_GLAND_CAPTURE_ROOT=str(self.root))
        self.env.start()
        self.server = serve.KaminosServer(("127.0.0.1", 0), serve.KaminosHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.env.stop()
        self.tmp.cleanup()

    def call(self, action=None, body=None, method="POST", headers=None, **query):
        if action:
            query["action"] = action
        raw = body if isinstance(body, bytes) else json.dumps(body).encode() if body is not None else None
        connection = http.client.HTTPConnection(*self.server.server_address)
        connection.request(method, "/api/iron-gland-capture?" + urlencode(query), raw,
                           headers or {"Content-Type": "application/json"})
        response = connection.getresponse()
        data = response.read()
        connection.close()
        self.assertIn("application/json", response.getheader("Content-Type", ""), data)
        return response.status, json.loads(data)

    def start(self, **metadata):
        status, result = self.call("start", {"scene": "palm", "feature": "decoder3d.sampled",
                                            "status": "complete", "id": "spoof", **metadata})
        self.assertEqual(status, 200, result)
        return result

    def write(self, capture, name, body):
        return self.call("write", body, id=capture["id"], name=name)

    def frame(self, capture, index=0, layout=None, raw=b"\0" * 8, **metadata):
        layout = [{"name": "decoder3d.sampled", "shape": [2], "offset": 0, "length": 2}] if layout is None else layout
        stem = f"frames/{index:08d}"
        self.assertEqual(self.write(capture, stem + ".png", b"png")[0], 200)
        self.assertEqual(self.write(capture, stem + ".json", json.dumps({
            "index": index, "captureAtMs": 1, "completedAtMs": 2, "layout": layout,
            "hasHand": bool(layout), **metadata}).encode())[0], 200)
        if layout:
            self.assertEqual(self.write(capture, stem + ".f32", raw)[0], 200)

    def finish(self, capture, **metadata):
        return self.call("finish", {"status": "complete", "frameCount": 1, "videoChunks": 1,
                                    "eventCount": 0, **metadata}, id=capture["id"])

    def media(self, capture):
        self.assertEqual(self.write(capture, "topology.u16", b"\0\0")[0], 200)
        self.assertEqual(self.write(capture, "video/00000000.webm", b"video")[0], 200)

    def test_recording_survives_and_destination_is_server_owned(self):
        capture = self.start()
        path = self.root / capture["id"]
        self.assertEqual(capture["path"], str(path))
        manifest = json.loads((path / "manifest.json").read_text())
        self.assertEqual((manifest["status"], manifest["scene"]), ("recording", "palm"))
        self.assertEqual(self.call(method="GET")[1]["root"], str(self.root))
        self.assertEqual(self.call(method="GET", id=capture["id"])[1], manifest)
        self.assertNotEqual(capture["id"], self.start()["id"])

    def test_write_receipt_idempotency_and_rejections(self):
        capture = self.start()
        name = "events/00000000.json"
        status, receipt = self.write(capture, name, b"{}")
        self.assertEqual((status, receipt), (200, {"name": name, "bytes": 2,
                                                  "sha256": hashlib.sha256(b"{}").hexdigest()}))
        self.assertEqual(self.write(capture, name, b"{}")[1], receipt)
        self.assertEqual(self.write(capture, name, b"changed")[0], 409)
        for bad in ("../escape", "/tmp/file", "frames/1.png", "manifest.json", "frames/00000000.png/extra"):
            self.assertEqual(self.write(capture, bad, b"x")[0], 400, bad)
        self.assertEqual(self.write(capture, "topology.u16", b"")[0], 400)
        self.assertEqual(self.call("write", b"x", id="../escape", name="topology.u16")[0], 400)
        self.assertEqual((self.root / capture["id"] / name).read_bytes(), b"{}")

    def test_complete_and_negative_frame(self):
        for layout in (None, []):
            capture = self.start()
            self.frame(capture, layout=layout)
            self.media(capture)
            self.write(capture, "events/00000000.json", b"{}")
            status, manifest = self.finish(capture, videoChunks=1, eventCount=1, reason="stopped")
            self.assertEqual(status, 200, manifest)
            self.assertEqual((manifest["status"], manifest["frameCount"], manifest["scene"]), ("complete", 1, "palm"))
            self.assertEqual(self.write(capture, "topology.u16", b"x")[0], 409)

    def test_false_completion_keeps_files_and_persists_partial(self):
        cases = [({}, 0, None, b"\0" * 8), ({}, 1, None, b"\0" * 8),
                 ({}, 0, [{"name": "x", "shape": [3], "offset": 0, "length": 2}], b"\0" * 8),
                 ({}, 0, None, b"\0" * 4), ({"videoChunks": 2}, 0, None, b"\0" * 8),
                 ({"eventCount": 1}, 0, None, b"\0" * 8), ({"frameCount": 2}, 0, None, b"\0" * 8)]
        for position, (counts, index, layout, raw) in enumerate(cases):
            capture = self.start()
            self.media(capture)
            if position:
                self.frame(capture, index, layout, raw)
            status, result = self.finish(capture, **counts)
            self.assertEqual(status, 409, result)
            manifest = self.call(method="GET", id=capture["id"])[1]
            self.assertEqual(manifest["status"], "partial")
            self.assertTrue(manifest["validationErrors"])
            if position:
                self.assertTrue((self.root / capture["id"] / f"frames/{index:08d}.png").exists())

    def test_partial_failed_and_origin_errors(self):
        for status in ("partial", "failed"):
            capture = self.start()
            code, manifest = self.finish(capture, status=status, reason="browser stopped")
            self.assertEqual((code, manifest["status"], manifest["frameCount"]), (200, status, 0))
        self.assertEqual(self.call("start", {}, headers={"Origin": "http://evil.example", "Content-Type": "application/json"})[0], 403)
        self.assertEqual(self.call("start", b"oops")[0], 400)
        self.assertEqual(self.call("start", [])[0], 400)
        self.assertEqual(self.call("start", {}, headers={"Content-Type": "text/plain"})[0], 415)
        self.assertEqual(self.call("unknown", {})[0], 400)

    def test_missing_frame_parts_bad_layout_and_metadata(self):
        mutations = [lambda path: (path / "frames/00000000.png").unlink(),
                     lambda path: (path / "frames/00000000.json").unlink(),
                     lambda path: (path / "frames/00000000.f32").unlink(),
                     lambda path: (path / "frames/00000000.json").write_bytes(b"{}"),
                     lambda path: (path / "frames/00000000.json").write_bytes(b"invalid")]
        for mutate in mutations:
            capture = self.start()
            self.media(capture)
            self.frame(capture)
            mutate(Path(capture["path"]))
            self.assertEqual(self.finish(capture)[0], 409)
        for layout in ([{"name": "x", "shape": [2], "offset": 1, "length": 2}],
                       [{"name": "x", "shape": [-2], "offset": 0, "length": 2}]):
            capture = self.start()
            self.media(capture)
            self.frame(capture, layout=layout)
            self.assertEqual(self.finish(capture)[0], 409)
        capture = self.start()
        self.media(capture)
        self.frame(capture, layout=[])
        self.write(capture, "frames/00000000.f32", b"extra")
        self.assertEqual(self.finish(capture)[0], 409)

    def test_local_origin_host_and_missing_capture(self):
        port = self.server.server_address[1]
        self.assertEqual(self.call("start", {}, headers={"Content-Type": "application/json",
                                                        "Origin": f"http://localhost:{port}"})[0], 200)
        self.assertEqual(self.call("start", {}, headers={"Content-Type": "application/json",
                                                        "Host": "evil.example"})[0], 403)
        self.assertEqual(self.call(method="GET", id="00000000-0000-4000-8000-000000000000")[0], 404)

    def test_complete_requires_video_and_topology(self):
        for missing in ("video", "topology", "empty-topology"):
            with self.subTest(missing=missing):
                capture = self.start()
                self.frame(capture)
                if missing != "video":
                    self.write(capture, "video/00000000.webm", b"video")
                if missing != "topology":
                    self.write(capture, "topology.u16", b"\0\0")
                if missing == "empty-topology":
                    (Path(capture["path"]) / "topology.u16").write_bytes(b"")
                status, manifest = self.finish(capture, videoChunks=0 if missing == "video" else 1)
                self.assertEqual(status, 409, manifest)
                self.assertEqual(manifest["status"], "partial")
                self.assertTrue(manifest["validationErrors"])

    def test_complete_rejects_frame_errors_and_missing_hand_features(self):
        cases = ({"error": "inference failed"}, {"hasHand": True, "layout": []},
                 {"layout": [{"name": "unrelated", "shape": [2], "offset": 0, "length": 2}]})
        for metadata in cases:
            with self.subTest(metadata=metadata):
                capture = self.start()
                self.media(capture)
                self.frame(capture, **metadata)
                status, manifest = self.finish(capture, videoChunks=1)
                self.assertEqual(status, 409, manifest)
                self.assertEqual(manifest["status"], "partial")

    def test_finish_protects_provenance_and_retries_without_mutation(self):
        provenance = {"identity": {"operator": "original"}, "settings": {"gain": 2},
                      "source": {"kind": "live-camera"}, "runtime": {"route": "native"}}
        capture = self.start(**provenance)
        self.media(capture)
        self.frame(capture)
        overrides = {key: {"spoof": True} for key in provenance}
        status, manifest = self.finish(capture, videoChunks=1, reason="done", **overrides,
                                       feature="unrelated", scene="replacement", arbitrary="injected")
        self.assertEqual(status, 200, manifest)
        for key, value in {**provenance, "feature": "decoder3d.sampled", "scene": "palm"}.items():
            self.assertEqual(manifest[key], value)
        self.assertNotIn("arbitrary", manifest)
        first = (Path(capture["path"]) / "manifest.json").read_bytes()
        self.assertEqual(self.finish(capture, videoChunks=1, reason="done"), (200, manifest))
        self.assertEqual((Path(capture["path"]) / "manifest.json").read_bytes(), first)
        self.assertEqual(self.finish(capture, status="failed", videoChunks=1, reason="different")[0], 409)
        self.assertEqual((Path(capture["path"]) / "manifest.json").read_bytes(), first)

    def test_rejected_completion_retry_preserves_original_terminal_result(self):
        capture = self.start()
        self.frame(capture)
        first = self.finish(capture)
        self.assertEqual(first[0], 409)
        self.assertEqual(self.finish(capture), first)
        self.assertEqual(self.finish(capture, status="partial")[0], 409)
        self.assertEqual(self.call(method="GET", id=capture["id"])[1], first[1])

    def test_finalization_retry_is_byte_stable_and_conflicts_are_rejected(self):
        capture = self.start()
        self.frame(capture)
        first = self.finish(capture, status="partial", reason="operator-stopped")
        self.assertEqual(first[0], 200)
        manifest_path = Path(capture["path"]) / "manifest.json"
        raw = manifest_path.read_bytes()
        with patch("time.time_ns", return_value=0):
            self.assertEqual(self.finish(capture, status="partial", reason="operator-stopped"), first)
        self.assertEqual(manifest_path.read_bytes(), raw)
        self.assertEqual(self.finish(capture, status="failed", reason="changed")[0], 409)
        self.assertEqual(manifest_path.read_bytes(), raw)

    def test_native_hand_layout_and_generic_declared_feature(self):
        layout, offset = [], 0
        for name, shape in (("nativeVertices", [778, 3]), ("nativeUV", [21, 2]),
                            ("verticesMeters", [778, 3]), ("cropUV", [21, 2]),
                            ("decoder3d.sampled", [21, 256])):
            length = math.prod(shape)
            layout.append({"name": name, "shape": shape, "offset": offset, "length": length})
            offset += length
        capture = self.start()
        self.media(capture)
        self.frame(capture, layout=layout, raw=b"\0" * (offset * 4))
        self.assertEqual(self.finish(capture)[0], 200)
        capture = self.start(feature="other.feature")
        self.media(capture)
        self.frame(capture, layout=[{"name": "other.feature", "shape": [2], "offset": 0, "length": 2}])
        self.assertEqual(self.finish(capture)[0], 200)


if __name__ == "__main__":
    unittest.main()
