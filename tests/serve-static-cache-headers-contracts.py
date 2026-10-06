"""Static responses must carry Cache-Control: no-store.

Witnessed failure (2026-10-06, operator route): after a plain reload the page
fetched the new index.html but the browser kept a heuristically-fresh copy of
scene-placement-tools.mjs from before it exported addHistoryScope, and
initScene threw. Per-import ?v= tags only cover the imports that carry them;
the server must make every static file uncacheable.
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
        print("ok: static responses are no-store")
    finally:
        proc.terminate()
        proc.wait(timeout=10)


if __name__ == "__main__":
    main()
