"""Relay between a terminal and the agent vantage in a live Kaminos page.

A page holds one server-sent-events link and receives commands on it. A
terminal posts a command and waits for that page's reply. The relay does not
interpret commands: the page and the CLI validate them with the shared
`agent-vantage-core.mjs` module.
"""

import itertools
import re
import threading
import time
import uuid
from collections import deque

VANTAGE_SCHEMA = "kaminos.agent-vantage.v1"
PAGE_ID = re.compile(r"^[A-Za-z0-9_-]{8,80}$")


class LinkClosed(Exception):
    pass


class VantageError(Exception):
    def __init__(self, status, phase, message, **details):
        super().__init__(message)
        self.status, self.phase, self.details = status, phase, details


class _Link:
    def __init__(self, page_id, generation):
        self.page_id, self.generation, self.closed = page_id, generation, False


class _Page:
    def __init__(self, page_id, clock):
        self.id = page_id
        self.meta = {}
        self.link = None
        self.queue = deque()
        self.connected_at = clock()
        self.last_seen = clock()
        self.focus_order = 0
        # A page whose tab was hidden is letting go of its link: it is sent and
        # chosen for nothing until it is shown again or closes.
        self.resting = False
        # The newest visibility the page has reported. Reports arrive on
        # separate requests and can overtake one another; an older one is stale.
        self.seq = None


class _Pending:
    def __init__(self, page_id):
        self.page_id = page_id
        self.done = threading.Event()
        self.reply = None
        self.failure = None
        self.expires_at = None


