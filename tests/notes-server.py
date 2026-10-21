# kaminos-test: python
"""Kaminos notes on the server: one append-only log shared by every server on
the machine, provenance stamped by the server, notes claimed once by the agent
they are for, and the HTTP routes the page and tools/notes.mjs use."""

import base64
import hashlib
import http.client
import importlib.util
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
PNG_URL = "data:image/png;base64," + base64.b64encode(PNG).decode()
SOURCE = {"origin": "http://127.0.0.1:1", "branch": "cc/test", "commit": "a" * 40, "dirty": False}


def load_notes():
    spec = importlib.util.spec_from_file_location("kaminos_notes_under_test", ROOT / "kaminos_notes.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def expect_error(notes, status, phase, call):
    try:
        call()
    except notes.NotesError as error:
        assert (error.status, error.phase) == (status, phase), (error.status, error.phase, str(error))
        return error
    raise AssertionError(f"expected NotesError {status} {phase}")


PAGE = {"via": "page", "pageId": "page-aaaaaaaa", "source": SOURCE}
CLI = {"via": "cli", "source": SOURCE}


def log_contracts(notes):
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "notes"
        a = notes.NotesLog(root, page_author="noah")
        b = notes.NotesLog(root, page_author="noah")  # a second server on the same machine

        first = a.post({"kind": "note", "text": "why does the plume lean here?", "to": ["@Sub-Pilot"],
                        "anchor": {"kind": "object", "id": "flame-source", "label": "Flame source"},
                        "subject": {"scene": "kiln.kaminos.json"}, "context": {"view": {"fov": 45}},
                        "picture": {"dataUrl": PNG_URL}}, origin=PAGE)
        assert first["schema"] == notes.NOTES_SCHEMA and first["type"] == "note" and first["seq"] == 1, first
        assert notes.NOTE_ID.match(first["id"]) and first["thread"] == first["id"] and first["parent"] is None, first
        assert (first["author"], first["via"], first["pageId"]) == ("noah", "page", "page-aaaaaaaa"), first
        assert first["to"] == ["sub-pilot"] and first["recipients"] == ["sub-pilot"], first
        assert first["subject"] == {"scene": "kiln.kaminos.json", "source": SOURCE}, first["subject"]
        picture = first["picture"]
        stored = root / picture["file"]
        assert stored.read_bytes() == PNG and picture["bytes"] == len(PNG), picture
        assert picture["sha256"] == hashlib.sha256(PNG).hexdigest() and (picture["width"], picture["height"]) == (1, 1), picture

        # The other server sees it, and sequence numbers stay one line across processes.
        assert [event["id"] for event in b.events()] == [first["id"]]
        reply = b.post({"kind": "note", "text": "the draft from the open side", "parent": first["id"], "author": "sub-pilot"}, origin=CLI)
        assert reply["seq"] == 2 and reply["thread"] == first["id"] and reply["anchor"] is None, reply
        assert reply["recipients"] == ["noah"], "a reply reaches the author of the note it answers"
        assert (reply["author"], reply["via"]) == ("sub-pilot", "cli") and "pageId" not in reply, reply
        nested = a.post({"kind": "note", "text": "and from the closed side?", "parent": reply["id"], "to": ["water-agent"]}, origin=PAGE)
        assert nested["thread"] == first["id"] and nested["recipients"] == ["water-agent", "sub-pilot"], nested
        assert a.last_seq == 3 and b.last_seq == 3

        # Provenance is stamped, never claimed.
        for field in ("via", "author", "id", "seq", "thread", "recipients", "pageId", "type", "at", "schema"):
            body = {"kind": "note", "text": "x", "anchor": {"kind": "scene"}, field: "forged"}
            if field != "author":
                body["author"] = "sub-pilot"
            origin = PAGE if field == "author" else CLI
            expect_error(notes, 400, "request", lambda: a.post(body, origin=origin))
        expect_error(notes, 403, "reserved-author", lambda: a.post({"kind": "note", "text": "x", "anchor": {"kind": "scene"}, "author": "noah"}, origin=CLI))
        expect_error(notes, 400, "request", lambda: a.post({"kind": "note", "text": "x", "anchor": {"kind": "scene"}}, origin=CLI))
        expect_error(notes, 400, "request", lambda: a.post({"kind": "note", "text": "x", "anchor": {"kind": "scene"}, "author": "Bad Name"}, origin=CLI))
        expect_error(notes, 400, "request", lambda: a.post({"kind": "note", "text": "  ", "anchor": {"kind": "scene"}}, origin=PAGE))
        expect_error(notes, 400, "request", lambda: a.post({"kind": "note", "text": "x"}, origin=PAGE))
        expect_error(notes, 404, "parent", lambda: a.post({"kind": "note", "text": "x", "parent": "kn-cccccccccccc"}, origin=PAGE))
        expect_error(notes, 400, "picture", lambda: a.post({"kind": "note", "text": "x", "anchor": {"kind": "scene"},
                                                            "picture": {"dataUrl": "data:image/png;base64," + base64.b64encode(b"not a png").decode()}}, origin=PAGE))
        assert a.last_seq == 3, "refused posts write nothing"

        # A note is handed to the agent it is for once; the handover is recorded.
        claimed = a.claim("sub-pilot", timeout=0)
        assert [note["id"] for note in claimed] == [first["id"], nested["id"]], claimed
        assert a.claim("sub-pilot", timeout=0.05) == []
        delivered = [event for event in b.events() if event["type"] == "delivered"]
        assert len(delivered) == 1 and delivered[0]["notes"] == [first["id"], nested["id"]], delivered
        assert (delivered[0]["recipient"], delivered[0]["route"]) == ("sub-pilot", "wait"), delivered[0]
        assert a.claim("noah", timeout=0)[0]["id"] == reply["id"]

        # A waiting agent wakes when another server records a note for it.
        assert [note["id"] for note in a.claim("water-agent", timeout=0)] == [nested["id"]]
        result = {}

        def wait():
            started = time.monotonic()
            result["notes"] = a.claim("water-agent", timeout=10)
            result["elapsed"] = time.monotonic() - started

        waiter = threading.Thread(target=wait)
        waiter.start()
        time.sleep(0.3)
        assert waiter.is_alive(), "the claim waits while nothing is addressed to it"
        listening = {row["name"]: row for row in a.presence()["listeners"]}
        assert listening.get("water-agent", {}).get("waiting") is True, a.presence()
        late = b.post({"kind": "note", "text": "the water rim is clipping", "to": ["water-agent"],
                       "anchor": {"kind": "scene"}, "author": "notes-agent"}, origin=CLI)
        waiter.join(5)
        assert not waiter.is_alive() and [note["id"] for note in result["notes"]] == [late["id"]], result
        assert result["elapsed"] < 3, result

        # Receipts: seen, resolved and reopened are stamped like posts.
        seen = b.receipt({"type": "seen", "notes": [first["id"]], "author": "sub-pilot"}, origin=CLI)
        assert (seen["type"], seen["author"], seen["notes"]) == ("seen", "sub-pilot", [first["id"]]), seen
        resolved = a.receipt({"type": "resolved", "notes": [first["id"]]}, origin=PAGE)
        assert (resolved["author"], resolved["via"]) == ("noah", "page"), resolved
        expect_error(notes, 404, "note", lambda: a.receipt({"type": "seen", "notes": ["kn-cccccccccccc"]}, origin=PAGE))
        expect_error(notes, 400, "request", lambda: a.receipt({"type": "deleted", "notes": [first["id"]]}, origin=PAGE))

        # A damaged line is reported, and the events after it still load.
        with (root / "notes.jsonl").open("a") as handle:
            handle.write("{not json\n")
        after = a.post({"kind": "ref", "anchor": {"kind": "scene"}}, origin=PAGE)
        fresh = notes.NotesLog(root, page_author="noah")
        assert fresh.events()[-1]["id"] == after["id"] and after["kind"] == "ref" and after["text"] == "", after
        assert len(fresh.issues) == 1 and "line" in fresh.issues[0], fresh.issues


def follow_up_contracts(notes):
    """A follow-up to your own reply goes where that reply went (review F1)."""
    with tempfile.TemporaryDirectory() as tmp:
        log = notes.NotesLog(Path(tmp) / "notes", page_author="noah")
        question = log.post({"kind": "note", "text": "why?", "to": ["agent"], "anchor": {"kind": "scene"}}, origin=PAGE)
        answer = log.post({"kind": "note", "text": "the light", "parent": question["id"], "author": "agent"}, origin=CLI)
        follow = log.post({"kind": "note", "text": "which light?", "parent": answer["id"]}, origin=PAGE)
        clarify = log.post({"kind": "note", "text": "the rim one, I mean", "parent": follow["id"]}, origin=PAGE)
        assert follow["recipients"] == ["agent"], follow
        assert clarify["recipients"] == ["agent"], ("a follow-up to your own reply reaches whoever that reply reached", clarify["recipients"])
        assert [note["text"] for note in log.claim("agent", timeout=0)] == ["why?", "which light?", "the rim one, I mean"]
        more = log.post({"kind": "note", "text": "and the fill light", "parent": answer["id"], "author": "agent"}, origin=CLI)
        assert more["recipients"] == ["noah"], ("an agent's second message reaches the person too", more["recipients"])
        addressed = log.post({"kind": "note", "text": "@other look too", "parent": clarify["id"], "to": ["other"]}, origin=PAGE)
        assert addressed["recipients"] == ["other", "agent"], addressed["recipients"]


def participant_contracts(notes):
    """Who can be addressed: agents that listened, registered or wrote, the
    page's person, and a directory the server is given."""
    with tempfile.TemporaryDirectory() as tmp:
        log = notes.NotesLog(Path(tmp) / "notes", page_author="noah")
        log.claim("listener-agent", timeout=0)
        registered = log.register({"author": "helper-agent", "about": "reads fluid notes"}, origin=CLI)
        assert registered["name"] == "helper-agent" and registered["about"] == "reads fluid notes", registered
        log.post({"kind": "note", "text": "hi", "anchor": {"kind": "scene"}, "author": "writer-agent"}, origin=CLI)
        rows = {row["name"]: row for row in log.participants(directory=["Shop-Agent", "bad name", "helper-agent"])}
        assert set(rows) == {"noah", "listener-agent", "helper-agent", "writer-agent", "shop-agent"}, sorted(rows)
        assert rows["noah"]["kind"] == "person" and rows["helper-agent"]["kind"] == "agent", rows
        assert rows["helper-agent"]["about"] == "reads fluid notes", rows["helper-agent"]
        assert set(rows["helper-agent"]["sources"]) == {"registered", "directory"}, rows["helper-agent"]
        assert "listened" in rows["listener-agent"]["sources"] and "wrote" in rows["writer-agent"]["sources"], rows
        assert rows["shop-agent"]["sources"] == ["directory"], rows["shop-agent"]
        again = log.register({"author": "helper-agent", "about": "reads fluid and fire notes", "avatar": "vantage-helper"}, origin=CLI)
        assert again["avatar"] == "vantage-helper", again
        assert {row["name"]: row for row in log.participants()}["helper-agent"]["avatar"] == "vantage-helper"
        expect_error(notes, 400, "request", lambda: log.register({"author": "helper-agent", "avatar": "  "}, origin=CLI))
        assert again["about"] == "reads fluid and fire notes"
        expect_error(notes, 403, "reserved-author", lambda: log.register({"author": "noah"}, origin=CLI))
        expect_error(notes, 400, "request", lambda: log.register({"author": "helper-agent", "about": 5}, origin=CLI))
        expect_error(notes, 400, "request", lambda: log.register({"about": "x"}, origin=PAGE))


# --- HTTP, through a real serve.py ------------------------------------------

def hub_contracts():
    """One notes stream per browser, shared by its tabs through the vantage hub:
    the server offers it, says which pages a hub carries, and gives each page its
    posting token by its own request rather than over the shared stream."""
    port = free_port()
    with tempfile.TemporaryDirectory() as tmp:
        process = subprocess.Popen([sys.executable, str(ROOT / "serve.py"), str(port)], cwd=ROOT,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                                   env={**os.environ, "KAMINOS_BIND_HOST": "127.0.0.1", "KAMINOS_NOTES_ROOT": str(Path(tmp) / "notes"),
                                        "KAMINOS_NOTES_PAGE_AUTHOR": "noah"})
        stream = None
        try:
            deadline = time.monotonic() + 30
            while True:
                try:
                    status, listing = call(port, "GET", "/api/notes?after=0")
                    break
                except OSError:
                    if time.monotonic() > deadline or process.poll() is not None:
                        raise AssertionError(process.stderr.read().decode() if process.poll() is not None else "serve.py did not start")
                    time.sleep(0.1)
            assert listing.get("hub") is True and listing["lastSeq"] == 0, listing

            # A page's hello gives it its token; the page can post with it straight away.
            status, hello = call(port, "POST", "/api/notes/hello", {"page": "page-hubbbbbb"})
            assert status == 200 and hello["token"] and hello["author"] == "noah" and hello["lastSeq"] == 0, (status, hello)
            assert call(port, "POST", "/api/notes/hello", {"page": "x"})[0] == 400, "a page id is checked"
            page = {"X-Kaminos-Notes-Page": "page-hubbbbbb", "X-Kaminos-Notes-Token": hello["token"]}
            status, note = call(port, "POST", "/api/notes", {"kind": "note", "text": "through the hub", "anchor": {"kind": "scene"}}, headers=page)
            assert status == 200 and note["via"] == "page", (status, note)
            again = call(port, "POST", "/api/notes/hello", {"page": "page-hubbbbbb"})[1]
            assert again["token"] == hello["token"], "a page that says hello again keeps its token"

            # The hub's stream carries the log and presence, but no page's token.
            stream = Stream(port, None, query="hub=hub-aaaaaaaa&after=0")
            assert stream.status == 200, stream.status
            batch = stream.next("events")
            assert [item["id"] for item in batch["events"]] == [note["id"]], batch
            with stream.lock:
                assert not any(event == "hello" or "token" in json.dumps(payload) for event, payload in stream.events), stream.events
            assert call(port, "GET", "/api/notes/stream?hub=x&after=0")[0] == 400, "a hub id is checked"

            # Presence: the pages a hub carries, newest report wins, [] retires them.
            def present():
                return {row["id"] for row in call(port, "GET", "/api/notes/presence")[1]["pages"]}
            assert call(port, "POST", "/api/notes/presence", {"hub": "hub-aaaaaaaa", "rev": 2, "pages": ["page-hubbbbbb", "page-hubccccc"]})[0] == 200
            assert present() == {"page-hubbbbbb", "page-hubccccc"}, present()
            stream.next("presence", lambda payload: {row["id"] for row in payload["pages"]} == {"page-hubbbbbb", "page-hubccccc"})
            assert call(port, "POST", "/api/notes/presence", {"hub": "hub-aaaaaaaa", "rev": 1, "pages": []})[0] == 200
            assert present() == {"page-hubbbbbb", "page-hubccccc"}, "an older report does not replace a newer one"
            assert call(port, "POST", "/api/notes/presence", {"hub": "hub-aaaaaaaa", "rev": 3, "pages": []})[0] == 200
            assert present() == set(), present()
            for bad in [{"hub": "x", "rev": 1, "pages": []}, {"hub": "hub-aaaaaaaa", "rev": "1", "pages": []},
                        {"hub": "hub-aaaaaaaa", "rev": 4, "pages": ["x"]}]:
                assert call(port, "POST", "/api/notes/presence", bad)[0] == 400, bad
        finally:
            if stream is not None:
                stream.connection.close()
            process.terminate()
            process.wait(10)


def hub_clock_contracts(notes):
    """A carried page counts as present, and its token as live, while its hub keeps
    reporting; a hub silent for 60 s is dropped."""
    now = [1000.0]
    with tempfile.TemporaryDirectory() as tmp:
        log = notes.NotesLog(Path(tmp) / "notes", page_author="noah")
        http = notes.NotesHttp(log, source=lambda: {}, clock=lambda: now[0])
        token = http.hello_page("page-hubbbbbb")["token"]
        http.hub_presence({"hub": "hub-aaaaaaaa", "rev": 1, "pages": ["page-hubbbbbb"]})
        assert [row["id"] for row in http._pages_now()] == ["page-hubbbbbb"]
        now[0] += notes.PAGE_TOKEN_GRACE_SECONDS + 30
        assert http.page_token_live("page-hubbbbbb", token), "a carried page's token outlives the hello grace"
        now[0] += notes.HUB_SILENCE_SECONDS
        assert http._pages_now() == [] and not http.page_token_live("page-hubbbbbb", token), "a silent hub's pages lapse"

    # A hub's last report retires its pages; a delayed older report must not bring them back.
    with tempfile.TemporaryDirectory() as tmp:
        log = notes.NotesLog(Path(tmp) / "notes", page_author="noah")
        http = notes.NotesHttp(log, source=lambda: {}, clock=lambda: now[0])
        token = http.hello_page("page-aaaaaaaa")["token"]
        assert http.hub_presence({"hub": "hub-aaaaaaaa", "rev": 2, "pages": ["page-aaaaaaaa"]})["accepted"]
        assert http.hub_presence({"hub": "hub-aaaaaaaa", "rev": 3, "pages": []})["accepted"]
        now[0] += notes.PAGE_TOKEN_GRACE_SECONDS + 1
        assert not http.hub_presence({"hub": "hub-aaaaaaaa", "rev": 2, "pages": ["page-aaaaaaaa"]})["accepted"], "an older report after retirement is old news"
        assert http._pages_now() == [] and not http.page_token_live("page-aaaaaaaa", token), "the departed page stays departed"
        assert http.hub_presence({"hub": "hub-aaaaaaaa", "rev": 4, "pages": ["page-aaaaaaaa"]})["accepted"], "a newer report attaches again"
        assert [row["id"] for row in http._pages_now()] == ["page-aaaaaaaa"]


def free_port():
    with socket.socket() as server:
        server.bind(("127.0.0.1", 0))
        return server.getsockname()[1]


def call(port, method, path, payload=None, headers=None, timeout=15):
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=timeout)
    body = None if payload is None else json.dumps(payload).encode()
    sent = {"Content-Type": "application/json"} if body is not None else {}
    sent.update(headers or {})
    connection.request(method, path, body=body, headers=sent)
    response = connection.getresponse()
    data = response.read()
    kind = response.getheader("Content-Type") or ""
    connection.close()
    if kind.startswith("application/json"):
        return response.status, json.loads(data or b"null")
    return response.status, data


