# kaminos-test: python
"""HTTP contract for the agent vantage bridge: a page links over server-sent
events, a terminal posts commands, and each command returns the page's reply."""

import http.client
import json
import queue
import socket
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def free_port():
    with socket.socket() as server:
        server.bind(("127.0.0.1", 0))
        return server.getsockname()[1]


def call(port, method, path, payload=None, headers=None, timeout=10):
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=timeout)
    body = None if payload is None else json.dumps(payload).encode()
    sent = {"Content-Type": "application/json"} if body is not None else {}
    sent.update(headers or {})
    connection.request(method, path, body=body, headers=sent)
    response = connection.getresponse()
    data = response.read()
    connection.close()
    try:
        return response.status, json.loads(data or b"null")
    except ValueError:
        return response.status, data.decode(errors="replace")


class FakePage:
    """Reads the event stream like EventSource and answers commands like the page."""

    def __init__(self, port, page_id, answer=True, title="Kaminos"):
        self.port, self.page_id, self.answer = port, page_id, answer
        self.commands = queue.Queue()
        self.connection = http.client.HTTPConnection("127.0.0.1", port, timeout=30)
        self.connection.connect()
        # A streamed response takes over the socket; keep it to close like a tab.
        self.sock = self.connection.sock
        self.connection.request("GET", f"/api/vantage/link?page={page_id}&title={title}&href=http://127.0.0.1:{port}/index.html&visible=1")
        self.response = self.connection.getresponse()
        self.status = self.response.status
        self.content_type = self.response.getheader("Content-Type")
        self.thread = threading.Thread(target=self.read, daemon=True)
        if self.status == 200:
            self.thread.start()

    def read(self):
        event, data = None, []
        try:
            while True:
                line = self.response.fp.readline()
                if not line:
                    return
                line = line.decode().rstrip("\r\n")
                if line.startswith("event:"):
                    event = line[6:].strip()
                elif line.startswith("data:"):
                    data.append(line[5:].strip())
                elif line == "":
                    if event == "command" and data:
                        message = json.loads("\n".join(data))
                        self.commands.put(message)
                        if self.answer:
                            call(self.port, "POST", "/api/vantage/reply", {
                                "page": self.page_id, "id": message["id"], "ok": True,
                                "result": {"echo": message["command"], "args": message["args"], "page": self.page_id},
                            })
                    event, data = None, []
        except (OSError, ValueError):
            return

    def close(self):
        try:
            self.sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self.sock.close()
        self.connection.close()


def wait_until(predicate, message, seconds=8):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            if predicate():
                return
        except OSError:
            pass
        time.sleep(0.05)
    raise AssertionError(message)


def connected_pages(port):
    status, body = call(port, "GET", "/api/vantage/pages")
    assert status == 200, (status, body)
    return [page for page in body["pages"] if page["connected"]]


