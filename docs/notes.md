# Notes

Say something on the thing you mean, address it to an agent by name, and read the answer where you are looking. A note sits on a scene object or on the scene, and carries what you saw: the camera, the selection, the code that served the page and a picture of the viewport. An agent working in a terminal gets the note with all of that, answers into the same thread, and the answer shows up in the page.

## In the page

Press **Shift+N**, or click **Notes** at the bottom right of the viewport. The composer shows what the note will go on: the selected object, or the scene when nothing is selected.

- **To** takes names; `@name` anywhere in the text reaches that agent too. The drawer's header shows which agents are listening right now.
- **attach what I see** adds a picture of the viewport as displayed. A picture with no words is a note too: *look at this*.
- **Post** (Cmd/Ctrl+Enter) writes the note. The status line says whether each addressee is listening now or will read it at its next check.
- **Copy ref** copies a reference to what you are looking at, for a conversation you are already having in a terminal. Paste it there; the agent resolves it with `node tools/notes.mjs show <ref>`.

Objects with open notes carry a pin. Answers addressed to you arrive as a toast and mark the **Notes** button. In a thread, **Reply** answers it, **Go to** restores the view and selection the note was written from, **Resolve** closes it, and **Copy ref** copies it.

`index.html?note=<id>` opens a thread and restores its view. `?notes=0` leaves notes off.

## From a terminal

```sh
export KAMINOS_NOTES_SERVER=http://127.0.0.1:8090   # any Kaminos server on this machine
export KAMINOS_NOTES_AS=my-agent-name

node tools/notes.mjs wait                 # block until a note for you arrives, print it, exit
node tools/notes.mjs reply <ref> "text" [--picture shot.png]
node tools/notes.mjs post "text" --on <object-id> --label "Name" [--to person] [--picture shot.png]
node tools/notes.mjs show <ref>           # a note and its thread, with picture paths
node tools/notes.mjs inbox                # notes for you not yet marked seen
node tools/notes.mjs list                 # open threads
node tools/notes.mjs presence             # who is listening, which pages are open
```

`node tools/notes.mjs --help` lists every command and flag; `--json` gives structured output. A reference can be a note id (`kn-...`), the text copied from the page, or a `?note=` link.

**Being woken.** In Claude Code, run `wait` as a background command: when a note for you arrives the command exits, and its exit wakes the session. Run `wait` again after answering to keep listening. Agents without background commands check `inbox` at their own checkpoints. While a `wait` is running, the page shows the agent as listening.

`wait` exits with status 3 if no server answers for `--give-up-after` seconds (default 120), so a dead server is reported instead of waited on forever. `--timeout S` stops waiting after S seconds with status 4.

## Who a note reaches

A note reaches the names it addresses. A reply also reaches the author of the note it answers, so a conversation continues without re-addressing. Notes nobody is addressed in stay visible on the scene for anyone reading it. `wait` hands each note to the agent once and records the handover. Opening a thread in the page records that you have seen it, and answering a note counts as reading it.

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
- `?note=` links;
- negative controls: a note for someone else, a tool posing as the person, a forged page token and a deleted object.

`--negative-no-picture` must fail at the picture check.
