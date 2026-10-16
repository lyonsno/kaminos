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


def broker_contracts():
    """Timeouts withdraw what the page never received and say so when it did."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("vantage_bridge_under_test", ROOT / "agent_vantage_bridge.py")
    bridge = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bridge)
    broker = bridge.VantageBroker()
    link = broker.attach("page-aaaaaaaa", {})
    try:
        broker.submit("move", {"forward": 2}, timeout=0.01)
        raise AssertionError("expected a timeout")
    except bridge.VantageError as error:
        assert error.status == 504 and error.phase == "timeout" and error.details == {"delivered": False}, (error.status, error.phase, error.details)
    assert broker.next_message(link, 0.01) is None, "an expired queued command is never delivered"

    outcome = {}

    def submit():
        try:
            broker.submit("move", {"forward": 1}, timeout=0.3)
        except bridge.VantageError as error:
            outcome["error"] = error

    worker = threading.Thread(target=submit)
    worker.start()
    message, deadline = None, time.monotonic() + 3
    while message is None and time.monotonic() < deadline:
        message = broker.next_message(link, 0.05)
    assert message and message["command"] == "move", message
    assert message["expiresAt"] > time.time() * 1000, "the page learns when the command stops being wanted"
    worker.join(3)
    assert outcome["error"].details == {"delivered": True}, "a delivered command that timed out has an unknown outcome"
    assert broker.reply("page-aaaaaaaa", message["id"], {"ok": True}) is False, "a late reply is not attributed"
    broker.detach(link)
    assert broker.pages() == [], "a closed page leaves no routing record"

    # A page going hidden rests: it is sent and chosen for nothing more, a command still queued for it
    # fails at once without running, and a command already taken for delivery is listed for the page to answer.
    broker = bridge.VantageBroker()
    resting = broker.attach("page-rrrrrrrr", {"visible": True, "focused": True})
    outcomes = {}

    def submit_as(name, command):
        try:
            outcomes[name] = broker.submit(command, {}, page="page-rrrrrrrr", timeout=5)
        except bridge.VantageError as error:
            outcomes[name] = error

    sent_worker = threading.Thread(target=submit_as, args=("sent", "status"))
    sent_worker.start()
    sent, deadline = None, time.monotonic() + 3
    while sent is None and time.monotonic() < deadline:
        sent = broker.next_message(resting, 0.05)
    assert sent and sent["command"] == "status", sent
    queued_worker = threading.Thread(target=submit_as, args=("queued", "move"))
    queued_worker.start()
    deadline = time.monotonic() + 3
    while broker.pages()[0]["pendingCommands"] < 2 and time.monotonic() < deadline:
        time.sleep(0.01)
    outstanding = broker.rest("page-rrrrrrrr")["outstanding"]
    assert [item["id"] for item in outstanding] == [sent["id"]], outstanding
    assert outstanding[0]["expiresAt"] == sent["expiresAt"], "the page learns how long the sent command is wanted"
    queued_worker.join(3)
    assert isinstance(outcomes.get("queued"), bridge.VantageError) and outcomes["queued"].phase == "page-hidden", outcomes.get("queued")
    assert broker.next_message(resting, 0.01) is None, "a resting page is sent nothing"
    assert broker.pages()[0]["resting"] is True
    try:
        broker.submit("status", {}, timeout=0.2)
        raise AssertionError("a resting page must not be chosen")
    except bridge.VantageError as error:
        assert error.phase == "select", error.phase
    assert broker.reply("page-rrrrrrrr", sent["id"], {"ok": True, "result": {"kind": "status"}}) is True, "what it was sent, it still answers"
    sent_worker.join(3)
    assert outcomes["sent"]["ok"] is True, outcomes["sent"]
    assert broker.rest("page-unknown0") is None, "an unknown page has nothing to rest"

    # Visibility reports carry the page's sequence: a late, older report cannot undo a newer one.
    ordered = bridge.VantageBroker()
    ordered_link = ordered.attach("page-oooooooo", {"visible": True})
    assert ordered.presence("page-oooooooo", {"visible": False, "seq": 1}) is True
    assert ordered.rest("page-oooooooo", seq=1)["resting"] is True
    assert ordered.presence("page-oooooooo", {"visible": False, "seq": 3}) is True
    assert ordered.rest("page-oooooooo", seq=3)["resting"] is True
    assert ordered.presence("page-oooooooo", {"visible": True, "seq": 2}) is True
    assert ordered.pages()[0]["resting"] is True, "a delayed visible report from before the latest hide does not wake the page"
    assert ordered.rest("page-oooooooo", seq=2)["resting"] is False and ordered.pages()[0]["resting"] is True, "a stale rest neither rests the page nor wakes it"
    assert ordered.presence("page-oooooooo", {"visible": True, "seq": 4}) is True
    assert ordered.pages()[0]["resting"] is False, "the newest visible report does"
    stale = ordered.rest("page-oooooooo", seq=3)
    assert stale["resting"] is False and stale["outstanding"] == [], "a rest older than the page's newest report is refused"
    ordered.detach(ordered_link)
    assert broker.presence("page-rrrrrrrr", {"visible": True}) is True
    assert broker.pages()[0]["resting"] is False, "shown again, it is chosen again"
    broker.detach(resting)


def main():
    broker_contracts()
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
            status, body = call(port, "GET", "/api/vantage/pages")
            assert len(body["pages"]) == 2, "closed pages are forgotten rather than accumulating"

            status, body = call(port, "POST", "/api/vantage/rest", {"page": "page-aaaaaaaa"})
            assert status == 200 and body["ok"] is True and body["resting"] is True and body["outstanding"] == [], (status, body)
            status, body = call(port, "POST", "/api/vantage/command", {"command": "status", "args": {}, "page": "page-aaa"})
            assert status == 409 and body["phase"] == "page-hidden" and "page-aaaaaaaa" in body["error"], ("a resting page is not chosen, and says why", status, body)
            status, body = call(port, "POST", "/api/vantage/rest", {"page": "page-zzzzzzzz"})
            assert status == 404 and body["ok"] is False, (status, body)
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
