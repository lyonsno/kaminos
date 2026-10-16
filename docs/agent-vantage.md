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
node tools/vantage.mjs glance                  # the sub's view from its own camera; your view is never borrowed
node tools/vantage.mjs watch --seconds 8 --until cut-complete   # a film strip until a tool says it is done
node tools/vantage.mjs live on                 # a small live view from the sub in its panel
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

## The sub's own view

`glance`, `watch` and `live` draw the scene from the sub's own camera into their own targets, with the exact matrices of the sub's view, through the page's tone mapping and colour space. The person's view is never borrowed or held, so these can run while someone works. A glance draws the scene's meshes, lights and background. It leaves out the fire volume, local water and ambient occlusion, and says so in `omitted`; `snap` draws every layer. Each glance keeps a pick map with depth, drawn in the same task with the same matrices.

`watch` is a film strip: a glance at the start of each frame interval of a window (`--seconds`, default 5; `--fps`, default 2; 320 pixels on the long side), so a 2-second watch at 2 fps draws at 0, 500, 1000 and 1500 ms. Each frame is drawn from wherever the sub is at that moment and keeps its own view, size, camera, pick map and named objects, so `pick X Y --picture RECORD.json --frame N` works on any frame, even after the viewport was resized. Depth is kept only with `--depth`. `--frames` keeps each frame as its own picture beside the contact sheet. A frame of the cadence is drawn only within its own interval and never after the deadline; the one exception is the frame owed to an event that came before the deadline, which is drawn as soon as any draw in progress finishes. Draws never stack: when a draw or a late timer passes a frame's interval, that frame is skipped and counted in `missedTicks`. The watch lasts its whole window. Other vantage commands wait until it ends. `--seconds` plus `--timeout` may not exceed 3600, the longest the server holds a command.

`--until EVENT` ends the strip as soon as the page announces `kaminos:EVENT`, with one more frame drawn at once, so the last frame shows what followed. The event counts when it comes before the deadline; one at or after the deadline is ignored. A tool announces something that happened with:

```js
window.dispatchEvent(new CustomEvent('kaminos:cut-complete', {detail: {pieces: 2}}));
```

The record gives the event's name, when it came (`atMs` from the start of the watch) and its `detail` when that is plain data: null, booleans, finite numbers, strings, arrays and plain objects. Detail is copied once from its own data properties. Any other detail (a Map, a Date, a function, NaN or -0, a getter, a symbol key, a missing array entry or a property on an array that is not an entry) is not altered into something else: the event still counts, `detail` is null and `detailError` says what could not be carried. Without the event, the strip ends with its window (`ended: "window"`).

`live on` draws a small glance into the sub's panel on a timer (`--fps`, default 4) in place of the last picture, until `live off`. A tick is skipped while the tab is hidden, while a picture holds the camera, or while the previous frame is still being read back. `live off` reports the frames drawn, the ticks skipped and the last draw time.

## Map and sketch

`sketch` describes the scene without rendering it: each object's bounds, the simulation fields, your view with the matrices your viewport renders with (`operator.optics`, which include a camera frame's zoom and offset), and every sub. `map` paints that as a three-quarter orthographic map: boxes, a ground grid, red X and blue Z axes, your view cone in white and each sub's in teal. Your cone follows the effective projection, so in camera view it shows the framed view you see. Pictures carry a map unless `--no-map` is given. Neither command waits for the scene to draw; a run in a hidden tab has not been witnessed.

## Pointing at things

A pick says what the renderer drew at a point of a picture or a view. Every picture keeps a pick map for that. In the same task that composes the picture, the page draws the scene once more with the picture's matrices into its own target, and every material keeps its own shader. What decides coverage is therefore the renderer's own logic: face side, alpha test and cut-outs, discards, vertex nodes, morphs, depth and colour-write state, and clipping. The only change is what each fragment writes: the drawing object's number and instance, and in a second target its view depth. The camera that draws the map has the picture camera's matrices, near and far planes. A material's own extra outputs would take precedence over the map's, so for this draw it gets the map's outputs instead. They still run its own `output`, discards included, before writing the number and depth. The record keeps the map as runs, beside a row for each object it shows:
- its scene entry, mesh path and name;
- the world matrices it was drawn with;
- its geometry identity;
- for an instanced mesh, the matrices of the instances it shows.

