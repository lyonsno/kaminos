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


class FakeHub(FakePage):
    """Reads a hub stream the way the shared worker does, and answers each command for the page it names."""

    def __init__(self, port, hub_id):
        self.port, self.page_id, self.answer = port, None, True
        self.commands = queue.Queue()
        self.connection = http.client.HTTPConnection("127.0.0.1", port, timeout=30)
        self.connection.connect()
        self.sock = self.connection.sock
        self.connection.request("GET", f"/api/vantage/hub?hub={hub_id}")
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
                        call(self.port, "POST", "/api/vantage/reply", {
                            "page": message["page"], "id": message["id"], "ok": True,
                            "result": {"echo": message["command"], "page": message["page"]},
                        })
                    event, data = None, []
        except (OSError, ValueError):
            return


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

    hub_contracts(bridge)


def hub_contracts(bridge):
    """One hub stream carries many pages: every tab of a browser shares it, so
    open tabs never use up the browser's few connections to the server."""
    broker = bridge.VantageBroker()
    hub = broker.attach_hub("hub-aaaaaaaa")
    assert broker.join("hub-aaaaaaaa", "page-hhhhhhh1", {"visible": True, "focused": True}) is True
    assert broker.join("hub-aaaaaaaa", "page-hhhhhhh2", {"visible": False}) is True
    try:
        broker.join("hub-unknown0", "page-hhhhhhh3", {})
        raise AssertionError("a page cannot join a hub that is not linked")
    except bridge.VantageError as error:
        assert error.phase == "hub", error.phase
    described = {page["id"]: page for page in broker.pages()}
    assert described["page-hhhhhhh1"]["connected"] and described["page-hhhhhhh2"]["connected"], described
    assert described["page-hhhhhhh2"]["hub"] == "hub-aaaaaaaa"

    outcomes = {}

    def submit_as(name, page):
        try:
            outcomes[name] = broker.submit("status", {}, page=page, timeout=5)
        except bridge.VantageError as error:
            outcomes[name] = error

    workers = [threading.Thread(target=submit_as, args=(name, page)) for name, page in (("first", "page-hhhhhhh1"), ("second", "page-hhhhhhh2"))]
    for worker in workers:
        worker.start()
        time.sleep(0.05)
    delivered = []
    deadline = time.monotonic() + 3
    while len(delivered) < 2 and time.monotonic() < deadline:
        message = broker.next_message(hub, 0.05)
        if message:
            delivered.append(message)
    assert [message["page"] for message in delivered] == ["page-hhhhhhh1", "page-hhhhhhh2"], "each command names its page, in the order sent"
    assert broker.reply("page-hhhhhhh1", delivered[0]["id"], {"ok": True, "result": {"kind": "status"}}) is True
    assert broker.leave("hub-aaaaaaaa", "page-hhhhhhh2") is True, "a tab that closes leaves its hub"
    for worker in workers:
        worker.join(3)
    assert outcomes["first"]["ok"] is True, outcomes["first"]
    assert isinstance(outcomes["second"], bridge.VantageError) and outcomes["second"].phase == "disconnected", "only the page that left fails"
    assert [page["id"] for page in broker.pages()] == ["page-hhhhhhh1"], "and only it is forgotten"
    assert broker.leave("hub-aaaaaaaa", "page-hhhhhhh1") is True and broker.leave("hub-aaaaaaaa", "page-hhhhhhh1") is False

    # Memberships are numbered: a late leave, or a late older join, cannot undo a newer join.
    assert broker.join("hub-aaaaaaaa", "page-mmmmmmm1", {}, member=1) is True
    assert broker.join("hub-aaaaaaaa", "page-mmmmmmm1", {}, member=2) is True
    assert broker.leave("hub-aaaaaaaa", "page-mmmmmmm1", member=1) is False, "a leave for an older membership changes nothing"
    assert any(page["id"] == "page-mmmmmmm1" for page in broker.pages())
    assert broker.join("hub-aaaaaaaa", "page-mmmmmmm1", {}, member=1) is False, "nor does a late older join"
    assert broker.leave("hub-aaaaaaaa", "page-mmmmmmm1", member=2) is True
    assert not any(page["id"] == "page-mmmmmmm1" for page in broker.pages())
    assert broker.join("hub-aaaaaaaa", "page-mmmmmmm1", {}, member=1) is False, "a join older than the membership that left cannot bring the page back"
    assert broker.leave("hub-aaaaaaaa", "page-mmmmmmm2", member=1) is False
    assert broker.join("hub-aaaaaaaa", "page-mmmmmmm2", {}, member=1) is False, "nor can a join that arrives after its own leave"
    assert not any(page["id"] in ("page-mmmmmmm1", "page-mmmmmmm2") for page in broker.pages())
    assert broker.join("hub-aaaaaaaa", "page-mmmmmmm3", {}, member=3) is True
    assert broker.leave("hub-aaaaaaaa", "page-mmmmmmm3", member=3) is True
    broker.attach_hub("hub-aaaaaaaa")
    assert broker.join("hub-aaaaaaaa", "page-mmmmmmm3", {}, member=2) is False, "a reconnected hub still knows what left"
    hub = broker._hubs["hub-aaaaaaaa"]

    broker.join("hub-aaaaaaaa", "page-hhhhhhh4", {})
    replaced = broker.attach_hub("hub-aaaaaaaa")
    assert broker.pages() == [], "a hub that links again starts empty: its pages join it again"
    try:
        broker.next_message(hub, 0.01)
        raise AssertionError("the replaced hub stream is closed")
    except bridge.LinkClosed:
        pass
    broker.join("hub-aaaaaaaa", "page-hhhhhhh5", {})
    broker.detach(replaced)
    assert broker.pages() == [], "a hub that closes takes its pages with it"


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

            assert body.get("hub") is True, "the server says it can carry pages on a shared hub stream"
            hub = FakeHub(port, "hub-httptest")
            pages.append(hub)
            assert hub.status == 200 and hub.content_type.startswith("text/event-stream")
            wait_until(lambda: call(port, "POST", "/api/vantage/join", {"hub": "hub-httptest", "page": "page-hubbbbb1", "visible": False})[0] == 200,
                       "a page could not join the hub")
            status, body = call(port, "POST", "/api/vantage/join", {"hub": "hub-missing", "page": "page-hubbbbb2"})
            assert status == 409 and body["phase"] == "hub", (status, body)
            status, body = call(port, "POST", "/api/vantage/command", {"command": "move", "args": {"forward": 1}, "page": "page-hubbbbb1"})
            assert status == 200 and body["ok"] is True and body["result"]["page"] == "page-hubbbbb1", (status, body)
            status, body = call(port, "POST", "/api/vantage/leave", {"hub": "hub-httptest", "page": "page-hubbbbb1"})
            assert status == 200 and body["ok"] is True
            assert not any(page["id"] == "page-hubbbbb1" for page in connected_pages(port)), "a page that left is not listed"
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