class Stream:
    """Reads /api/notes/stream the way EventSource does."""

    def __init__(self, port, page_id, query=None):
        self.events = []
        self.lock = threading.Condition()
        self.connection = http.client.HTTPConnection("127.0.0.1", port, timeout=30)
        self.connection.request("GET", f"/api/notes/stream?{query or f'page={page_id}&after=0'}")
        self.response = self.connection.getresponse()
        self.status = self.response.status
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
                elif line == "" and event:
                    with self.lock:
                        self.events.append((event, json.loads("\n".join(data))))
                        self.lock.notify_all()
                    event, data = None, []
        except (OSError, ValueError):
            return

    def next(self, kind, predicate=lambda payload: True, seconds=8):
        deadline = time.monotonic() + seconds
        with self.lock:
            while True:
                for index, (event, payload) in enumerate(self.events):
                    if event == kind and predicate(payload):
                        del self.events[: index + 1]
                        return payload
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise AssertionError(f"no {kind} event; saw {[event for event, _ in self.events]}")
                self.lock.wait(remaining)

    def close(self):
        try:
            self.connection.sock.shutdown(socket.SHUT_RDWR)
        except (OSError, AttributeError):
            pass
        self.connection.close()


def http_contracts():
    port = free_port()
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "notes"
        process = subprocess.Popen([sys.executable, str(ROOT / "serve.py"), str(port)], cwd=ROOT,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                                   env={**os.environ, "KAMINOS_BIND_HOST": "127.0.0.1", "KAMINOS_NOTES_ROOT": str(root),
                                        "KAMINOS_NOTES_PAGE_AUTHOR": "noah"})
        stream = None
        try:
            deadline = time.monotonic() + 30
            while True:
                try:
                    status, listing = call(port, "GET", "/api/notes")
                    break
                except OSError:
                    if time.monotonic() > deadline or process.poll() is not None:
                        raise AssertionError(process.stderr.read().decode() if process.poll() is not None else "serve.py did not start")
                    time.sleep(0.1)
            assert status == 200 and listing["events"] == [] and listing["root"] == str(root.resolve()), (status, listing)
            assert listing["pageAuthor"] == "noah" and listing["schema"] == "kaminos.notes.v1", listing
            assert call(port, "GET", "/api/notes/participants")[1]["notifies"] is False, "no notify command, no notifying"

            stream = Stream(port, "page-aaaaaaaa")
            assert stream.status == 200, stream.status
            hello = stream.next("hello")
            assert hello["author"] == "noah" and hello["token"] and hello["lastSeq"] == 0, hello
            page = {"X-Kaminos-Notes-Page": "page-aaaaaaaa", "X-Kaminos-Notes-Token": hello["token"]}

            status, note = call(port, "POST", "/api/notes", {"kind": "note", "text": "look at the rim", "to": ["notes-agent"],
                                                             "anchor": {"kind": "object", "id": "cube", "label": "Cube"},
                                                             "picture": {"dataUrl": PNG_URL}}, headers=page)
            assert status == 200 and (note["via"], note["author"], note["pageId"]) == ("page", "noah", "page-aaaaaaaa"), (status, note)
            source = note["subject"]["source"]
            assert source["origin"] == f"http://127.0.0.1:{port}" and len(source["commit"]) == 40, source
            assert stream.next("events", lambda payload: any(event.get("id") == note["id"] for event in payload["events"]))

            # A page claim needs the token its stream was given; a tool may not use the page author's name.
            status, body = call(port, "POST", "/api/notes", {"kind": "note", "text": "x", "anchor": {"kind": "scene"}},
                                headers={"X-Kaminos-Notes-Page": "page-aaaaaaaa", "X-Kaminos-Notes-Token": "guessed"})
            assert status == 403 and body["phase"] == "page-token", (status, body)
            status, body = call(port, "POST", "/api/notes", {"kind": "note", "text": "x", "anchor": {"kind": "scene"}, "author": "noah"})
            assert status == 403 and body["phase"] == "reserved-author", (status, body)
            status, body = call(port, "POST", "/api/notes", {"kind": "note", "text": "x", "anchor": {"kind": "scene"}},
                                headers={"Origin": "http://evil.example"})
            assert status == 403 and body["phase"] == "forbidden", (status, body)
            connection = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
            connection.request("POST", "/api/notes", body=b"text=x", headers={"Content-Type": "application/x-www-form-urlencoded"})
            refused = connection.getresponse()
            assert refused.status == 415, refused.status
            connection.close()

            # The agent's wait returns the note at once, then waits; presence shows it listening.
            status, waited = call(port, "GET", "/api/notes/wait?as=notes-agent&timeout=5")
            assert status == 200 and [event["id"] for event in waited["notes"]] == [note["id"]], (status, waited)
            assert waited["root"] == str(root.resolve()), waited
            result = {}
            waiter = threading.Thread(target=lambda: result.update(answer=call(port, "GET", "/api/notes/wait?as=notes-agent&timeout=10")))
            waiter.start()
            time.sleep(0.4)
            status, presence = call(port, "GET", "/api/notes/presence")
            assert status == 200 and any(row["name"] == "notes-agent" and row["waiting"] for row in presence["listeners"]), presence
            assert any(row["id"] == "page-aaaaaaaa" for row in presence["pages"]), presence
            status, reply = call(port, "POST", "/api/notes", {"kind": "note", "text": "rim is clipped by the near plane",
                                                              "parent": note["id"], "author": "notes-agent"})
            assert status == 200 and reply["via"] == "cli" and reply["recipients"] == ["noah"], (status, reply)
            status, other = call(port, "POST", "/api/notes", {"kind": "note", "text": "for you", "anchor": {"kind": "scene"},
                                                              "to": ["notes-agent"]}, headers=page)
            waiter.join(8)
            status, answer = result["answer"]
            assert status == 200 and [event["id"] for event in answer["notes"]] == [other["id"]], answer
            assert stream.next("events", lambda payload: any(event.get("id") == reply["id"] for event in payload["events"]))

            status, people = call(port, "GET", "/api/notes/participants")
            names = {row["name"]: row for row in people["participants"]}
            assert status == 200 and names["noah"]["kind"] == "person" and "listened" in names["notes-agent"]["sources"], people
            status, joined = call(port, "POST", "/api/notes/participants", {"author": "helper-agent", "about": "reads notes"})
            assert status == 200 and joined["name"] == "helper-agent", (status, joined)
            status, image = call(port, "GET", f"/api/notes/picture?note={note['id']}")
            assert status == 200 and image == PNG, status
            status, missing = call(port, "GET", f"/api/notes/picture?note={reply['id']}")
            assert status == 404, status

            status, seen = call(port, "POST", "/api/notes/receipt", {"type": "seen", "notes": [reply["id"]]}, headers=page)
            assert status == 200 and seen["author"] == "noah" and seen["via"] == "page", seen
            status, listing = call(port, "GET", f"/api/notes?after={note['seq']}")
            assert [event["type"] for event in listing["events"]] == ["delivered", "note", "note", "delivered", "seen"], listing["events"]
        finally:
            if stream:
                stream.close()
            process.terminate()
            try:
                process.wait(10)
            except subprocess.TimeoutExpired:
                process.kill()