The depth is kept as a file beside the picture (`…-depth.f32`), and the record keeps its path. It holds one little-endian float32 per pixel, in rows from the top: the view depth of what was drawn there (its distance along the camera's viewing axis), or 0 where nothing was. That is about 3.7 MB for a 1280×720 picture. A burst keeps depth for its frames only with `--depth`.

The map draws no editor drawing, and nothing that is drawn outside the scene renderer (see below). It costs one more render per picture, and the first one in a page also compiles its shaders.

`pick X Y --picture RECORD.json` (with `--frame N` for a burst frame) reads the picture's own map at pixel X Y:
- the named object is the one the picture drew there, whatever has happened to the scene since;
- the point is the one the picture drew there, from its depth: in the world, and in the object's own frame as the object stood;
- the face and normal come from the mesh, placed where the picture drew it, when it still passes through that point.

`pick X Y` (fractions of the sub's view, or of the framed view you see while looking through the sub) and `--from operator` draw a pick map now, at the size the viewport is drawn at, and read back the one pixel and its depth. The answer's `referent` is `pictured` for a kept picture and `rendered` for a live pick.

A pick names the pixel its point falls in, and its ray goes through that pixel's centre (`pixel`, `pixelCentre`), where the depth was drawn.

A hit carries:

| Field | Meaning |
| --- | --- |
| `authority` | `exact` when the renderer drew this object at that pixel and nothing drawn outside the map lies along the ray in front of it. Otherwise `approximate`, with `unresolved` saying what may cover it. |
| `now` | `present`, `missing` (the object is gone) or `mesh-missing`. A missing object is still named, as the picture drew it. |
| `point`, `local` | With depth (`pointBasis: depth`), the point drawn at that pixel, which later edits, moves or removal cannot change. Without depth (older pictures, burst frames kept without `--depth`), it comes from casting the ray at the named mesh where it was drawn (`recast`); a skinned mesh is cast as it is posed now (`recast-now`). Without depth, it is empty when the ray does not meet the mesh as it is now (`missed`), when the drawing is a sprite, line or point cloud rather than a mesh (`not-a-mesh`), or when the instance is not known (`instance-unknown`). |
| `normal`, `surface.face` | From the mesh placed where it was drawn. With depth, they are given only when that mesh still passes through the drawn point to float32 precision (`surfaceBasis: recast-agrees`): within about one part in a million of the distance, plus a micrometre. Otherwise they are empty (`recast-differs`). |
| `localNormal`, `entryMatrix` | The normal in the entry's own frame, and the entry's world matrix as drawn, in which `local` and `localNormal` are given. The entry's current matrix times `local` is where the point is now, if the whole entry moved. |
| `geometry.status`, `geometry.identity` | How the mesh's geometry compares with the picture: `same`, `edited` (an attribute, buffer, edit count, content or instance matrix changed), `replaced`, or after a reload `likely-same` or `unverified`. `identity` is the record a later `recheck` compares against. |

When no scene object was drawn at the pixel, `hit` is empty and `drawn` says what was there: `nothing`, a drawing that is not a scene object (the ground, a proxy), or `unidentified`.

The map covers what the scene renderer draws into the scene canvas. Three things are drawn outside it:
- point clouds such as splats;
- simulation fields such as fire and smoke;
- water from the local water host.

A cloud or field whose bounds the ray crosses in front of the drawn depth, and water whenever that host is drawing, go under `unresolved` and make the hit `approximate`, because any of them may be what the point shows. Without depth, every crossing goes under `unresolved`: today's geometry cannot say what lay in front when the picture was taken. `fields` lists every field the ray crosses. A translucent surface in front is what a pick names, though the picture also shows what lies behind it. A material with its own fragment shader is traced with a stand-in, and its hits are `approximate`. A pick map numbers up to 65,534 objects in a page and 65,536 instances of a mesh. Past that, an object is `unidentified`, and a mesh with more instances names no instance. The map is drawn in the task that composes the picture: a change another callback makes to the scene between the scene canvas's last draw and that task would be in the map but not in the picture.

Pictures kept without a pick map are refused. `--now` casts their camera into the scene as it is now, and the answer then says `from: camera`.

To anchor something to a pick (a note's pin, for example), keep the hit's `id`, `surface.path`, `local`, `localNormal` and `geometry.identity`. `recheck --anchor FILE` (a note anchor or a saved pick) or `run('recheck', {id, path, identity})` says, without drawing, whether that mesh is still the geometry that was picked: `now` is `present`, `missing` or `mesh-missing`, and `status` is `same`, `edited` or `replaced` within the page load that picked it, `likely-same` or `replaced` from another load (vertex and index counts and sampled content decide), or `unverified` when the kept identity lacks a field the comparison reads or holds the wrong type there (a pick saved before identities were kept has none). A pictured pick keeps its map's identity even when the entry or mesh is gone, with a null status, so a later recheck can compare it if undo brings the entry back. The identity's uuid, attribute numbers and edit counts mean something only in the page load that recorded them; its counts and content samples survive a reload.

A pick never borrows your view. In the page, `window.kaminosAgentVantage.run('pick', {from: 'operator', at: [x, y]})` does the same. `window.kaminosAgentVantage.capturing()` and `idle()` tell a page reader when a picture holds the camera.

## Limits

- `snap` and `burst` borrow the viewport, so the person's view switches to the sub for a couple of frames per snap and for the whole duration of a burst. `glance`, `watch` and `live` never do, but they leave out the fire volume, local water and ambient occlusion.
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
