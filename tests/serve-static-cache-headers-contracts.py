"""Static responses must carry Cache-Control: no-store.

Witnessed failure (2026-10-06, operator route): after a plain reload the page
fetched the new index.html but the browser kept a heuristically-fresh copy of
scene-placement-tools.mjs from before it exported addHistoryScope, and
initScene threw. Per-import ?v= tags only cover the imports that carry them;
code and page responses must remain uncacheable; bundled HDR data may revalidate.
"""
import http.client
import os
import socket
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def main():
    port = free_port()
    proc = subprocess.Popen([sys.executable, "serve.py", str(port)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        deadline = time.time() + 20
        while True:
            try:
                conn = http.client.HTTPConnection("127.0.0.1", port, timeout=2)
                conn.request("HEAD", "/scene-placement-tools.mjs")
                response = conn.getresponse()
                break
            except OSError:
                if time.time() > deadline:
                    raise SystemExit("server did not come up")
                time.sleep(0.2)
        assert response.status == 200, response.status
        cache = response.getheader("Cache-Control")
        assert cache == "no-store", f"static module Cache-Control is {cache!r}, expected 'no-store'"
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=2)
        conn.request("GET", "/index.html")
        page = conn.getresponse()
        assert page.getheader("Cache-Control") == "no-store", page.getheader("Cache-Control")
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=2)
        conn.request("HEAD", "/assets/hdr/studio_small_09_1k.hdr")
        hdr = conn.getresponse()
        assert hdr.status == 200
        assert hdr.getheader("Cache-Control") == "public, no-cache", hdr.getheader("Cache-Control")
        modified = hdr.getheader("Last-Modified")
        assert modified
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=2)
        conn.request("GET", "/assets/hdr/studio_small_09_1k.hdr", headers={"If-Modified-Since": modified})
        cached = conn.getresponse()
        assert cached.status == 304, cached.status
        assert cached.getheader("Cache-Control") == "public, no-cache"
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=2)
        conn.request("GET", "/api/runtime-config?asset=/assets/hdr/studio_small_09_1k.hdr")
        assert conn.getresponse().getheader("Cache-Control") == "no-store"
        print("ok: code/page/API no-store; bundled HDR revalidates without retransmission")
    finally:
        proc.terminate()
        proc.wait(timeout=10)


if __name__ == "__main__":
    main()
