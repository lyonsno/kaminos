"""Kaminos notes: one append-only log of notes about the work, shared by every
Kaminos server on the machine.

The log is a JSON-lines file of events: notes and replies, delivery and seen
receipts, resolution. Every server appends under an exclusive file lock and
follows what the others append, so a note posted through one port reaches an
agent waiting through another. The server stamps what a client may not claim:
sequence, id, time, provenance (`via`), a page's author, thread and recipients.
notes-core.mjs folds the events for the page and tools/notes.mjs; see
docs/notes.md.
"""

import base64
import binascii
import fcntl
import getpass
import hashlib
import hmac
import json
import os
import re
import secrets
import select
import socket
import struct
import threading
import time
from pathlib import Path
from urllib.parse import parse_qs, urlparse

NOTES_SCHEMA = "kaminos.notes.v1"
NOTE_ID = re.compile(r"^kn-[0-9a-z]{8,32}$")
NAME = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")
PAGE_ID = re.compile(r"^[A-Za-z0-9_-]{8,80}$")
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
PNG_DATA_URL = "data:image/png;base64,"
# A client that sends one of these is confused or forging; the server stamps them.
STAMPED = ("via", "id", "seq", "thread", "recipients", "pageId", "type", "at", "schema")
POST_FIELDS = {"kind", "text", "to", "parent", "anchor", "subject", "context", "picture", "urgent", "author"}
RECEIPTS = ("seen", "resolved", "reopened")
# A waiting agent refreshes its presence file while it waits; one that stops
# refreshing for this long is shown as gone.
LISTENER_STALE_SECONDS = 15.0
LISTENER_HEARTBEAT_SECONDS = 3.0
LISTENER_GRACE_SECONDS = 6.0
PAGE_TOKEN_GRACE_SECONDS = 15.0


class NotesError(Exception):
    def __init__(self, status, phase, message):
        super().__init__(message)
        self.status, self.phase = status, phase


def default_root():
    return Path(os.environ.get("KAMINOS_NOTES_ROOT") or "~/.local/state/kaminos/notes").expanduser().resolve()


def default_page_author():
    """The name notes from a Kaminos page carry: KAMINOS_NOTES_PAGE_AUTHOR, else the login name."""
    raw = os.environ.get("KAMINOS_NOTES_PAGE_AUTHOR") or getpass.getuser() or "you"
    name = re.sub(r"[^a-z0-9._-]+", "-", raw.strip().lower()).strip("-._")
    return name if NAME.match(name) else "you"


def checked_name(value, what):
    name = value.strip().lstrip("@").lower() if isinstance(value, str) else ""
    if not NAME.match(name):
        raise NotesError(400, "request", f"{what} {value!r} is not a usable name: use letters, digits, dots, dashes or underscores")
    return name


def iso(seconds):
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(seconds)) + f".{int((seconds % 1) * 1000):03d}Z"


def checked_anchor(raw):
    if isinstance(raw, dict) and raw.get("kind") == "scene":
        return {"kind": "scene"}
    if isinstance(raw, dict) and raw.get("kind") == "object":
        object_id = raw.get("id").strip() if isinstance(raw.get("id"), str) else ""
        if not object_id:
            raise NotesError(400, "request", "An object anchor needs the object id")
        label = raw.get("label").strip() if isinstance(raw.get("label"), str) and raw.get("label").strip() else object_id
        return {"kind": "object", "id": object_id, "label": label}
    raise NotesError(400, "request", "A new thread needs an anchor: the scene or one object")


