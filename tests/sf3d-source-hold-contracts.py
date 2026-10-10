"""Exercise the actual handler; tiny source fixture, no model payload or GPU."""
import functools
import http.client
import http.server
import importlib.util
import json
from pathlib import Path
import tempfile
import threading

REPO = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("kaminos_serve", REPO / "serve.py")
serve = importlib.util.module_from_spec(spec)
spec.loader.exec_module(serve)


def main():
    with tempfile.TemporaryDirectory(prefix="kaminos-sf3d-hold-") as fixture:
        root = Path(fixture).resolve()
        source = root / "lib/sf3d/weights.bin"
        source.parent.mkdir(parents=True)
        source.write_bytes(b"tiny fixture; never canonical model weights")
        (root / "alias.bin").symlink_to(source)
        (root / "ordinary.txt").write_text("ordinary content")
        serve.ROOT = root
        serve.BROWSE_ROOTS["fixture"] = root
        serve.BROWSE_ROOTS["greenroom"] = root
        serve.find_greenroom_receipt = lambda _: {"output_dir": str(root)}
        serve.resolve_greenroom_output_dir = lambda _: root
        # Exact observed little-box identity, not RAM-class inference. This
        # synthetic row tests policy only; live sysctl conformance is separate.
        if hasattr(serve, "observe_sf3d_source_host"):
            observed = {
                "source": "live-macos-sysctl", "platform": "darwin",
                "machine": "Mac14,9", "cpu": "Apple M2 Pro",
                "hostTotalBytes": 17179869184,
            }
            serve.observe_sf3d_source_host = lambda: observed
            serve.observe_sf3d_source_host = lambda: {"source": "live-source-host", "platform": "linux", "atUnixMs": 1}
            unmatched = serve.sf3d_source_admission()
            assert unmatched["verdict"] == "not-applicable"
            assert unmatched["weightSource"] == {
                "source": "live-source-file-stat", "requestedPath": "/lib/sf3d/weights.bin",
                "sourcePath": str(source.resolve()), "bytes": source.stat().st_size,
            }, "non-held source must report its actual file length, not a model constant"
            serve.ROOT = root / "absent"
            missing = serve.sf3d_source_admission()
            assert missing["verdict"] == "refused" and missing["failurePhase"] == "weight-source-metadata"
            serve.ROOT = root
            serve.observe_sf3d_source_host = lambda: observed
            for bad in [{}, {"source": "cache", "platform": "linux"},
                        {**observed, "source": "replay"},
                        {**observed, "hostTotalBytes": True},
                        {**observed, "cpu": "unverified"}]:
                serve.observe_sf3d_source_host = lambda bad=bad: bad
                assert serve.sf3d_source_admission()["verdict"] == "refused", (bad, "unknown identity released source hold")
            serve.observe_sf3d_source_host = lambda: observed
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), serve.KaminosHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            for method, route in [("HEAD", "/lib/sf3d/weights.bin"),
                                  ("GET", "/lib/sf3d/%77eights.bin?raw"),
                                  ("GET", "/alias.bin"),
                                  ("GET", "/api/read?root=fixture&path=alias.bin"),
                                  ("GET", "/api/job-output?job_id=fixture&file=alias.bin")]:
                connection = http.client.HTTPConnection("127.0.0.1", server.server_port)
                connection.request(method, route)
                response = connection.getresponse()
                body = response.read()
                assert response.status == 503, (method, route, response.status, "full source reached handler instead of held refusal")
                assert response.getheader("X-SF3D-Memory-Authority") == "circuit-breaker-only"
                assert response.getheader("Cache-Control") == "no-store"
                if method == "HEAD":
                    assert body == b""
                else:
                    report = json.loads(body)
                    assert report["verdict"] == "refused" and report["authority"] == "circuit-breaker-only"
                    assert report["sourcePath"] == str(source.resolve())
                    assert report["modelPayloadBytesServed"] == 0
                connection.close()
            connection = http.client.HTTPConnection("127.0.0.1", server.server_port)
            connection.request("GET", "/ordinary.txt")
            response = connection.getresponse()
            assert response.status == 200 and response.read() == b"ordinary content"
            connection.close()
            print("SF3D actual handler source-hold contracts passed")
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == "__main__":
    main()
