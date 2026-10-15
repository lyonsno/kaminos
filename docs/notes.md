# Notes

Say something on the thing you mean, address it to an agent by name, and read the answer where you are looking. A note sits on a scene object or on the scene, and carries what you saw: the camera, the selection, the code that served the page and a picture of the viewport. An agent working in a terminal gets the note with all of that, answers into the same thread, and the answer shows up in the page.

## In the page

Press **Shift+N**, or click **Notes** at the bottom right of the viewport. The composer shows what the note will go on: the selected object, or the scene when nothing is selected.

- **To** takes names; `@name` anywhere in the text reaches that agent too. The drawer's header shows which agents are listening right now.
- **attach what I see** adds a picture of the viewport as displayed. A picture with no words is a note too: *look at this*.
- **Post** (Cmd/Ctrl+Enter) writes the note. The status line says whether each addressee is listening now or will read it at its next check.
- **Copy ref** copies a reference to what you are looking at, for a conversation you are already having in a terminal. Paste it there; the agent resolves it with `node tools/notes.mjs show <ref>`.

Objects with open notes carry a pin. Answers addressed to you arrive as a toast and mark the **Notes** button. In a thread, **Reply** answers it, **Go to** restores the view and selection the note was written from, **Resolve** closes it, and **Copy ref** copies it.

A note's link, `index.html#scene=<file>&note=<id>`, opens the saved scene and then the thread, and restores the view the note was written from. It does this once the scene has finished restoring, including a saved flame scene that first passes through its preset page. `index.html?note=<id>` and `#note=<id>` work for notes on unsaved scenes. `?notes=0` leaves notes off.

## From a terminal

From a Kaminos checkout, choose the server and the name people will address.
Use that same name for registration, listening and replies:

```sh
export KAMINOS_NOTES_SERVER=http://127.0.0.1:8090   # any Kaminos server on this machine
export KAMINOS_NOTES_AS=my-agent-name

node tools/notes.mjs register --about "What I work on"
node tools/notes.mjs participants         # registered names and current listening state
```

Registration makes your name available in the page's mention suggestions.
Listening is separate: the page reports it while `wait` is active. An optional
`register --avatar <object-id>` associates your name with a scene object; clicking
the name selects that object. Existing integrations can supply the identity and
connection. The CLI currently requires explicit registration and a new `wait`
after each delivery.

With the same environment:

```sh
node tools/notes.mjs wait                 # block until a note for you arrives, print it, exit
node tools/notes.mjs reply kn-example "What I observed or changed"
node tools/notes.mjs post "Please inspect this" --on object-id --label "Name" --to person
node tools/notes.mjs show <ref>           # a note and its thread, with picture paths
node tools/notes.mjs inbox                # notes for you not yet marked seen
node tools/notes.mjs list                 # open threads
node tools/notes.mjs presence             # who is listening, which pages are open
```

`node tools/notes.mjs --help` lists every command and flag; `--json` gives structured output. A reference can be a note id (`kn-...`), the text copied from the page, or a note link. For a reply, `show` and `wait` describe the reply's own view (camera, selection, picture, served code) first, then the view the thread opened with.

Replace `kn-example` and `object-id` with actual references. Add `--picture
shot.png` to a reply or post to attach an image. Read the note and inspect its
attached picture and context before responding; report the useful observation,
change or question in that same thread. The retained view describes what the
person saw then, even if the live scene has since changed. Restoring that view
restores its camera and available selection; evolved simulation state comes
from the feature's own reconstruction service.

**Delivery and wake.** `wait` returns the note and exits. Claude Code's background
command completion has been exercised as a session wake route. Codex wake from
background completion remains unverified; use `inbox` at your normal checkpoints
unless your current integration supplies an exercised delivery route. A background
process existing by itself establishes listening, not that the model will resume.
After consuming a delivery, run `wait` again to keep listening; checkpoint clients
continue checking `inbox`. A reply marks the note read; use `seen <ref>` when you
have read it without replying. Delivery alone records handover, not an answer.

`wait` exits with status 3 if no server answers for `--give-up-after` seconds (default 120), so a dead server is reported instead of waited on forever. `--timeout S` stops waiting after S seconds with status 4.

For recovery, verify the selected server and name with `participants` and
`presence`, then use `inbox` for unread notes and restore the supported listener.
`--server` and `--as` can supply those values directly when the environment is
unavailable. Servers using the same `KAMINOS_NOTES_ROOT` share the conversation;
an explicitly isolated notes root has its own log and participants.

## Who a note reaches

A note reaches the names it addresses. A reply also reaches the author of the note it answers, and a follow-up to your own message reaches whoever that message reached, so a conversation continues without re-addressing. Notes nobody is addressed in stay visible on the scene for anyone reading it. `wait` hands each note to the agent once and records the handover. Opening a thread in the page records that you have seen it, and answering a note counts as reading it.

## Where notes live

One append-only log, shared by every Kaminos server on the machine: `KAMINOS_NOTES_ROOT`, default `~/.local/state/kaminos/notes` (`notes.jsonl`, `pictures/`, `listeners/`). A note posted through one port reaches an agent waiting through another. Notes are not part of the scene file or its undo history.

Each line is one event: a note or reply, a delivery, a seen receipt, a resolution. The server stamps what a client may not claim: sequence, id, time, thread, recipients and provenance (`via: page` or `via: cli`). A page's notes carry its person's name (`KAMINOS_NOTES_PAGE_AUTHOR`, default the login name) only through the token its event stream was given. Tools must say who they are, and may not use that name.

This is honest labeling between cooperating local tools, not protection against another process on the same account editing the files. The routes answer only this machine at the server's own address.

## Limits

- A picture is what the canvases showed, composited; DOM overlays are not pictured.
- Notes anchor to the scene and to whole objects. Properties, points in space and moments in a simulation are not yet anchors.
- A note on an object that was later deleted keeps its last label and restores only the view.
- Presence covers agents waiting through `tools/notes.mjs`; other ways of listening, such as an editor plugin, do not show yet.

## Witness

```sh
node notes-witness.mjs --out <dir> --playwright <playwright-core/index.mjs> --browser <chrome-for-testing>
```

This serves the checkout with its own notes log and drives the page with real keys and clicks. It exercises:

- a note waking a waiting agent, with its anchor, camera, served commit and picture;
- the agent's reply reaching the page as a toast and a thread;
- seen receipts, pins and copied refs;
- links into unsaved scenes, saved scenes and saved flame scenes;
- a reply being written keeping its focus, caret and attach choice through live updates;
- two follow-ups in a row both reaching the agent;
- negative controls: a note for someone else, a tool posing as the person, a forged page token and a deleted object.

`--negative-no-picture` must fail at the picture check.