def decode_picture(raw):
    if not isinstance(raw, dict) or not isinstance(raw.get("dataUrl"), str) or not raw["dataUrl"].startswith(PNG_DATA_URL):
        raise NotesError(400, "picture", "A picture is a PNG data URL")
    try:
        data = base64.b64decode(raw["dataUrl"][len(PNG_DATA_URL):], validate=True)
    except (binascii.Error, ValueError):
        raise NotesError(400, "picture", "The picture is not valid base64")
    if not data.startswith(PNG_SIGNATURE) or len(data) < 33 or data[12:16] != b"IHDR":
        raise NotesError(400, "picture", "That picture is not a PNG")
    width, height = struct.unpack(">II", data[16:24])
    return data, {"width": width, "height": height, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


class NotesLog:
    def __init__(self, root, *, page_author, clock=time.time, poll_interval=0.2):
        self.root = Path(root).expanduser().resolve()
        (self.root / "pictures").mkdir(parents=True, exist_ok=True)
        (self.root / "listeners").mkdir(parents=True, exist_ok=True)
        self.path = self.root / "notes.jsonl"
        self.path.touch(exist_ok=True)
        self.lock_path = self.root / "notes.lock"
        self.page_author = checked_name(page_author, "Page author")
        self.issues = []
        self._clock = clock
        self._poll = poll_interval
        self._cond = threading.Condition()
        self._events, self._notes, self._delivered = [], {}, set()
        self._offset, self._partial, self._line = 0, b"", 0
        self._waiting = {}
        with self._cond:
            self._sync()

    # --- reading -----------------------------------------------------------
    def _sync(self):
        """Read what any server appended since the last read. Call with _cond held."""
        try:
            size = self.path.stat().st_size
        except FileNotFoundError:
            size = 0
        if size <= self._offset:
            return 0
        with self.path.open("rb") as handle:
            handle.seek(self._offset)
            chunk = handle.read(size - self._offset)
        self._offset += len(chunk)
        data = self._partial + chunk
        lines = data.split(b"\n")
        self._partial = lines.pop()  # a line still being written stays for the next read
        added = 0
        for raw in lines:
            self._line += 1
            if not raw.strip():
                continue
            try:
                event = json.loads(raw)
                if not isinstance(event, dict) or not isinstance(event.get("seq"), int):
                    raise ValueError("not a notes event")
            except ValueError as error:
                self.issues.append({"line": self._line, "problem": f"unreadable log line: {error}"})
                continue
            self._events.append(event)
            if event.get("type") == "note":
                self._notes[event.get("id")] = event
            elif event.get("type") == "delivered":
                for note_id in event.get("notes") or []:
                    self._delivered.add((note_id, event.get("recipient")))
            added += 1
        if added:
            self._cond.notify_all()
        return added

    def events(self, after=0):
        with self._cond:
            self._sync()
            return [event for event in self._events if event["seq"] > after]

    @property
    def last_seq(self):
        with self._cond:
            self._sync()
            return self._events[-1]["seq"] if self._events else 0

    def note(self, note_id):
        with self._cond:
            self._sync()
            return self._notes.get(note_id)

    def wait_events(self, after, timeout):
        """Events after `after`, waiting up to `timeout` seconds for the first one."""
        deadline = time.monotonic() + max(0.0, timeout)
        with self._cond:
            while True:
                self._sync()
                fresh = [event for event in self._events if event["seq"] > after]
                remaining = deadline - time.monotonic()
                if fresh or remaining <= 0:
                    return fresh
                self._cond.wait(min(remaining, self._poll))

    # --- writing -----------------------------------------------------------
    def _append(self, build):
        """Append build(next_seq) under the machine-wide lock; build may return None to write nothing."""
        with self._cond:
            with self.lock_path.open("a") as lock:
                fcntl.flock(lock, fcntl.LOCK_EX)
                try:
                    self._sync()
                    event = build((self._events[-1]["seq"] if self._events else 0) + 1)
                    if event is None:
                        return None
                    data = (json.dumps(event, separators=(",", ":"), ensure_ascii=False) + "\n").encode()
                    descriptor = os.open(self.path, os.O_WRONLY | os.O_APPEND)
                    try:
                        view = memoryview(data)
                        while view:
                            view = view[os.write(descriptor, view):]
                        os.fsync(descriptor)
                    finally:
                        os.close(descriptor)
                    self._sync()
                    return event
                finally:
                    fcntl.flock(lock, fcntl.LOCK_UN)

    def _author(self, body, origin):
        if origin["via"] == "page":
            if "author" in body:
                raise NotesError(400, "request", "A page note's author is the page's person; leave author out")
            return self.page_author
        if "author" not in body:
            raise NotesError(400, "request", "Say who is writing: author is required outside a Kaminos page")
        author = checked_name(body["author"], "Author")
        if author == self.page_author:
            raise NotesError(403, "reserved-author", f"{author!r} is reserved for notes written in a Kaminos page")
        return author

    def _stamp(self, seq, kind, author, origin):
        event = {"schema": NOTES_SCHEMA, "seq": seq, "type": kind, "at": iso(self._clock()), "author": author, "via": origin["via"]}
        if origin["via"] == "page":
            event["pageId"] = origin["pageId"]
        return event

    def post(self, body, *, origin):
        if not isinstance(body, dict):
            raise NotesError(400, "request", "A note is a JSON object")
        for field in STAMPED:
            if field in body:
                raise NotesError(400, "request", f"{field} is stamped by the server, not sent")
        unknown = set(body) - POST_FIELDS
        if unknown:
            raise NotesError(400, "request", f"Unknown note fields: {', '.join(sorted(unknown))}")
        author = self._author(body, origin)
        kind = body.get("kind", "note")
        if kind not in ("note", "ref"):
            raise NotesError(400, "request", "A note's kind is note or ref")
        text = body.get("text") or ""
        if not isinstance(text, str):
            raise NotesError(400, "request", "Note text must be a string")
        text = text.strip()
        to = body.get("to") or []
        if not isinstance(to, list):
            raise NotesError(400, "request", "to is a list of names")
        to = list(dict.fromkeys(checked_name(name, "Addressee") for name in to))
        parent_id = body.get("parent")
        if parent_id is not None:
            if not isinstance(parent_id, str) or not NOTE_ID.match(parent_id):
                raise NotesError(400, "request", f"{parent_id!r} is not a note id")
            if body.get("anchor") is not None:
                raise NotesError(400, "request", "A reply belongs to its thread's anchor; leave anchor out")
            anchor = None
        else:
            anchor = checked_anchor(body.get("anchor"))
        subject = body.get("subject") or {}
        if not isinstance(subject, dict) or (subject.get("scene") is not None and not isinstance(subject.get("scene"), str)):
            raise NotesError(400, "request", "subject is {scene: <scene file name or null>}")
        context = body.get("context")
        if context is not None and not isinstance(context, dict):
            raise NotesError(400, "request", "context is an object")
        urgent = body.get("urgent", False)
        if not isinstance(urgent, bool):
            raise NotesError(400, "request", "urgent is true or false")
        picture = decode_picture(body["picture"]) if body.get("picture") is not None else None
        if kind == "note" and not text and picture is None:
            raise NotesError(400, "request", "A note needs words or a picture")

        def build(seq):
            parent = self._notes.get(parent_id) if parent_id else None
            if parent_id and parent is None:
                raise NotesError(404, "parent", f"No note {parent_id} to answer")
            note_id = "kn-" + secrets.token_hex(6)
            while note_id in self._notes:
                note_id = "kn-" + secrets.token_hex(6)
            recipients = [name for name in dict.fromkeys(to + ([parent["author"]] if parent else [])) if name != author]
            thread = parent["thread"] if parent else note_id
            scene = subject.get("scene") or ((self._notes[thread].get("subject") or {}).get("scene") if parent else None)
            event = self._stamp(seq, "note", author, origin)
            event.update({"id": note_id, "kind": kind, "text": text, "to": to, "recipients": recipients,
                          "parent": parent_id, "thread": thread, "anchor": anchor,
                          "subject": {"scene": scene, "source": origin.get("source")}, "context": context,
                          "picture": None, "urgent": urgent})
            if picture is not None:
                data, meta = picture
                final = self.root / "pictures" / f"{note_id}.png"
                partial = final.with_suffix(".png.partial")
                partial.write_bytes(data)
                partial.replace(final)  # the file exists before any event names it
                event["picture"] = {"file": f"pictures/{note_id}.png", **meta}
            return event

        return self._append(build)

    def receipt(self, body, *, origin):
        if not isinstance(body, dict) or set(body) - {"type", "notes", "author"}:
            raise NotesError(400, "request", "A receipt is {type, notes, author}")
        kind = body.get("type")
        if kind not in RECEIPTS:
            raise NotesError(400, "request", f"A receipt type is one of {', '.join(RECEIPTS)}")
        ids = body.get("notes")
        if not isinstance(ids, list) or not ids or not all(isinstance(note_id, str) and NOTE_ID.match(note_id) for note_id in ids):
            raise NotesError(400, "request", "notes is a list of note ids")
        author = self._author(body, origin)

        def build(seq):
            unknown = [note_id for note_id in ids if note_id not in self._notes]
            if unknown:
                raise NotesError(404, "note", f"No note {', '.join(unknown)}")
            event = self._stamp(seq, kind, author, origin)
            event["notes"] = list(dict.fromkeys(ids))
            return event

        return self._append(build)

    # --- waiting agents ----------------------------------------------------
    def _pending(self, name):
        return [event for event in self._events
                if event.get("type") == "note" and event.get("kind") != "ref"
                and name in (event.get("recipients") or []) and (event["id"], name) not in self._delivered]

    def claim(self, recipient, timeout, still_wanted=lambda: True, server=None):
        """Hand `recipient` every note for it not yet handed over, waiting up to
        `timeout` seconds for one; the handover is recorded once in the log."""
        name = checked_name(recipient, "Listener")
        deadline = time.monotonic() + max(0.0, timeout)
        self._listening(name, +1, server)
        heartbeat = time.monotonic()
        try:
            with self._cond:
                while True:
                    self._sync()
                    if self._pending(name):
                        if not still_wanted():
                            return []

                        def build(seq):
                            fresh = self._pending(name)
                            if not fresh:
                                return None
                            event = self._stamp(seq, "delivered", name, {"via": "cli"})
                            event.update({"notes": [note["id"] for note in fresh], "recipient": name, "route": "wait"})
                            build.notes = fresh
                            return event

                        if self._append(build) is not None:
                            return build.notes
                        continue
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        return []
                    if time.monotonic() - heartbeat >= LISTENER_HEARTBEAT_SECONDS:
                        self._write_listener(name, True, server)
                        heartbeat = time.monotonic()
                    self._cond.wait(min(remaining, self._poll))
        finally:
            self._listening(name, -1, server)

    def _listening(self, name, delta, server):
        with self._cond:
            count = self._waiting.get(name, 0) + delta
            self._waiting[name] = max(0, count)
            waiting = count > 0
        self._write_listener(name, waiting, server)

    def _write_listener(self, name, waiting, server):
        path = self.root / "listeners" / f"{name}.json"
        now = self._clock()
        try:
            previous = json.loads(path.read_text())
        except (OSError, ValueError):
            previous = {}
        since = previous.get("since") if previous.get("waiting") or (now - previous.get("lastSeen", 0)) < LISTENER_GRACE_SECONDS else None
        record = {"name": name, "waiting": waiting, "since": since or now, "lastSeen": now, "server": server, "pid": os.getpid()}
        partial = path.with_suffix(f".{os.getpid()}.{threading.get_ident()}.partial")
        partial.write_text(json.dumps(record))
        partial.replace(path)

    def presence(self):
        """Agents waiting for notes, through any server sharing this log."""
        now = self._clock()
        listeners = []
        for path in sorted((self.root / "listeners").glob("*.json")):
            try:
                record = json.loads(path.read_text())
            except (OSError, ValueError):
                continue
            age = now - record.get("lastSeen", 0)
            if (record.get("waiting") and age < LISTENER_STALE_SECONDS) or age < LISTENER_GRACE_SECONDS:
                listeners.append({"name": record["name"], "waiting": bool(record.get("waiting")) and age < LISTENER_STALE_SECONDS,
                                  "since": iso(record["since"]), "lastSeen": iso(record["lastSeen"]), "server": record.get("server")})
        return {"listeners": listeners}

    def picture_path(self, note_id):
        note = self.note(note_id)
        if not note or not note.get("picture"):
            return None
        path = (self.root / note["picture"]["file"]).resolve()
        return path if path.parent == (self.root / "pictures").resolve() and path.is_file() else None


class NotesHttp:
    """The /api/notes routes. They answer only this machine at the server's own
    address: local tools without an Origin, or this server's own pages."""

    def __init__(self, log, *, source):
        self.log, self.source = log, source
        self._pages, self._lock = {}, threading.Lock()

    def handle(self, handler, method, path):
        parsed = urlparse(path)
        routes = {
            ("GET", "/api/notes"): self.list,
            ("GET", "/api/notes/stream"): self.stream,
            ("GET", "/api/notes/wait"): self.wait,
            ("GET", "/api/notes/presence"): self.presence,
            ("GET", "/api/notes/picture"): self.picture,
            ("POST", "/api/notes"): self.post,
            ("POST", "/api/notes/receipt"): self.receipt,
        }
        route = routes.get((method, parsed.path))
        if route is None:
            self._json(handler, {"ok": False, "phase": "request", "error": "No such notes route"}, 404)
            return
        if not self._allowed(handler):
            return
        try:
            route(handler, parse_qs(parsed.query))
        except NotesError as error:
            self._json(handler, {"ok": False, "phase": error.phase, "error": str(error)}, error.status)

    # --- guards and transport ---------------------------------------------
    def _allowed(self, handler):
        port = handler.server.server_address[1]

        def same_machine(value):
            parsed = urlparse(value if "//" in value else f"//{value}")
            try:
                return parsed.hostname in ("127.0.0.1", "localhost", "::1") and parsed.port == port
            except ValueError:
                return False

        client = (getattr(handler, "client_address", None) or ("",))[0]
        if client not in ("127.0.0.1", "::1", "::ffff:127.0.0.1"):
            reason = "Kaminos notes only answer this machine"
        elif not same_machine(handler.headers.get("Host") or ""):
            reason = "Kaminos notes only answer their own local address"
        elif handler.headers.get("Origin") and not same_machine(handler.headers["Origin"]):
            reason = "Kaminos notes do not answer other sites"
        else:
            return True
        self._json(handler, {"ok": False, "phase": "forbidden", "error": reason}, 403)
        return False

    @staticmethod
    def _json(handler, payload, status=200):
        data = json.dumps(payload).encode()
        handler.send_response(status)
        handler.send_header("Content-Type", "application/json")
        handler.send_header("Content-Length", str(len(data)))
        handler.send_header("Cache-Control", "no-store")
        handler.end_headers()
        handler.wfile.write(data)

    @staticmethod
    def _body(handler):
        if (handler.headers.get("Content-Type") or "").split(";")[0].strip().lower() != "application/json":
            raise NotesError(415, "request", "Send notes as application/json")
        try:
            length = int(handler.headers.get("Content-Length") or 0)
            body = json.loads(handler.rfile.read(length)) if 0 < length <= 256 * 1024 * 1024 else None
        except ValueError:
            body = None
        if not isinstance(body, dict):
            raise NotesError(400, "request", "Notes requests need a JSON object body")
        return body

    @staticmethod
    def _peer_closed(handler):
        try:
            readable, _, _ = select.select([handler.connection], [], [], 0)
            return bool(readable) and handler.connection.recv(1, socket.MSG_PEEK) == b""
        except OSError:
            return True

    @staticmethod
    def _first(query, key, default=None):
        return (query.get(key) or [default])[0]

    def _origin(self, handler):
        page_id = handler.headers.get("X-Kaminos-Notes-Page")
        token = handler.headers.get("X-Kaminos-Notes-Token")
        if page_id is None and token is None:
            return {"via": "cli", "source": self.source()}
        with self._lock:
            page = self._pages.get(page_id or "")
            valid = (page is not None and token is not None and hmac.compare_digest(page["token"], token)
                     and (page["streams"] > 0 or time.monotonic() < page["expires"]))
        if not valid:
            raise NotesError(403, "page-token", "This page's notes link has lapsed; reload the page")
        return {"via": "page", "pageId": page_id, "source": self.source()}

    # --- routes ------------------------------------------------------------
    def list(self, handler, query):
        after = int(self._first(query, "after", "0") or 0)
        self._json(handler, {"schema": NOTES_SCHEMA, "root": str(self.log.root), "pageAuthor": self.log.page_author,
                             "lastSeq": self.log.last_seq, "events": self.log.events(after), "issues": self.log.issues})

    def post(self, handler, query):
        body = self._body(handler)
        self._json(handler, self.log.post(body, origin=self._origin(handler)))

    def receipt(self, handler, query):
        body = self._body(handler)
        self._json(handler, self.log.receipt(body, origin=self._origin(handler)))

    def wait(self, handler, query):
        name = self._first(query, "as")
        try:
            timeout = float(self._first(query, "timeout", "25"))
        except ValueError:
            raise NotesError(400, "request", "timeout is a number of seconds")
        if not 0 <= timeout <= 3600:
            raise NotesError(400, "request", "timeout is between 0 and 3600 seconds")
        notes = self.log.claim(name, timeout, still_wanted=lambda: not self._peer_closed(handler), server=self.source().get("origin"))
        self._json(handler, {"schema": NOTES_SCHEMA, "root": str(self.log.root), "notes": notes, "lastSeq": self.log.last_seq})

    def _pages_now(self):
        with self._lock:
            return [{"id": page_id, "author": page["author"], "since": iso(page["since"])}
                    for page_id, page in self._pages.items() if page["streams"] > 0]

    def presence(self, handler, query):
        self._json(handler, {"schema": NOTES_SCHEMA, **self.log.presence(), "pages": self._pages_now()})

    def picture(self, handler, query):
        note_id = self._first(query, "note") or ""
        path = self.log.picture_path(note_id) if NOTE_ID.match(note_id) else None
        if path is None:
            raise NotesError(404, "picture", f"No picture for {note_id or 'that note'}")
        data = path.read_bytes()
        handler.send_response(200)
        handler.send_header("Content-Type", "image/png")
        handler.send_header("Content-Length", str(len(data)))
        handler.send_header("Cache-Control", "private, max-age=31536000, immutable")
        handler.end_headers()
        handler.wfile.write(data)

    def stream(self, handler, query):
        page_id = self._first(query, "page") or ""
        if not PAGE_ID.match(page_id):
            raise NotesError(400, "request", "page is 8-80 letters, digits, dashes or underscores")
        try:
            after = max(int(self._first(query, "after", "0") or 0), int(handler.headers.get("Last-Event-ID") or 0))
        except ValueError:
            raise NotesError(400, "request", "after is a sequence number")
        with self._lock:
            page = self._pages.get(page_id)
            if page is None or (page["streams"] == 0 and time.monotonic() >= page["expires"]):
                page = self._pages[page_id] = {"token": secrets.token_urlsafe(24), "author": self.log.page_author,
                                               "since": time.time(), "streams": 0, "expires": 0.0}
            page["streams"] += 1
            token = page["token"]
        handler.close_connection = True
        sent_presence = None
        try:
            handler.send_response(200)
            handler.send_header("Content-Type", "text/event-stream; charset=utf-8")
            handler.send_header("Cache-Control", "no-store")
            handler.end_headers()
            hello = {"schema": NOTES_SCHEMA, "token": token, "author": self.log.page_author, "root": str(self.log.root),
                     "lastSeq": self.log.last_seq}
            handler.wfile.write(b"retry: 2000\n\n" + self._event("hello", hello))
            handler.wfile.flush()
            quiet_since = time.monotonic()
            while True:
                events = self.log.wait_events(after, 1.0)
                presence = {**self.log.presence(), "pages": self._pages_now()}
                if events:
                    after = events[-1]["seq"]
                    handler.wfile.write(self._event("events", {"events": events}, event_id=after))
                if presence != sent_presence:
                    handler.wfile.write(self._event("presence", presence))
                    sent_presence = presence
                elif not events:
                    if self._peer_closed(handler):
                        break
                    if time.monotonic() - quiet_since < 5:
                        continue
                    handler.wfile.write(b": keepalive\n\n")
                handler.wfile.flush()
                quiet_since = time.monotonic()
        except OSError:
            pass
        finally:
            with self._lock:
                page["streams"] -= 1
                if page["streams"] == 0:
                    page["expires"] = time.monotonic() + PAGE_TOKEN_GRACE_SECONDS

    @staticmethod
    def _event(name, payload, event_id=None):
        data = json.dumps(payload, separators=(",", ":"))
        return (f"id: {event_id}\n" if event_id is not None else "").encode() + f"event: {name}\ndata: {data}\n\n".encode()
