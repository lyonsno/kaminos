# Agent vantage

The agent vantage is a small sub in the live workbench. An agent pilots it from a terminal and takes pictures from it. The person at the page places it like any other object, so the two of them can look at the same thing while fire, smoke and water keep running. Each picture comes back as a PNG with a JSON record of the view, the layers drawn, the frame counters and the objects in frame.

## Use it

Serve a checkout and open the workbench in a WebGPU browser. Keep the tab visible; it can sit in its own window. Browsers stop drawing hidden tabs.

```sh
python3 serve.py 8095
# open http://127.0.0.1:8095/index.html
```

From a terminal in the checkout:

```sh
export KAMINOS_VANTAGE_SERVER=http://127.0.0.1:8095
node tools/vantage.mjs launch                  # the sub appears in front of the current view
node tools/vantage.mjs objects                 # what is in the scene, and where from the sub
node tools/vantage.mjs orbit "Flame source" --azimuth 35 --elevation 18
node tools/vantage.mjs snap --annotate         # picture plus a labeled copy
node tools/vantage.mjs burst --count 6 --interval 250   # contact sheet of motion
node tools/vantage.mjs peek                    # the person's own view, as displayed
```

`node tools/vantage.mjs --help` lists every command. A target is an object id, a label or a unique part of one, `selection` for whatever is selected in the page, or `X Y Z`. Pictures go to `--out` (default `~/.local/state/kaminos/vantage/<pilot>`), one PNG per image beside one JSON record. `--pilot NAME` gives each agent its own sub. When several tabs on the same server are linked, the most recently focused visible tab answers; `--page ID` (or a unique prefix, from `pages`) chooses one.

Exit codes: 1 when the page refused the command (for example `busy` or `page-hidden`), 2 for invalid arguments, 3 when the server or a page could not be reached.

## In the page

The sub is an ordinary camera object, labeled Bebop for the default pilot. Select it in the viewport or the scene list and move it with G, R and S or the gizmo. Undo works, and saving keeps it with the scene. Each agent move is one labeled history entry, such as "Bebop: look at Cube". View through camera shows what the sub sees. While a sub is in the scene, the panel at the top right of the viewport shows a live map of the scene with your view and the sub's, and the last picture the sub took. `?vantage=0` in the page address leaves the terminal link closed.

## What a picture is

`snap` moves the page's own camera to the sub for a few frames (`--settle`, default 2). Every layer the page draws renders from there through its own loop: the scene, the fire volume and the water. The visible canvases are composited in stacking order and the person's view is restored. The record names the requested and effective view and how far they differ, the composited canvases, the frame counters before and after, and the objects whose bounds fall inside the frame.

While a picture is taken the page holds camera view, viewport navigation, the view pie, Save, Load and Capture until it finishes. Presses on the viewport canvas, click and box selection, the G, R, S, F and B keys, the tools' Frame buttons, and saving, choosing or re-lensing camera views wait too, because they would act through the borrowed camera. Dialogs, toolbars and the sub's panel keep working. A picture waits while a box selection is armed or a touch gesture is moving the view. Imports and ordinary editing continue. Objects in frame are named from the matrices and clip-space convention the page actually rendered with, including a camera frame's zoom and offset when someone is looking through the sub. They are named from the scene as it stood when each picture was taken, so every frame of a burst is named from its own moment.

A capture refuses instead of returning the wrong picture when:

- someone is mid-gesture or editing (`busy`);
- the tab is hidden (`page-hidden`);
- the viewport is looking through a different scene camera (`camera-view`);
- the camera moved, rolled or changed lens during the capture (`view-changed`);
- any pictured canvas did not draw a new frame from the requested view (`stale-frame`);
- the picture is one flat color (`blank-frame`).

A pictured canvas without a frame counter is listed under `unverifiedLayers`.

A command waits for the page for `--timeout` seconds. If the page never took it, it is withdrawn and will not run later. If the page took it but did not answer, the CLI says its outcome is unknown.

## Map and sketch

`sketch` describes the scene without rendering it: each object's bounds, the simulation fields, your view with the matrices your viewport renders with (`operator.optics`, which include a camera frame's zoom and offset), and every sub. `map` paints that as a three-quarter orthographic map: boxes, a ground grid, red X and blue Z axes, your view cone in white and each sub's in teal. Your cone follows the effective projection, so in camera view it shows the framed view you see. Pictures carry a map unless `--no-map` is given. Neither command waits for the scene to draw; a run in a hidden tab has not been witnessed.

## Limits

- A picture borrows the viewport, so the person's view switches to the sub for a couple of frames per snap and for the whole duration of a burst.
- Pictures use the viewport's resolution and aspect, downscaled to `--max-size` (default 1280 pixels on the long side).
- "In view" is decided from bounding boxes. Something nearer may hide an object, and helper glyphs such as emitters report their glyph bounds.
- DOM overlays such as labels and panels are not pictured; canvases are.
- Writing the borrowed view and restoring it resets the viewport's working navigation pivot, as the scene camera Capture does.

## Transport

`serve.py` relays commands. A page holds one server-sent-events link at `/api/vantage/link` and posts replies to `/api/vantage/reply`; the terminal posts to `/api/vantage/command` and waits for that page's reply. The vantage endpoints answer only this machine at the server's own address, refuse requests from other sites, and accept only JSON. Arguments are validated by `agent-vantage-core.mjs` in both the CLI and the page.

`agent-vantage-witness.mjs` exercises the whole route in an independent Chromium with the real CLI. It checks:

- the picture comes from the sub rather than the person's view;
- the person's camera returns exactly;
- an ordinary scene edit re-aims the sub, and undo returns it;
- pressing Numpad 0 during a burst cannot enter camera view or replace the person's saved view.

It records the served checkout's commit.