def presence_stream_contracts():
    """A page is told when someone starts or stops listening, not on every
    heartbeat of a listener that keeps waiting (review F3)."""
    port = free_port()
    with tempfile.TemporaryDirectory() as tmp:
        process = subprocess.Popen([sys.executable, str(ROOT / "serve.py"), str(port)], cwd=ROOT,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                   env={**os.environ, "KAMINOS_BIND_HOST": "127.0.0.1", "KAMINOS_NOTES_ROOT": str(Path(tmp) / "notes"),
                                        "KAMINOS_NOTES_PAGE_AUTHOR": "noah"})
        stream = None
        try:
            deadline = time.monotonic() + 30
            while True:
                try:
                    call(port, "GET", "/api/notes")
                    break
                except OSError:
                    if time.monotonic() > deadline:
                        raise AssertionError("serve.py did not start")
                    time.sleep(0.1)
            stream = Stream(port, "page-cccccccc")
            stream.next("hello")
            stream.next("presence")
            def wait_quietly():
                try:
                    call(port, "GET", "/api/notes/wait?as=steady-agent&timeout=9", timeout=20)
                except OSError:
                    pass  # the server stops at the end of this check

            waiter = threading.Thread(target=wait_quietly, daemon=True)
            waiter.start()
            arrived = stream.next("presence", lambda payload: any(row["name"] == "steady-agent" for row in payload["listeners"]))
            assert all("lastSeen" not in row for row in arrived["listeners"]), arrived
            time.sleep(7.5)  # two listener heartbeats
            with stream.lock:
                churn = [payload for event, payload in stream.events if event == "presence"]
            assert churn == [], ("presence repeated while nothing changed", len(churn))
            # A registration changes who can be addressed; an open page is told (review mentions F1).
            version = arrived.get("participantsVersion")
            assert version, ("presence carries a participants version", arrived)
            status, joined = call(port, "POST", "/api/notes/participants", {"author": "late-agent", "about": "joined late"})
            assert status == 200, (status, joined)
            changed = stream.next("presence", lambda payload: payload.get("participantsVersion") not in (None, version), seconds=6)
            assert changed["participantsVersion"] != version, changed
        finally:
            if stream:
                stream.close()
            process.terminate()
            try:
                process.wait(10)
            except subprocess.TimeoutExpired:
                process.kill()