class VantageBroker:
    def __init__(self, heartbeat=5.0, clock=time.monotonic, wall=time.time):
        self.heartbeat = heartbeat
        self._clock = clock
        self._wall = wall
        self._lock = threading.Condition()
        self._pages = {}
        self._pending = {}
        self._generations = itertools.count(1)
        self._focus = itertools.count(1)

    # --- page side -------------------------------------------------------
    def attach(self, page_id, meta):
        if not isinstance(page_id, str) or not PAGE_ID.match(page_id):
            raise VantageError(400, "request", "page id must be 8-80 letters, digits, dashes or underscores")
        with self._lock:
            page = self._pages.get(page_id) or _Page(page_id, self._clock)
            self._pages[page_id] = page
            if page.link is not None:
                page.link.closed = True
            page.link = _Link(page_id, next(self._generations))
            page.connected_at = page.last_seen = self._clock()
            self._update(page, meta, attached=True)
            self._lock.notify_all()
            return page.link

    def detach(self, link):
        with self._lock:
            link.closed = True
            page = self._pages.get(link.page_id)
            if page is None or page.link is not link:
                return
            # A closed page has no routing value; a reconnect registers again.
            del self._pages[link.page_id]
            for command_id, pending in list(self._pending.items()):
                if pending.page_id == link.page_id:
                    pending.failure = VantageError(502, "disconnected", "The Kaminos page closed its link before answering")
                    pending.done.set()
                    del self._pending[command_id]
            self._lock.notify_all()

    def next_message(self, link, timeout):
        deadline = self._clock() + timeout
        with self._lock:
            while True:
                if link.closed:
                    raise LinkClosed()
                page = self._pages.get(link.page_id)
                while page is not None and page.link is link and page.queue and not page.resting:
                    message = page.queue.popleft()
                    if message["id"] in self._pending:
                        page.last_seen = self._clock()
                        return message
                remaining = deadline - self._clock()
                if remaining <= 0:
                    return None
                self._lock.wait(remaining)

    def undeliverable(self, message):
        self._fail(message.get("id"), VantageError(502, "disconnected", "The command could not be delivered to the page"))

    def presence(self, page_id, meta):
        with self._lock:
            page = self._pages.get(page_id)
            if page is None:
                return False
            page.last_seen = self._clock()
            if self._stale(page, meta.get("seq")):
                return True
            self._update(page, meta)
            if page.meta.get("visible"):
                page.resting = False
                self._lock.notify_all()
            return True

    @staticmethod
    def _stale(page, seq):
        """Whether a visibility report is older than one the page already made.
        A report without a sequence (an older page) is never stale."""
        if not isinstance(seq, int) or isinstance(seq, bool):
            return False
        if page.seq is not None and seq < page.seq:
            return True
        page.seq = seq
        return False

    def rest(self, page_id, seq=None):
        """A page whose tab was hidden asks to let go of its link. It is sent and
        chosen for nothing more. A command still queued for it fails at once: it
        never reached the page, so it did not run. Commands already taken for
        delivery are returned, with when each stops being wanted, so the page can
        answer them before it closes its link. `resting` says whether this
        request rested the page: a request older than the page's newest
        visibility report rests nothing and lists nothing. None for a page that
        is not linked."""
        with self._lock:
            page = self._pages.get(page_id)
            if page is None or page.link is None:
                return None
            if self._stale(page, seq):
                return {"resting": False, "outstanding": []}
            page.resting = True
            queued = [message["id"] for message in page.queue]
            page.queue.clear()
            for command_id in queued:
                pending = self._pending.pop(command_id, None)
                if pending is not None:
                    pending.failure = VantageError(409, "page-hidden", "The Kaminos tab was hidden before it received the command, so the command did not run")
                    pending.done.set()
            self._lock.notify_all()
            return {"resting": True, "outstanding": [{"id": command_id, "expiresAt": pending.expires_at}
                                                     for command_id, pending in self._pending.items() if pending.page_id == page_id]}

    def reply(self, page_id, command_id, payload):
        with self._lock:
            pending = self._pending.get(command_id)
            if pending is None or pending.page_id != page_id:
                return False
            del self._pending[command_id]
            pending.reply = payload
            pending.done.set()
            page = self._pages.get(page_id)
            if page is not None:
                page.last_seen = self._clock()
            return True

    # --- agent side ------------------------------------------------------
    def pages(self):
        with self._lock:
            now = self._clock()
            return [self._describe(page, now) for page in self._ranked()]

    def submit(self, command, args, page=None, timeout=30.0):
        if not isinstance(command, str) or not command:
            raise VantageError(400, "request", "A vantage command needs a command name")
        if not isinstance(args, dict):
            raise VantageError(400, "request", "Vantage command arguments must be an object")
        command_id = uuid.uuid4().hex
        with self._lock:
            target = self._select(page)
            pending = _Pending(target.id)
            pending.expires_at = int((self._wall() + timeout) * 1000)
            self._pending[command_id] = pending
            target.queue.append({"id": command_id, "command": command, "args": args, "expiresAt": pending.expires_at})
            self._lock.notify_all()
            described = self._describe(target, self._clock())
        started = self._clock()
        if not pending.done.wait(timeout):
            delivered = self._withdraw(command_id, target.id, pending)
            if delivered is True:
                raise VantageError(504, "timeout", f"The page received the command but did not answer within {timeout:g}s, so its outcome is unknown. A hidden tab pauses rendering; bring it to the front.", delivered=True)
            if delivered is False:
                raise VantageError(504, "timeout", f"The command expired before the page took it, so it was not run. A hidden tab pauses rendering; bring it to the front.", delivered=False)
        if pending.failure is not None:
            raise pending.failure
        reply = {key: pending.reply[key] for key in ("ok", "result", "error", "phase") if key in pending.reply}
        return {**reply, "ok": reply.get("ok") is True, "id": command_id, "command": command,
                "page": {key: described[key] for key in ("id", "href", "title")},
                "elapsedMs": round((self._clock() - started) * 1000)}

    # --- internals -------------------------------------------------------
    def _withdraw(self, command_id, page_id, pending):
        """Forget a timed-out command: True if the page had already taken it,
        False if it was still queued, None if its answer arrived meanwhile."""
        with self._lock:
            if pending.done.is_set():
                return None
            self._pending.pop(command_id, None)
            page = self._pages.get(page_id)
            queued = [message for message in (page.queue if page else []) if message["id"] == command_id]
            for message in queued:
                page.queue.remove(message)
            return not queued

    def _fail(self, command_id, failure):
        with self._lock:
            pending = self._pending.pop(command_id, None)
        if pending is not None and failure is not None:
            pending.failure = failure
            pending.done.set()

    def _update(self, page, meta, attached=False):
        was_focused = bool(page.meta.get("focused")) and not attached
        for key in ("href", "title"):
            if isinstance(meta.get(key), str):
                page.meta[key] = meta[key][:500]
        for key in ("visible", "focused"):
            if isinstance(meta.get(key), bool):
                page.meta[key] = meta[key]
        # Recency is gaining focus. A heartbeat that is still focused is not
        # news, or two pages that both report focus would trade the default.
        if page.meta.get("focused") and not was_focused:
            page.focus_order = next(self._focus)

    def _connected(self):
        return [page for page in self._pages.values() if page.link is not None]

    def _ranked(self):
        def rank(page):
            visible = bool(page.meta.get("visible"))
            return (page.link is not None, visible and bool(page.meta.get("focused")), visible, page.focus_order, page.last_seen)
        return sorted(self._pages.values(), key=rank, reverse=True)

    def _select(self, requested):
        linked = [page for page in self._ranked() if page.link is not None]
        connected = [page for page in linked if not page.resting]
        if requested:
            named = lambda pages: [page for page in pages if page.id == requested] or [page for page in pages if page.id.startswith(requested)]
            matches = named(connected)
            if len(matches) > 1:
                raise VantageError(409, "select", f"Page \"{requested}\" is ambiguous: {', '.join(page.id for page in matches)}")
            if not matches:
                hidden = named(linked)
                if hidden:
                    raise VantageError(409, "page-hidden", f"Page {hidden[0].id}'s tab is hidden; show it to send it commands")
                raise VantageError(404, "select", f"No connected Kaminos page matches \"{requested}\"")
            return matches[0]
        if not connected:
            raise VantageError(409, "select", "No Kaminos page is linked to this server")
        return connected[0]

    def _describe(self, page, now):
        return {"id": page.id, "href": page.meta.get("href"), "title": page.meta.get("title"),
                "visible": page.meta.get("visible"), "focused": page.meta.get("focused"),
                "connected": page.link is not None, "resting": page.resting, "lastSeenAgoMs": round((now - page.last_seen) * 1000),
                "pendingCommands": sum(1 for pending in self._pending.values() if pending.page_id == page.id)}
