"""Relay between a terminal and the agent vantage in a live Kaminos page.

A page receives commands on a server-sent-events link: its own, or a hub
stream that a browser's shared worker holds for every tab on this server, so
open tabs never use up the browser's few connections to one host. A
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
    def __init__(self, page_id, generation, hub=None):
        self.page_id, self.generation, self.closed, self.hub = page_id, generation, False, hub


class _Page:
    def __init__(self, page_id, clock):
        self.id = page_id
        self.meta = {}
        self.link = None
        self.queue = deque()
        self.connected_at = clock()
        self.last_seen = clock()
        self.focus_order = 0
        # On a hub, the page's newest membership number: older joins and leaves are stale.
        self.member = None


class _Pending:
    def __init__(self, page_id):
        self.page_id = page_id
        self.done = threading.Event()
        self.reply = None
        self.failure = None


class VantageBroker:
    def __init__(self, heartbeat=5.0, clock=time.monotonic, wall=time.time):
        self.heartbeat = heartbeat
        self._clock = clock
        self._wall = wall
        self._lock = threading.Condition()
        self._pages = {}
        self._hubs = {}
        self._order = itertools.count(1)
        # The newest membership each (hub, page) has left with: a join at or below it is a
        # delayed join from before that leave, and cannot bring the page back. Kept across
        # hub reconnects; one small entry per page that ever left a hub.
        self._departed = {}
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

    def attach_hub(self, hub_id):
        """A browser's shared worker links once for all its tabs on this server.
        Pages then join the hub. A hub that links again (the worker's stream
        reconnected) starts empty: the worker joins its pages again."""
        if not isinstance(hub_id, str) or not PAGE_ID.match(hub_id):
            raise VantageError(400, "request", "hub id must be 8-80 letters, digits, dashes or underscores")
        with self._lock:
            previous = self._hubs.get(hub_id)
            if previous is not None:
                self._close(previous)
            link = _Link(None, next(self._generations), hub=hub_id)
            self._hubs[hub_id] = link
            self._lock.notify_all()
            return link

    def join(self, hub_id, page_id, meta, member=None):
        """A page joins a hub as a numbered membership; a join older than the
        page's current membership on that hub is stale and changes nothing."""
        if not isinstance(page_id, str) or not PAGE_ID.match(page_id):
            raise VantageError(400, "request", "page id must be 8-80 letters, digits, dashes or underscores")
        member = member if isinstance(member, int) and not isinstance(member, bool) else None
        with self._lock:
            link = self._hubs.get(hub_id)
            if link is None or link.closed:
                raise VantageError(409, "hub", f"No hub \"{hub_id}\" is linked to this server; the page's worker links again")
            current = self._pages.get(page_id)
            if current is not None and current.link is link and None not in (member, current.member) and member < current.member:
                return False
            if member is not None and member <= self._departed.get((hub_id, page_id), 0):
                return False
            page = current or _Page(page_id, self._clock)
            self._pages[page_id] = page
            if page.link is not None and page.link is not link and page.link.hub is None:
                page.link.closed = True
            page.link = link
            page.member = member
            page.connected_at = page.last_seen = self._clock()
            self._update(page, meta, attached=True)
            self._lock.notify_all()
            return True

    def leave(self, hub_id, page_id, member=None):
        """A tab that closed, or stopped answering its hub, leaves: only its own
        commands fail. A leave naming an older membership than the page's
        current one is stale and changes nothing."""
        member = member if isinstance(member, int) and not isinstance(member, bool) else None
        with self._lock:
            if member is not None:
                key = (hub_id, page_id)
                self._departed[key] = max(self._departed.get(key, 0), member)
            page = self._pages.get(page_id)
            if page is None or page.link is None or page.link.hub != hub_id:
                return False
            if member is not None and page.member is not None and member != page.member:
                return False
            self._drop(page)
            self._lock.notify_all()
            return True

    def detach(self, link):
        with self._lock:
            self._close(link)
            self._lock.notify_all()

    def _close(self, link):
        link.closed = True
        if link.hub is not None and self._hubs.get(link.hub) is link:
            del self._hubs[link.hub]
        for page in [page for page in self._pages.values() if page.link is link]:
            # A closed page has no routing value; a reconnect registers again.
            self._drop(page)

    def _drop(self, page):
        del self._pages[page.id]
        for command_id, pending in list(self._pending.items()):
            if pending.page_id == page.id:
                pending.failure = VantageError(502, "disconnected", "The Kaminos page closed its link before answering")
                pending.done.set()
                del self._pending[command_id]

    def next_message(self, link, timeout):
        """The next command for any page on this link, oldest first."""
        deadline = self._clock() + timeout
        with self._lock:
            while True:
                if link.closed:
                    raise LinkClosed()
                waiting = [page for page in self._pages.values() if page.link is link and page.queue]
                while waiting:
                    page = min(waiting, key=lambda item: item.queue[0]["order"])
                    message = page.queue.popleft()
                    if message["id"] in self._pending:
                        page.last_seen = self._clock()
                        return message
                    waiting = [page for page in waiting if page.queue]
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
            self._update(page, meta)
            return True

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
            self._pending[command_id] = pending
            # A hub carries many pages, so each command names its page.
            target.queue.append({"id": command_id, "page": target.id, "command": command, "args": args,
                                 "expiresAt": int((self._wall() + timeout) * 1000), "order": next(self._order)})
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
        connected = [page for page in self._ranked() if page.link is not None]
        if requested:
            matches = [page for page in connected if page.id == requested] or [page for page in connected if page.id.startswith(requested)]
            if len(matches) > 1:
                raise VantageError(409, "select", f"Page \"{requested}\" is ambiguous: {', '.join(page.id for page in matches)}")
            if not matches:
                raise VantageError(404, "select", f"No connected Kaminos page matches \"{requested}\"")
            return matches[0]
        if not connected:
            raise VantageError(409, "select", "No Kaminos page is linked to this server")
        return connected[0]

    def _describe(self, page, now):
        return {"id": page.id, "href": page.meta.get("href"), "title": page.meta.get("title"),
                "visible": page.meta.get("visible"), "focused": page.meta.get("focused"),
                "connected": page.link is not None, "hub": page.link.hub if page.link is not None else None,
                "lastSeenAgoMs": round((now - page.last_seen) * 1000),
                "pendingCommands": sum(1 for pending in self._pending.values() if pending.page_id == page.id)}