def directory_and_notify_contracts():
    """A server can be given a directory of people to offer in the @ list, and a
    command to run when a note is for someone who is not listening. Kaminos
    knows nothing about where either comes from."""
    port = free_port()
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        people = tmp / "people.json"
        people.write_text(json.dumps({"people": [{"name": "far-agent", "about": "works elsewhere"}, {"name": "bad name"}]}))
        notify = tmp / "notify.py"
        notify.write_text(
            "import json, os, sys\n"
            "body = json.load(sys.stdin)\n"
            "name = os.environ['KAMINOS_NOTES_RECIPIENT']\n"
            "(__import__('pathlib').Path(sys.argv[1]) / f'notified-{name}.json').write_text(json.dumps(\n"
            "    {'recipient': name, 'note': body['note']['id'], 'text': body['note']['text'], 'server': os.environ.get('KAMINOS_NOTES_SERVER'),\n"
            "     'listening': body['listening'], 'listeningEnv': os.environ.get('KAMINOS_NOTES_LISTENING')}))\n"
            "sys.exit(3 if name == 'late-agent' else 0)\n")
        process = subprocess.Popen([sys.executable, str(ROOT / "serve.py"), str(port)], cwd=ROOT,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                                   env={**os.environ, "KAMINOS_BIND_HOST": "127.0.0.1", "KAMINOS_NOTES_ROOT": str(tmp / "notes"),
                                        "KAMINOS_NOTES_PAGE_AUTHOR": "noah", "KAMINOS_NOTES_DIRECTORY": str(people),
                                        "KAMINOS_NOTES_NOTIFY": f"{sys.executable} {notify} {tmp}"})
        try:
            deadline = time.monotonic() + 30
            while True:
                try:
                    call(port, "GET", "/api/notes")
                    break
                except OSError:
                    if time.monotonic() > deadline or process.poll() is not None:
                        raise AssertionError(process.stderr.read().decode() if process.poll() is not None else "serve.py did not start")
                    time.sleep(0.1)

            status, body = call(port, "GET", "/api/notes/participants")
            rows = {row["name"]: row for row in body["participants"]}
            assert status == 200 and rows["far-agent"]["sources"] == ["directory"], body
            assert body["notifies"] is True, "the page is told a notify command is configured"
            assert rows["far-agent"]["about"] == "works elsewhere" and rows["far-agent"]["listening"] is False, rows["far-agent"]
            assert "bad name" not in rows, sorted(rows)
            people.write_text(json.dumps({"people": [{"name": "far-agent"}, {"name": "late-agent", "kind": "person"}]}))
            status, body = call(port, "GET", "/api/notes/participants")
            rows = {row["name"]: row for row in body["participants"]}
            assert rows["late-agent"]["kind"] == "person", "the directory is read as it is now"

            # Every recipient's command runs, told whether that recipient's wait was active;
            # whoever runs the server decides what a listening recipient needs.
            waiting = {}
            listener = threading.Thread(target=lambda: waiting.update(call(port, "GET", "/api/notes/wait?as=near-agent&timeout=20", timeout=30)[1]))
            listener.start()
            for _ in range(100):
                if any(row["name"] == "near-agent" for row in call(port, "GET", "/api/notes/presence")[1]["listeners"]):
                    break
                time.sleep(0.05)
            status, note = call(port, "POST", "/api/notes", {"kind": "note", "text": "both of you, look", "to": ["far-agent", "near-agent"],
                                                             "anchor": {"kind": "scene"}, "author": "writer-agent"})
            assert status == 200, note
            listener.join(30)
            assert [item["id"] for item in waiting.get("notes", [])] == [note["id"]], waiting
            far = tmp / "notified-far-agent.json"
            for _ in range(200):
                if far.exists():
                    break
                time.sleep(0.05)
            told = json.loads(far.read_text())
            assert told == {"recipient": "far-agent", "note": note["id"], "text": "both of you, look", "server": f"http://127.0.0.1:{port}",
                            "listening": False, "listeningEnv": "0"}, told
            near = tmp / "notified-near-agent.json"
            for _ in range(200):
                if near.exists():
                    break
                time.sleep(0.05)
            assert json.loads(near.read_text())["listening"] is True and json.loads(near.read_text())["listeningEnv"] == "1"

            status, note2 = call(port, "POST", "/api/notes", {"kind": "note", "text": "late one", "to": ["late-agent"],
                                                              "anchor": {"kind": "scene"}, "author": "writer-agent"})
            outcomes = {}
            for _ in range(200):
                events = call(port, "GET", "/api/notes")[1]["events"]
                outcomes = {(event["notes"][0], event["recipient"]): event for event in events if event["type"] == "notified"}
                if len(outcomes) >= 3:
                    break
                time.sleep(0.05)
            assert outcomes[(note["id"], "far-agent")]["ok"] is True, outcomes
            failed = outcomes[(note2["id"], "late-agent")]
            assert failed["ok"] is False and "3" in failed["detail"], failed
            assert outcomes[(note["id"], "near-agent")]["ok"] is True, outcomes

            # Being notified is not being handed the note: far-agent's wait still gets it.
            status, got = call(port, "GET", "/api/notes/wait?as=far-agent&timeout=5", timeout=15)
            assert [item["id"] for item in got["notes"]] == [note["id"]], got
        finally:
            process.terminate()
            try:
                process.wait(10)
            except subprocess.TimeoutExpired:
                process.kill()