def main():
    with tempfile.TemporaryDirectory(prefix="kaminos-vantage-http-") as temporary:
        port = free_port()
        process = subprocess.Popen(
            [sys.executable, str(ROOT / "serve.py"), str(port),
             "--volume-settings-store", str(Path(temporary) / "settings"),
             "--no-shared-basin-store",
             "--volume-basin-session-store", str(Path(temporary) / "sessions"),
             "--volume-cockpit-layout-store", str(Path(temporary) / "layouts")],
            cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            env={**__import__("os").environ, "KAMINOS_BIND_HOST": "127.0.0.1"},
        )
        pages = []
        try:
            wait_until(lambda: call(port, "GET", "/api/runtime-config")[0] == 200, "server did not start")

            status, body = call(port, "GET", "/api/vantage/pages")
            assert status == 200, f"pages endpoint missing: {status} {body}"
            assert body["schema"] == "kaminos.agent-vantage.v1" and body["pages"] == []

            status, body = call(port, "POST", "/api/vantage/command", {"command": "status", "args": {}})
            assert status == 409 and body["ok"] is False and body["phase"] == "select", (status, body)
            assert f"127.0.0.1:{port}" in body["error"], "tells the agent which page to open"

            status, _ = call(port, "POST", "/api/vantage/command", {"command": "status", "args": {}},
                             headers={"Origin": "http://evil.example"})
            assert status == 403, "a foreign origin cannot drive the page"
            status, _ = call(port, "POST", "/api/vantage/command", {"command": "status", "args": {}},
                             headers={"Host": f"rebound.example:{port}"})
            assert status == 403, "a rebound host name cannot drive the page"
            connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
            connection.request("POST", "/api/vantage/command", body=b'{"command":"status"}', headers={"Content-Type": "text/plain"})
            assert connection.getresponse().status == 415, "commands must be JSON so cross-site forms need a preflight"
            connection.close()

            page_a = FakePage(port, "page-aaaaaaaa")
            pages.append(page_a)
            assert page_a.status == 200 and page_a.content_type.startswith("text/event-stream")
            wait_until(lambda: len(connected_pages(port)) == 1, "page link was not registered")

            status, body = call(port, "POST", "/api/vantage/command", {"command": "move", "args": {"forward": 2}})
            assert status == 200 and body["ok"] is True, (status, body)
            assert body["page"]["id"] == "page-aaaaaaaa"
            assert body["result"]["echo"] == "move"
            assert body["result"]["args"] == {"forward": 2}, "the server relays arguments; the shared JS module validates them"

            status, body = call(port, "POST", "/api/vantage/command", {"args": {}})
            assert status == 400 and body["phase"] == "request", (status, body)

            page_b = FakePage(port, "page-bbbbbbbb", title="Second")
            pages.append(page_b)
            wait_until(lambda: len(connected_pages(port)) == 2, "second page link was not registered")
            status, _ = call(port, "POST", "/api/vantage/presence", {"page": "page-bbbbbbbb", "visible": True, "focused": True})
            assert status == 200
            status, body = call(port, "POST", "/api/vantage/command", {"command": "status", "args": {}})
            assert body["page"]["id"] == "page-bbbbbbbb", "the most recently focused visible page is the default"
            call(port, "POST", "/api/vantage/presence", {"page": "page-aaaaaaaa", "visible": True, "focused": True})
            call(port, "POST", "/api/vantage/presence", {"page": "page-bbbbbbbb", "visible": True, "focused": True})
            status, body = call(port, "POST", "/api/vantage/command", {"command": "status", "args": {}})
            assert body["page"]["id"] == "page-aaaaaaaa", "a heartbeat that is still focused does not count as gaining focus"
            status, body = call(port, "POST", "/api/vantage/command", {"command": "status", "args": {}, "page": "page-aaa"})
            assert body["page"]["id"] == "page-aaaaaaaa", "a unique id prefix chooses the page"
            status, body = call(port, "POST", "/api/vantage/command", {"command": "status", "args": {}, "page": "page-"})
            assert status == 409 and body["phase"] == "select" and "ambiguous" in body["error"], (status, body)

            silent = FakePage(port, "page-cccccccc", answer=False)
            pages.append(silent)
            wait_until(lambda: len(connected_pages(port)) == 3, "silent page link was not registered")
            started = time.monotonic()
            status, body = call(port, "POST", "/api/vantage/command",
                                {"command": "status", "args": {}, "page": "page-ccc", "timeoutMs": 400})
            assert status == 504 and body["phase"] == "timeout", (status, body)
            assert time.monotonic() - started < 5

            result = {}
            worker = threading.Thread(target=lambda: result.update(zip(("status", "body"), call(
                port, "POST", "/api/vantage/command", {"command": "status", "args": {}, "page": "page-ccc", "timeoutMs": 20000}))))
            started = time.monotonic()
            worker.start()
            silent.commands.get(timeout=5)
            silent.close()
            worker.join(timeout=15)
            assert result.get("status") == 502 and result["body"]["phase"] == "disconnected", result
            assert time.monotonic() - started < 12, "a closed page fails its pending command without waiting for the timeout"
            wait_until(lambda: len(connected_pages(port)) == 2, "closed page still listed as connected")
        finally:
            for page in pages:
                page.close()
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
    print("agent vantage bridge contracts passed")


if __name__ == "__main__":
    main()