def notify_timing_contracts(notes):
    """A wait that just ended is not listening, whatever the presence display
    smooths over; and a note that was saved is notified even if its author's
    response cannot be written."""
    with tempfile.TemporaryDirectory() as tmp:
        clock = [1000.0]
        log = notes.NotesLog(Path(tmp) / "notes", page_author="noah", clock=lambda: clock[0])
        http = notes.NotesHttp(log, source=lambda: {"origin": "http://127.0.0.1:1"}, notify=["true"])
        calls = []
        http._run_notify = lambda note, name, server, listening: calls.append((note["id"], name, listening))
        log.claim("near-agent", timeout=0)
        note = log.post({"kind": "note", "text": "x", "to": ["near-agent"], "anchor": {"kind": "scene"}, "author": "writer-agent"}, origin=CLI)
        http._notify_recipients(note)
        for _ in range(100):
            if calls:
                break
            time.sleep(0.02)
        assert calls == [(note["id"], "near-agent", False)], calls

        class Broken:
            def write(self, data):
                raise BrokenPipeError("client went away")
        class Handler:
            headers = {"Content-Type": "application/json", "Content-Length": "0"}
            client_address = ("127.0.0.1", 5)
            wfile = Broken()
            def send_response(self, *args): pass
            def send_header(self, *args): pass
            def end_headers(self): pass
        body = json.dumps({"kind": "note", "text": "y", "to": ["far-agent"], "anchor": {"kind": "scene"}, "author": "writer-agent"}).encode()
        handler = Handler()
        handler.headers = {"Content-Type": "application/json", "Content-Length": str(len(body))}
        handler.rfile = __import__("io").BytesIO(body)
        calls.clear()
        try:
            http.post(handler, {})
        except OSError:
            pass
        for _ in range(100):
            if calls:
                break
            time.sleep(0.02)
        assert [name for _, name, _ in calls] == ["far-agent"], calls


if __name__ == "__main__":
    notes = load_notes()
    log_contracts(notes)
    follow_up_contracts(notes)
    participant_contracts(notes)
    notify_timing_contracts(notes)
    http_contracts()
    presence_stream_contracts()
    hub_contracts()
    hub_clock_contracts(notes)
    directory_and_notify_contracts()
    print("notes server contracts passed")
